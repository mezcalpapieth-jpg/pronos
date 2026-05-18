/**
 * POST /api/protocol/quote-buy
 * Body: { marketId, outcomeIndex, collateral }
 *
 * Read-only on-chain AMM quote for the MVP. Uses the live pool's
 * estimateBuy/calculateFee view functions so the modal can send a
 * minSharesOut guard to /api/protocol/buy.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { quoteBuyOnChain } from '../_lib/onchain-trader.js';
import { seriesTradeLockFromRows } from '../_lib/series-markets.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

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
      FROM protocol_markets
     WHERE chain_id = ${market.chain_id}
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

  const limited = rateLimit(req, res, {
    key: `protocol-quote-buy:${clientIp(req)}`,
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
    const rows = await sql`
      SELECT id, question, status, pool_address, outcomes, start_time,
             end_time, created_at, resolver_type, resolver_config, sport,
             league, chain_id
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const m = rows[0];
    if (m.status !== 'active') return res.status(400).json({ error: 'market_closed' });
    if (m.end_time && new Date(m.end_time) <= new Date()) {
      return res.status(400).json({ error: 'market_expired' });
    }
    const seriesLock = await readSeriesTradeLock(m);
    if (seriesLock?.locked) {
      return res.status(400).json({
        error: seriesLock.status === 'not_needed' ? 'series_game_not_needed' : 'series_game_pending',
        detail: seriesLock.summary || seriesLock.reason,
      });
    }

    const outcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
    if (oi >= outcomes.length) return res.status(400).json({ error: 'invalid_outcome_index' });
    if (!m.pool_address) return res.status(400).json({ error: 'market_missing_pool' });

    const quote = await quoteBuyOnChain({
      market: { chain_address: m.pool_address, outcomes },
      outcomeIndex: oi,
      collateral: amt,
    });
    return res.status(200).json(quote);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/quote-buy] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'quote_failed' });
  }
}
