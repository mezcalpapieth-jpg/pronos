import { binaryPrices, multiPrices } from './amm-math.js';
import { binaryPricesWithBookTrade } from './points-display-prices.js';
import { PRONOS_TREASURY_USERNAME } from './points-limit-orders.js';

const DEFAULT_TOP_HOLDERS_LIMIT = 50;

function clampLimit(limit, fallback = DEFAULT_TOP_HOLDERS_LIMIT) {
  return Math.min(50, Math.max(1, Math.floor(Number(limit) || fallback)));
}

function parseJsonb(v, fb) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function outcomeIndexOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function pricesForReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length === 0) return [];
  if (reserves.length === 2) return binaryPrices(reserves);
  return multiPrices(reserves);
}

function normalizeHolder(h) {
  const payoutValue = Number(h?.payoutValue);
  return {
    username: String(h?.username || '').trim(),
    outcomeIndex: Number.isInteger(Number(h?.outcomeIndex)) ? Number(h.outcomeIndex) : undefined,
    outcomeLabel: String(h?.outcomeLabel || ''),
    shares: round(h?.shares, 2),
    costBasis: round(h?.costBasis, 2),
    value: round(h?.value, 2),
    ...(Number.isFinite(payoutValue) ? { payoutValue: round(payoutValue, 2) } : {}),
  };
}

function normalizeHolderList(holders, limit) {
  const max = clampLimit(limit);
  return (Array.isArray(holders) ? holders : [])
    .map(normalizeHolder)
    .filter(h => h.username && h.outcomeLabel)
    .slice(0, max);
}

async function marketRow(client, marketId) {
  const result = await client.query(
    `SELECT m.id, m.parent_id, m.outcomes, m.reserves, m.amm_mode, m.status, m.outcome,
            (SELECT t.outcome_index
               FROM points_trades t
              WHERE t.market_id = m.id
                AND t.username <> $2
                AND t.price_at_trade IS NOT NULL
              ORDER BY t.created_at DESC, t.id DESC
              LIMIT 1) AS display_trade_outcome_index,
            (SELECT t.price_at_trade
               FROM points_trades t
              WHERE t.market_id = m.id
                AND t.username <> $2
                AND t.price_at_trade IS NOT NULL
              ORDER BY t.created_at DESC, t.id DESC
              LIMIT 1) AS display_trade_price,
            (SELECT (t.reserves_before IS NOT NULL AND t.reserves_after IS NOT NULL AND t.reserves_before = t.reserves_after)
               FROM points_trades t
              WHERE t.market_id = m.id
                AND t.username <> $2
                AND t.price_at_trade IS NOT NULL
              ORDER BY t.created_at DESC, t.id DESC
              LIMIT 1) AS display_trade_is_book
       FROM points_markets m
      WHERE m.id = $1
      LIMIT 1`,
    [marketId, PRONOS_TREASURY_USERNAME],
  );
  return result.rows[0] || null;
}

function displayPricesForMarket(row) {
  const reserves = parseJsonb(row?.reserves, []).map(Number);
  const basePrices = pricesForReserves(reserves);
  return basePrices.length === 2
    ? binaryPricesWithBookTrade(basePrices, {
        status: row?.status,
        outcomeIndex: row?.display_trade_outcome_index,
        price: row?.display_trade_price,
        isBookTrade: row?.display_trade_is_book,
      })
    : basePrices;
}

export async function readTopHolderSnapshot(client, marketId, { limit = DEFAULT_TOP_HOLDERS_LIMIT } = {}) {
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) return null;
  const result = await client.query(
    `SELECT market_id, amm_mode, outcomes, holders, snapshotted_at
       FROM points_top_holder_snapshots
      WHERE market_id = $1
      LIMIT 1`,
    [mid],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    marketId: Number(row.market_id),
    ammMode: row.amm_mode || 'unified',
    outcomes: parseJsonb(row.outcomes, []),
    holders: normalizeHolderList(parseJsonb(row.holders, []), limit),
    snapshottedAt: row.snapshotted_at,
    frozen: true,
  };
}

export async function buildTopHoldersForMarket(client, marketId, {
  limit = DEFAULT_TOP_HOLDERS_LIMIT,
  resolution = null,
} = {}) {
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    const err = new Error('invalid_market_id');
    err.status = 400;
    throw err;
  }

  const m = await marketRow(client, mid);
  if (!m) {
    const err = new Error('market_not_found');
    err.status = 404;
    throw err;
  }
  if (m.parent_id) {
    const err = new Error('leg_not_addressable');
    err.status = 400;
    err.detail = 'use parent id';
    throw err;
  }

  const parentOutcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
  const ammMode = m.amm_mode || 'unified';
  const isResolved = m.status === 'resolved';
  const winningIdx = isResolved ? outcomeIndexOrNull(m.outcome) : null;
  const parentWinningIdx = outcomeIndexOrNull(resolution?.winningOutcomeIndex);
  const independentLegOutcomes = Array.isArray(resolution?.independentLegOutcomes)
    ? resolution.independentLegOutcomes.map(outcomeIndexOrNull)
    : null;
  const max = clampLimit(limit);

  if (ammMode === 'parallel') {
    const legsResult = await client.query(
      `SELECT l.id, l.reserves, l.status, l.outcome, l.leg_label,
              (SELECT t.outcome_index
                 FROM points_trades t
                WHERE t.market_id = l.id
                  AND t.username <> $2
                  AND t.price_at_trade IS NOT NULL
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT 1) AS display_trade_outcome_index,
              (SELECT t.price_at_trade
                 FROM points_trades t
                WHERE t.market_id = l.id
                  AND t.username <> $2
                  AND t.price_at_trade IS NOT NULL
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT 1) AS display_trade_price,
              (SELECT (t.reserves_before IS NOT NULL AND t.reserves_after IS NOT NULL AND t.reserves_before = t.reserves_after)
                 FROM points_trades t
                WHERE t.market_id = l.id
                  AND t.username <> $2
                  AND t.price_at_trade IS NOT NULL
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT 1) AS display_trade_is_book
         FROM points_markets l
        WHERE l.parent_id = $1
        ORDER BY l.id ASC`,
      [mid, PRONOS_TREASURY_USERNAME],
    );
    const legs = legsResult.rows;
    if (legs.length === 0) {
      return { ammMode: 'parallel', outcomes: parentOutcomes, holders: [] };
    }

    const legIds = legs.map(l => Number(l.id)).filter(Number.isFinite);
    const positionsResult = await client.query(
      `SELECT p.username, p.market_id, p.outcome_index, p.shares, p.cost_basis
         FROM points_positions p
        WHERE p.market_id = ANY($1::int[])
          AND p.shares > 0`,
      [legIds],
    );
    const legById = new Map(legs.map(leg => [Number(leg.id), leg]));

    const priced = positionsResult.rows.map((p) => {
      const leg = legById.get(Number(p.market_id));
      const legPrices = displayPricesForMarket(leg);
      const oi = Number(p.outcome_index);
      let currentPrice;
      if (leg?.status === 'resolved') currentPrice = Number(leg.outcome) === oi ? 1 : 0;
      else currentPrice = legPrices[oi] ?? 0.5;
      const shares = Number(p.shares);
      const legIndex = legs.findIndex(l => Number(l.id) === Number(p.market_id));
      const independentOutcomeIndex = independentLegOutcomes ? independentLegOutcomes[legIndex] : null;
      let payoutValue;
      if (Number.isInteger(independentOutcomeIndex)) {
        payoutValue = independentOutcomeIndex === oi ? shares : 0;
      } else if (Number.isInteger(parentWinningIdx)) {
        payoutValue = ((legIndex === parentWinningIdx && oi === 0) || (legIndex !== parentWinningIdx && oi === 1)) ? shares : 0;
      } else if (leg?.status === 'resolved') {
        payoutValue = Number(leg.outcome) === oi ? shares : 0;
      }
      return {
        username: p.username,
        outcomeLabel: `${leg?.leg_label || '—'} — ${oi === 0 ? 'Sí' : 'No'}`,
        shares,
        costBasis: Number(p.cost_basis || 0),
        value: shares * currentPrice,
        payoutValue,
      };
    });

    priced.sort((a, b) => b.value - a.value);
    return {
      ammMode: 'parallel',
      outcomes: parentOutcomes,
      holders: normalizeHolderList(priced, max),
    };
  }

  const prices = displayPricesForMarket(m);
  const positionsResult = await client.query(
    `SELECT username, outcome_index, shares, cost_basis
       FROM points_positions
      WHERE market_id = $1
        AND shares > 0`,
    [mid],
  );

  const priced = positionsResult.rows.map((p) => {
    const oi = Number(p.outcome_index);
    let currentPrice;
    if (isResolved) currentPrice = oi === winningIdx ? 1 : 0;
    else currentPrice = prices[oi] ?? 1 / (parentOutcomes.length || 2);
    const shares = Number(p.shares);
    const payoutWinningIdx = Number.isInteger(parentWinningIdx) ? parentWinningIdx : winningIdx;
    return {
      username: p.username,
      outcomeIndex: oi,
      outcomeLabel: parentOutcomes[oi] || `Opción ${oi + 1}`,
      shares,
      costBasis: Number(p.cost_basis || 0),
      value: shares * currentPrice,
      ...(Number.isInteger(payoutWinningIdx) ? { payoutValue: oi === payoutWinningIdx ? shares : 0 } : {}),
    };
  });

  priced.sort((a, b) => b.value - a.value);
  return {
    ammMode: 'unified',
    outcomes: parentOutcomes,
    holders: normalizeHolderList(priced, max),
  };
}

export async function persistTopHolderSnapshot(client, marketId, {
  limit = DEFAULT_TOP_HOLDERS_LIMIT,
  resolution = null,
} = {}) {
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) return { stored: false, reason: 'invalid_market_id' };

  const built = await buildTopHoldersForMarket(client, mid, { limit, resolution });
  await client.query(
    `INSERT INTO points_top_holder_snapshots (
       market_id, amm_mode, outcomes, holders, snapshotted_at
     )
     VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW())
     ON CONFLICT (market_id) DO NOTHING`,
    [
      mid,
      built.ammMode || 'unified',
      JSON.stringify(built.outcomes || []),
      JSON.stringify(built.holders || []),
    ],
  );
  return {
    stored: true,
    marketId: mid,
    holderCount: built.holders?.length || 0,
  };
}

export async function bestEffortPersistTopHolderSnapshot(client, marketId, logLabel = 'top-holder-snapshot', options = {}) {
  if (!client) return { stored: false, reason: 'missing_client' };

  const savepoint = 'top_holder_snapshot';
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await persistTopHolderSnapshot(client, marketId, options);
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
