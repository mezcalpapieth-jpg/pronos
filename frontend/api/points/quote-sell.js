/**
 * POST /api/points/quote-sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Read-only sell quote. Sells have no fee in the points app, so the
 * `fee` field always returns 0 but we keep the field for UI uniformity.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { cryptoTradeLock } from '../_lib/points-crypto-trade-guard.js';
import { previewHybridSell } from '../_lib/points-trade-router.js';
import { readSession } from '../_lib/session.js';
import { tournamentCutoffSnapshotLock } from '../_lib/points-tournament-entry.js';
import { TOURNAMENT_APPROVED_MARKET_START_ISO } from '../_lib/points-tournament-config.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `quote-sell:${clientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return;

  const { marketId, outcomeIndex, shares } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const n = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'invalid_shares' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT m.status, m.reserves, m.end_time, m.resolver_config,
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

    const reserves = parseJsonb(r.reserves, []).map(Number);
    if (reserves.length < 2) return res.status(400).json({ error: 'degenerate_reserves' });
    if (oi >= reserves.length) return res.status(400).json({ error: 'invalid_outcome_index' });

    const pricesBefore = reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
    const priceBefore = pricesBefore[oi] || 0;

    const username = readSession(req, res)?.username || null;
    const bidRows = await sql`
      SELECT id, username, limit_price, remaining_amount, created_at
        FROM points_limit_orders
       WHERE market_id = ${mid}
         AND outcome_index = ${oi}
         AND side = 'buy'
         AND status = 'open'
         AND remaining_amount > 0
         AND (${username}::text IS NULL OR username <> ${username})
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY limit_price DESC, created_at ASC, id ASC
       LIMIT 24
    `;
    const orderbook = previewHybridSell(bidRows, {
      reserves, outcomeIndex: oi, shares: n, username,
    });
    const { collateralOut, avgPrice, priceAfter } = orderbook;
    return res.status(200).json({
      shares: n,
      gross: collateralOut,
      fee: 0,
      feePct: 0,
      collateralOut,
      avgPrice,
      priceBefore,
      priceAfter,
      priceImpactPts: (priceAfter - priceBefore) * 100,
      orderbookFillCount: orderbook.fills.filter(fill => fill.source === 'limit').length,
    });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-math') || msg.includes('drain')) {
      return res.status(400).json({ error: 'invalid_quote', detail: e.message });
    }
    console.error('[points/quote-sell] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'quote_failed' });
  }
}
