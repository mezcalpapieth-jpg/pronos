/**
 * Server-side final chart snapshots for crypto 5-minute markets.
 *
 * Why this exists:
 * - `crypto_ticks` is short-retention history from cron plus active browsers.
 * - Once a market resolves, we want to freeze the exact curve we have so
 *   later page loads do not depend on live tick retention or sparse reads.
 * - We keep the snapshot in its own table so `points_markets` rows stay
 *   light; list endpoints frequently select `m.*`.
 *
 * Callers should use the best-effort wrapper from inside an existing
 * transaction after the market has been resolved and `closePrice` has been
 * written into resolver_config.
 */

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const out = [];
  for (const p of points) {
    const t = Number(p?.t);
    const price = Number(p?.price);
    if (!Number.isFinite(t) || !Number.isFinite(price)) continue;
    out.push({ t, price });
  }
  out.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const p of out) {
    if (deduped.length > 0 && deduped[deduped.length - 1].t === p.t) {
      deduped[deduped.length - 1] = p;
    } else {
      deduped.push(p);
    }
  }
  return deduped;
}

function isTrustedClosePriceSource(source) {
  const value = String(source || '').toLowerCase();
  return value === 'coinbase-candle' || value === 'coinbase-candle-correction';
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : NaN;
}

function buildSnapshotPoints({
  tickRows,
  openedAt,
  closesAt,
  openPrice,
  closePrice,
  closePriceSource = null,
  closePriceAt = null,
}) {
  const openedAtMs = openedAt ? new Date(openedAt).getTime() : NaN;
  const closesAtMs = dateMs(closesAt);

  const base = normalizePoints((tickRows || []).map((row) => ({
    t: new Date(row.captured_at).getTime(),
    price: Number(row.price),
  })));

  if (Number.isFinite(openedAtMs) && Number.isFinite(Number(openPrice))) {
    if (base.length === 0 || base[0].t > openedAtMs) {
      base.unshift({ t: openedAtMs, price: Number(openPrice) });
    }
  }

  if (
    Number.isFinite(closesAtMs)
    && Number.isFinite(Number(closePrice))
    && isTrustedClosePriceSource(closePriceSource)
  ) {
    const closePriceAtMs = dateMs(closePriceAt);
    const closeT = Number.isFinite(closePriceAtMs) && Math.abs(closePriceAtMs - closesAtMs) <= 90_000
      ? closePriceAtMs
      : closesAtMs;
    const nextClose = { t: closeT, price: Number(closePrice) };
    const lastT = base.length > 0 ? base[base.length - 1].t : -Infinity;
    if (lastT >= closeT - 30_000) {
      if (base.length === 0) base.push(nextClose);
      else base[base.length - 1] = nextClose;
    } else {
      base.push(nextClose);
    }
  }

  return normalizePoints(base);
}

export async function persistResolvedCryptoMarketSnapshot(client, marketId) {
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return { stored: false, reason: 'invalid_market_id' };
  }

  const marketRes = await client.query(
    `SELECT id, start_time, end_time, resolver_config
       FROM points_markets
      WHERE id = $1
      LIMIT 1`,
    [mid],
  );
  if (marketRes.rows.length === 0) {
    return { stored: false, reason: 'market_not_found' };
  }

  const market = marketRes.rows[0];
  const cfg = parseJsonb(market.resolver_config, null);
  if (cfg?.shape !== 'binary-direction') {
    return { stored: false, reason: 'not_crypto_market' };
  }

  const asset = String(cfg.asset || '').toLowerCase();
  const openedAt = cfg.openedAt || market.start_time || null;
  const closesAt = cfg.closesAt || market.end_time || null;
  if (!asset || !openedAt || !closesAt) {
    return { stored: false, reason: 'missing_window' };
  }

  const ticks = await client.query(
    `SELECT captured_at, price
       FROM crypto_ticks
      WHERE asset = $1
        AND captured_at >= $2::timestamptz
        AND captured_at <= $3::timestamptz
      ORDER BY captured_at ASC`,
    [asset, openedAt, closesAt],
  );

  const points = buildSnapshotPoints({
    tickRows: ticks.rows,
    openedAt,
    closesAt,
    openPrice: cfg.openPrice,
    closePrice: cfg.closePrice,
    closePriceSource: cfg.closePriceSource,
    closePriceAt: cfg.closePriceAt,
  });

  if (points.length === 0) {
    return { stored: false, reason: 'no_points' };
  }

  await client.query(
    `INSERT INTO points_crypto_market_snapshots (
       market_id, asset, opened_at, closes_at, points, updated_at
     )
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5::jsonb, NOW())
     ON CONFLICT (market_id) DO UPDATE
       SET asset = EXCLUDED.asset,
           opened_at = EXCLUDED.opened_at,
           closes_at = EXCLUDED.closes_at,
           points = EXCLUDED.points,
           updated_at = NOW()`,
    [mid, asset, openedAt, closesAt, JSON.stringify(points)],
  );

  return {
    stored: true,
    marketId: mid,
    asset,
    pointCount: points.length,
  };
}

export async function bestEffortPersistResolvedCryptoMarketSnapshot(client, marketId, logLabel = 'crypto-chart-snapshot') {
  if (!client) return { stored: false, reason: 'missing_client' };

  const savepoint = 'crypto_chart_snapshot';
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await persistResolvedCryptoMarketSnapshot(client, marketId);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (e) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } catch (rollbackErr) {
      console.warn(`[${logLabel}] savepoint rollback failed`, {
        marketId,
        message: rollbackErr?.message,
        code: rollbackErr?.code,
      });
    }
    try {
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    } catch { /* ignore */ }

    console.warn(`[${logLabel}] snapshot persist skipped`, {
      marketId,
      message: e?.message,
      code: e?.code,
    });
    return {
      stored: false,
      reason: 'persist_failed',
      error: e?.message || null,
    };
  }
}
