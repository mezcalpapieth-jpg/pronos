/**
 * POST /api/points/quote-buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Pure read-only quote — computes what the user would receive if they
 * bought right now. Never mutates state. Used by the BuyModal to
 * preview price impact + fee.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { seriesTradeLockFromRows } from '../_lib/series-markets.js';
import { cryptoTradeLock } from '../_lib/points-crypto-trade-guard.js';
import {
  tournamentCutoffSnapshotLock,
  tournamentSettlementLock,
} from '../_lib/points-tournament-entry.js';
import { TOURNAMENT_APPROVED_MARKET_START_ISO } from '../_lib/points-tournament-config.js';
import { previewHybridBuy } from '../_lib/points-trade-router.js';
import { readSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function readSeriesTradeLock(market) {
  const cfg = parseJsonb(market.resolver_config, null);
  if (cfg?.source !== 'espn' || !cfg?.leaguePath) return null;
  const anchor = market.start_time || market.end_time || market.created_at;
  if (!anchor) return null;
  const rows = await sql`
    SELECT id, question, outcomes, start_time, end_time,
           status, outcome, resolved_at, final_score,
           resolver_config, sport, league
      FROM points_markets
     WHERE parent_id IS NULL
       AND resolver_type = 'sports_api'
       AND resolver_config->>'source' = 'espn'
       AND resolver_config->>'leaguePath' = ${cfg.leaguePath}
       AND start_time >= ${anchor}::timestamptz - INTERVAL '45 days'
       AND start_time <= ${anchor}::timestamptz + INTERVAL '45 days'
     ORDER BY start_time ASC NULLS LAST, id ASC
     LIMIT 80
  `;
  return seriesTradeLockFromRows(market, rows);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Quote is cheap but a bot could spam it on the BuyModal debounce. Cap
  // at 60/min/IP so legit users can retype prices freely without hitting.
  const limited = rateLimit(req, res, {
    key: `quote-buy:${clientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return;

  const { marketId, outcomeIndex, collateral } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: 'invalid_amount' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT m.id, m.question, m.status, m.reserves, m.outcomes, m.start_time, m.end_time,
             m.created_at, m.resolver_type, m.resolver_config, m.sport, m.league,
             m.seed_liquidity, m.seed_liquidities,
             (
               m.tournament_featured IS TRUE
               OR p.tournament_featured IS TRUE
               OR COALESCE(pm.reviewed_at, p.created_at, m.created_at) >= ${TOURNAMENT_APPROVED_MARKET_START_ISO}::timestamptz
             ) AS tournament_featured
      FROM points_markets m
      LEFT JOIN points_markets p ON p.id = m.parent_id
      LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
      WHERE m.id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const r = rows[0];
    if (r.status !== 'active') return res.status(400).json({ error: 'market_closed' });
    if (r.end_time && new Date(r.end_time) <= new Date()) {
      return res.status(400).json({ error: 'market_expired' });
    }
    const tournamentLock = tournamentSettlementLock(r);
    if (tournamentLock) {
      return res.status(tournamentLock.status).json({
        error: tournamentLock.error,
        detail: tournamentLock.detail,
      });
    }
    const snapshotLock = await tournamentCutoffSnapshotLock(sql, r);
    if (snapshotLock) {
      return res.status(snapshotLock.status).json({
        error: snapshotLock.error,
        detail: snapshotLock.detail,
      });
    }
    const cryptoLock = cryptoTradeLock(r);
    if (cryptoLock) {
      return res.status(cryptoLock.status).json({
        error: cryptoLock.error,
        detail: cryptoLock.detail,
      });
    }
    const seriesLock = await readSeriesTradeLock(r);
    if (seriesLock?.locked) {
      return res.status(400).json({
        error: seriesLock.status === 'not_needed' ? 'series_game_not_needed' : 'series_game_pending',
        detail: seriesLock.summary || seriesLock.reason,
      });
    }

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length < 2) {
      return res.status(400).json({ error: 'degenerate_reserves' });
    }
    if (oi >= reserves.length) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }

    const pricesBefore = reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
    const priceBefore = pricesBefore[oi] || 0;

    const username = readSession(req, res)?.username || null;
    const askRows = await sql`
      SELECT id, username, limit_price, remaining_amount, created_at
        FROM points_limit_orders
       WHERE market_id = ${mid}
         AND outcome_index = ${oi}
         AND side = 'sell'
         AND status = 'open'
         AND remaining_amount > 0
         AND (${username}::text IS NULL OR username <> ${username})
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY limit_price ASC, created_at ASC, id ASC
       LIMIT 24
    `;
    const orderbook = previewHybridBuy(askRows, {
      reserves, outcomeIndex: oi, collateral: amt, username,
    });
    const { sharesOut, fee, avgPrice, priceAfter } = orderbook;
    const collateralSpent = orderbook.collateralSpent;
    const pricesAfter = reserves.length === 2
      ? binaryPrices(orderbook.reservesAfter)
      : multiPrices(orderbook.reservesAfter);
    return res.status(200).json({
      collateral: collateralSpent,
      fee,
      feePct: collateralSpent > 0 ? (fee / collateralSpent) * 100 : 0,
      sharesOut,
      avgPrice,
      priceBefore,
      priceAfter,
      priceImpactPts: (priceAfter - priceBefore) * 100,
      pricesBefore,
      pricesAfter,
      orderbookFillCount: orderbook.fills.filter(fill => fill.source === 'limit').length,
    });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-math')) {
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }
    console.error('[points/quote-buy] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'quote_failed' });
  }
}
