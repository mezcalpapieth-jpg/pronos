/**
 * POST /api/protocol/buy
 * Body: { marketId, outcomeIndex, collateral, minSharesOut?, maxAvgPrice? }
 *
 * MVP-only endpoint: dispatches an on-chain buy via Turnkey delegated
 * signing. The DB write is the indexer's job — this endpoint:
 *   1. Resolves the market from `protocol_markets` by DB row id
 *   2. Looks up the user's Turnkey suborg + wallet address
 *   3. Calls buyOnChain() which approves collateral (idempotent) +
 *      signs + broadcasts + parses the SharesBought event
 *   4. Returns { txHash, sharesOut, fee, blockNumber }
 *
 * The indexer (running every minute) sees SharesBought and writes
 * to `trades` + `outcome_positions` tables. Until that fires, the
 * UI relies on the response payload to render an optimistic update.
 *
 * This endpoint is on-chain ONLY. The off-chain points-app uses
 * /api/points/buy.js — completely separate ledger.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { buyOnChain, quoteBuyOnChain } from '../_lib/onchain-trader.js';
import { seriesTradeLockFromRows } from '../_lib/series-markets.js';
import {
  defaultMinSharesOut,
  enforceProtocolBuySlippage,
  optionalFiniteNumber,
} from '../_lib/protocol-trade-guards.js';

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
    key: `protocol-buy:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const { marketId, outcomeIndex, collateral, minSharesOut, maxAvgPrice } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ error: 'invalid_amount' });

  try {
    // Resolve the market — must be active + on-chain (has pool_address).
    const marketRows = await sql`
      SELECT id, question, status, pool_address, outcomes, outcome_count, start_time,
             end_time, created_at, protocol_version, chain_id, resolver_type,
             resolver_config, sport, league
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.status !== 'active') {
      return res.status(400).json({ error: 'market_closed' });
    }
    if (!m.pool_address) {
      return res.status(400).json({ error: 'market_missing_pool' });
    }
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
    if (oi >= outcomes.length) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }
    const quote = await quoteBuyOnChain({
      market: { chain_address: m.pool_address, outcomes },
      outcomeIndex: oi,
      collateral: amt,
    });
    enforceProtocolBuySlippage({ quote, minSharesOut, maxAvgPrice });
    const txMinSharesOut = optionalFiniteNumber(minSharesOut)
      ?? defaultMinSharesOut(quote);

    // Resolve the user's EVM wallet via the suborg → points_users mapping.
    // We share the users table with points-app for auth; only the DB
    // schemas (protocol_markets vs points_markets) are split.
    const userRows = await sql`
      SELECT wallet_address FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const ownerAddr = userRows[0]?.wallet_address;
    if (!ownerAddr) {
      return res.status(400).json({ error: 'wallet_not_found' });
    }

    const result = await buyOnChain({
      suborgId: session.sub,
      ownerAddr,
      market: { chain_address: m.pool_address, outcomes },
      outcomeIndex: oi,
      collateral: amt,
      minSharesOut: txMinSharesOut,
    });

    return res.status(200).json({
      ok: true,
      mode: 'protocol',
      sharesOut: result.sharesOut,
      fee: result.fee,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      // Indexer reconciles outcome_positions within ~1min; UI should
      // poll /api/protocol/positions or just optimistic-render.
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/buy] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'buy_failed' });
  }
}
