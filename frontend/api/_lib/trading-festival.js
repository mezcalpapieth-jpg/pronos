import { FESTIVAL_MINUTE, FESTIVAL_SCHEDULE, FESTIVAL_SHAPE, FESTIVAL_SOURCE } from '../../shared/trading-festival.js';
import { initialReserves } from './amm-math.js';
import { withTransaction } from './db-tx.js';
import { defaultPointsSeedLiquidity } from './market-liquidity.js';
import { cancelPointsMarket } from './points-cancel-market.js';
import { parseJsonb, releaseOpenLimitOrdersForMarkets } from './points-limit-orders.js';
import { bestEffortPersistTopHolderSnapshot } from './points-top-holders.js';
import { festivalDataDelayMinutes, festivalFeedEnabled, readFestivalBoundary } from './trading-festival-feed.js';

const SETTLEMENT_RETRY_MS = 15 * FESTIVAL_MINUTE;
const RESOLVER = 'trading_festival';

export function festivalMarketMeta(row, config = parseJsonb(row.resolver_config, {})) {
  if (row.source !== FESTIVAL_SOURCE || config?.shape !== FESTIVAL_SHAPE) return null;
  return {
    key: row.source_event_id,
    threshold: config.threshold ?? null,
    closePrice: config.closePrice ?? null,
    dataDelayMinutes: config.dataDelayMinutes ?? 0,
  };
}

async function seedFestivalMarket(sql, slot, dataDelayMinutes) {
  const seed = defaultPointsSeedLiquidity({ category: slot.category, outcomeCount: 2 });
  const reserves = JSON.stringify(initialReserves(seed, 2));
  const basis = slot.key === 'usdmxn' ? 'cotización de compra (bid)' : 'precio';
  const config = {
    shape: FESTIVAL_SHAPE,
    source: slot.provider.toLowerCase(),
    symbol: slot.symbol,
    closesAt: slot.endTime,
    dataDelayMinutes,
    criteria: `Se usa el cierre del minuto inmediatamente anterior a cada límite del horario según ${slot.provider} (${slot.symbol}, ${basis}). El valor de apertura fija la referencia. Sube si el cierre supera la referencia y Baja si queda por debajo.`
      + (dataDelayMinutes ? ` La fuente publica los precios con ${dataDelayMinutes} minutos de retraso. La referencia se muestra al recibir el dato de apertura.` : '')
      + ` Si los precios son iguales, o falta algún precio ${dataDelayMinutes + 15} minutos después del cierre, se cancela y se devuelven los puntos de las posiciones abiertas.`,
  };
  await sql`
    INSERT INTO points_markets (
      source, source_event_id, question, category, category_tags, outcomes,
      reserves, seed_liquidity, seed_liquidities, start_time, end_time,
      amm_mode, status, resolver_type, resolver_config, featured, auto_featured, hidden_from_home, mode
    ) VALUES (
      ${FESTIVAL_SOURCE}, ${slot.key}, ${`¿Sube o baja ${slot.name}?`}, ${slot.category},
      '["tradingfestival"]'::jsonb, '["Sube","Baja"]'::jsonb,
      ${reserves}::jsonb, ${seed}, ${reserves}::jsonb, ${slot.startTime}::timestamptz, ${slot.endTime}::timestamptz,
      'unified', 'pending', ${RESOLVER}, ${JSON.stringify(config)}::jsonb, true, false, false, 'points'
    )
    ON CONFLICT (source, source_event_id) WHERE source IS NOT NULL AND source_event_id IS NOT NULL
    DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time,
                  resolver_config = EXCLUDED.resolver_config
    WHERE points_markets.status = 'pending'
      AND (
        (points_markets.start_time, points_markets.end_time) IS DISTINCT FROM (EXCLUDED.start_time, EXCLUDED.end_time)
        OR COALESCE(points_markets.resolver_config->>'dataDelayMinutes', '0') IS DISTINCT FROM EXCLUDED.resolver_config->>'dataDelayMinutes'
      )
  `;
}

export async function readFestivalMarkets(sql) {
  return sql`
    SELECT id, source, source_event_id, status, start_time, end_time, outcome, resolver_config
    FROM points_markets
    WHERE source = ${FESTIVAL_SOURCE} AND archived_at IS NULL
  `;
}

async function settleFestivalMarket(client, { row, slot, closing }) {
  const result = await client.query(
    `SELECT id, status, resolver_config FROM points_markets
      WHERE id = $1 AND source = $2 AND resolver_type = $3
        AND end_time = $4::timestamptz AND archived_at IS NULL FOR UPDATE`,
    [row.id, FESTIVAL_SOURCE, RESOLVER, row.end_time],
  );
  const market = result.rows[0];
  if (market?.status !== 'active') return 'unchanged';

  const threshold = Number(parseJsonb(market.resolver_config, {}).threshold);
  const hasThreshold = Number.isFinite(threshold) && threshold > 0;
  const closePrice = closing?.price ?? null;
  const evidence = closePrice === null ? {} : {
    closePrice,
    closePriceAt: new Date(closing.t).toISOString(),
    closePriceSource: slot.provider,
  };

  if (!hasThreshold || closePrice === null || closePrice === threshold) {
    const reason = !hasThreshold ? 'festival_missing_open' : closePrice === null ? 'festival_missing_close' : 'festival_tie';
    await cancelPointsMarket(client, row.id, { actor: 'system', reason });
    await client.query(
      `UPDATE points_markets SET resolver_config = resolver_config || $2::jsonb WHERE id = $1`,
      [row.id, JSON.stringify({ ...evidence, cancelReason: reason })],
    );
    return 'canceled';
  }

  const outcome = closePrice > threshold ? 0 : 1;
  await bestEffortPersistTopHolderSnapshot(client, row.id, FESTIVAL_SOURCE, {
    resolution: { winningOutcomeIndex: outcome },
  });
  await releaseOpenLimitOrdersForMarkets(client, row.id);
  await client.query(
    `UPDATE points_markets SET status = 'resolved', outcome = $2, final_score = $3,
         resolved_at = NOW(), resolved_by = 'system', resolver_config = resolver_config || $4::jsonb
       WHERE id = $1`,
    [row.id, outcome, `${threshold} → ${closePrice}`, JSON.stringify(evidence)],
  );
  return 'resolved';
}

function festivalOpeningEvidence(slot, opening) {
  return JSON.stringify({
    threshold: opening.price,
    openPriceAt: new Date(opening.t).toISOString(),
    openPriceSource: slot.provider,
  });
}

async function processFestivalMarket(sql, { row, slot, now, clock, env, readBoundary, transaction }) {
  const start = Date.parse(row.start_time);
  const end = Date.parse(row.end_time);
  const config = parseJsonb(row.resolver_config, {});
  const delay = (config.dataDelayMinutes || 0) * FESTIVAL_MINUTE;
  const retryUntil = end + delay + SETTLEMENT_RETRY_MS;
  if (now < start) return 'pending';

  if (row.status === 'pending') {
    if (now >= end) {
      await sql`
        UPDATE points_markets SET status = 'canceled', resolved_at = NOW(), resolved_by = 'system',
          resolver_config = resolver_config || '{"cancelReason":"festival_never_opened"}'::jsonb
        WHERE id = ${row.id} AND status = 'pending' AND end_time <= ${new Date(now).toISOString()}::timestamptz
      `;
      return 'canceled';
    }
    if (!festivalFeedEnabled(slot, env)) return 'feed_disabled';
    // Check same-session access to a completed bar before accepting trades on a delayed feed.
    const at = delay ? start - delay - 2 * FESTIVAL_MINUTE : start;
    const available = await readBoundary(slot, { at, env, allowDelayed: delay > 0 });
    if (!available) return 'waiting_for_open';
    const evidence = delay ? '{}' : festivalOpeningEvidence(slot, available);
    const updated = await sql`
      UPDATE points_markets SET status = 'active', resolver_config = resolver_config || ${evidence}::jsonb
      WHERE id = ${row.id} AND status = 'pending' AND archived_at IS NULL
        AND start_time = ${row.start_time}::timestamptz AND end_time = ${row.end_time}::timestamptz
        AND end_time > ${new Date(clock()).toISOString()}::timestamptz
      RETURNING id
    `;
    return updated.length ? 'opened' : 'unchanged';
  }

  if (delay && config.threshold == null && now >= start + delay) {
    let opening;
    try {
      opening = await readBoundary(slot, { at: start, env, allowDelayed: true });
    } catch (error) {
      if (now < retryUntil) throw error;
    }
    if (!opening) {
      if (now < retryUntil) return 'waiting_for_open';
      return transaction(client => settleFestivalMarket(client, { row, slot, closing: null }));
    }
    await sql`
      UPDATE points_markets SET resolver_config = resolver_config || ${festivalOpeningEvidence(slot, opening)}::jsonb
      WHERE id = ${row.id} AND status = 'active' AND archived_at IS NULL
        AND start_time = ${row.start_time}::timestamptz AND end_time = ${row.end_time}::timestamptz
        AND resolver_config->>'threshold' IS NULL
    `;
  }
  if (now < end) return 'active';
  if (now < end + delay) return 'waiting_for_close';
  let closing = null;
  try {
    closing = await readBoundary(slot, { at: end, env, allowDelayed: delay > 0 });
  } catch (error) {
    if (now < retryUntil) throw error;
  }
  if (!closing && now < retryUntil) return 'waiting_for_close';
  return transaction(client => settleFestivalMarket(client, { row, slot, closing }));
}

export async function runTradingFestivalTick({
  sql,
  clock = Date.now,
  env = process.env,
  readBoundary = readFestivalBoundary,
  transaction = withTransaction,
}) {
  if (env.VERCEL_ENV !== 'production' || env.TRADING_FESTIVAL_ENABLED !== '1') return null;
  const now = clock();
  const existing = await readFestivalMarkets(sql);
  const byKey = new Map(existing.map(row => [row.source_event_id, row]));
  return Promise.all(FESTIVAL_SCHEDULE.map(async slot => {
    if (slot.replay) return { key: slot.key, status: 'presentation' };
    try {
      let row = byKey.get(slot.key);
      const dataDelayMinutes = festivalDataDelayMinutes(slot, env);
      const pendingMarketChanged = row?.status === 'pending' && (
        Date.parse(row.start_time) !== Date.parse(slot.startTime)
        || Date.parse(row.end_time) !== Date.parse(slot.endTime)
        || festivalMarketMeta(row)?.dataDelayMinutes !== dataDelayMinutes
      );
      if (festivalFeedEnabled(slot, env) && now < Date.parse(slot.endTime) && (!row || pendingMarketChanged)) {
        await seedFestivalMarket(sql, slot, dataDelayMinutes);
        row = (await readFestivalMarkets(sql)).find(market => market.source_event_id === slot.key);
      }
      if (!row || (row.status !== 'pending' && row.status !== 'active')) {
        return { key: slot.key, status: row?.status ?? 'unavailable' };
      }
      const status = await processFestivalMarket(sql, { row, slot, now, clock, env, readBoundary, transaction });
      return { key: slot.key, status };
    } catch (error) {
      console.error('[trading-festival] lifecycle failed', { key: slot.key, message: error.message });
      return { key: slot.key, status: 'error' };
    }
  }));
}
