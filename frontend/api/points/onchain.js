// Preview-only, read-only bridge between Points metadata and indexed protocol
// state. This endpoint never provisions accounts, grants policies or moves funds.
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { pendingApprovalSettings } from '../_lib/onchain-preview-approval.js';
import { marketView, portfolioView, jsonArray } from '../_lib/points-onchain-view.js';
import { tradingFactories } from '../_lib/trading-router.js';
import { lateJoinSettings } from '../_lib/sepolia-tournament-user-join.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const addressPattern = /^0x[0-9a-f]{40}$/i;
const bounded = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));
const rowsOf = value => Array.isArray(value) ? value : value?.rows || [];

export function adapterSettings(env = process.env) {
  const settings = pendingApprovalSettings(env);
  const factories = tradingFactories(env);
  const currentValid = [env.ONCHAIN_MARKET_FACTORY_ADDRESS, env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS].every(value => addressPattern.test(value || '') && !/^0x0{40}$/i.test(value));
  return { enabled: settings.previewEnabled && currentValid && addressPattern.test(env.ONCHAIN_COLLATERAL_ADDRESS || ''),
    chainId: settings.chainId, factories, collateral: env.ONCHAIN_COLLATERAL_ADDRESS || null, symbol: 'MXNP' };
}

async function mappings(settings, ids = null) {
  const rows = rowsOf(await sql`
    SELECT pm.id, pm.mode, pm.chain_id, pm.chain_address, pm.chain_market_id,
           pm.question, pm.category, pm.outcomes, pm.status, pm.end_time,
           pm.parent_id, pm.leg_label, parent.question AS parent_question,
           m.id AS protocol_id, m.market_id AS contract_market_id,
           m.chain_id AS protocol_chain_id, m.pool_address, m.factory_address,
           m.outcomes AS protocol_outcomes, m.protocol_version, m.status AS protocol_status,
           m.outcome AS protocol_outcome, m.end_time AS protocol_end_time,
           s.prices, s.yes_price, s.no_price, s.volume_24h, s.liquidity, s.snapshot_at
      FROM points_markets pm
      LEFT JOIN points_markets parent ON parent.id = pm.parent_id
      LEFT JOIN protocol_markets m ON COALESCE(pm.mode, 'points') = 'onchain'
       AND pm.chain_id = m.chain_id AND LOWER(pm.chain_address) = LOWER(m.pool_address)
       AND m.chain_id = ${settings.chainId}
       AND LOWER(m.factory_address) = ANY(${settings.factories}::text[])
      LEFT JOIN LATERAL (
        SELECT prices, yes_price, no_price, volume_24h, liquidity, snapshot_at
          FROM price_snapshots WHERE market_id = m.id ORDER BY snapshot_at DESC LIMIT 1
      ) s ON TRUE
     WHERE (${ids}::int[] IS NULL AND pm.mode = 'onchain' AND pm.chain_id = ${settings.chainId})
        OR pm.id = ANY(${ids}::int[]) OR pm.parent_id = ANY(${ids}::int[])
     ORDER BY pm.id LIMIT 2001
  `);
  if (rows.length > 2000) throw Object.assign(new Error('onchain_read_limit'), { status: 503 });
  const markets = rows.map(marketView);
  const seen = new Set();
  const pools = new Set();
  for (const market of markets) {
    const key = `${market.chainId}:${market.chainAddress?.toLowerCase()}`;
    if (seen.has(market.id) || (market.protocolMarketId && pools.has(key))) {
      throw Object.assign(new Error('onchain_mapping_ambiguous'), { status: 503 });
    }
    seen.add(market.id);
    if (market.protocolMarketId) pools.add(key);
  }
  return markets;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const settings = adapterSettings();
  const action = String(req.query.action || 'config');
  if (action === 'config') return res.status(200).json({ enabled: settings.enabled,
    chainId: settings.enabled ? settings.chainId : null, symbol: settings.symbol,
    lateJoining: settings.enabled && lateJoinSettings().configured });
  if (!settings.enabled) return res.status(403).json({ error: 'onchain_preview_disabled' });
  if (rateLimit(req, res, { key: `points-onchain:${clientIp(req)}`, windowMs: 60000, limit: 120 })) return;
  try {
    if (action === 'balance' || action === 'portfolio') {
      const session = requireSession(req, res);
      if (!session) return;
      const users = rowsOf(await sql`SELECT wallet_address FROM points_users WHERE turnkey_sub_org_id = ${session.sub} LIMIT 1`);
      const wallet = users[0]?.wallet_address?.toLowerCase();
      if (!addressPattern.test(wallet || '')) return res.status(400).json({ error: 'wallet_not_found' });
      if (action === 'balance') {
        if (!process.env.ONCHAIN_RPC_URL) return res.status(503).json({ error: 'onchain_balance_unavailable' });
        try {
          const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
          const network = await provider.getNetwork();
          if (Number(network.chainId) !== settings.chainId) throw new Error('wrong_chain');
          const token = new ethers.Contract(settings.collateral, ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'], provider);
          const [balance, decimals] = await Promise.all([token.balanceOf(wallet), token.decimals()]);
          return res.status(200).json({ mode: 'onchain', chainId: settings.chainId, symbol: settings.symbol,
            balance: ethers.utils.formatUnits(balance, decimals) });
        } catch { return res.status(503).json({ error: 'onchain_balance_unavailable' }); }
      }
      const markets = (await mappings(settings)).filter(m => m.protocolMarketId);
      const protocolIds = markets.map(m => m.protocolMarketId);
      const [trades, redemptions] = await Promise.all([
        sql`SELECT market_id, side, is_yes, outcome_index, collateral_amt, shares_amt, fee_amt, block_number, log_index, created_at
              FROM trades WHERE market_id = ANY(${protocolIds}::int[]) AND LOWER(trader) = ${wallet}
              ORDER BY block_number, log_index LIMIT 10001`,
        sql`SELECT market_id, outcome_index, shares, payout, block_number, log_index, created_at
              FROM redemptions WHERE market_id = ANY(${protocolIds}::int[]) AND LOWER(user_address) = ${wallet}
              ORDER BY block_number, log_index LIMIT 10001`,
      ]);
      if (rowsOf(trades).length > 10000 || rowsOf(redemptions).length > 10000) {
        return res.status(503).json({ error: 'onchain_read_limit' });
      }
      return res.status(200).json(portfolioView(markets, rowsOf(trades), rowsOf(redemptions)));
    }
    if (!['markets', 'prices', 'activity', 'tape'].includes(action)) return res.status(400).json({ error: 'invalid_action' });
    const ids = String(req.query.ids || '').split(',').map(Number);
    if (!ids.length || ids.length > 200 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      return res.status(400).json({ error: 'invalid_market_ids' });
    }
    const markets = await mappings(settings, [...new Set(ids)]);
    if (action === 'markets') return res.status(200).json({ markets });
    const protocolIds = markets.filter(m => m.protocolMarketId).map(m => m.protocolMarketId);
    const hours = bounded(req.query.hours || Number(req.query.days || 1) * 24, 24, 24 * 365);
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const outcome = Math.max(0, Math.min(7, Number(req.query.outcome) || 0));
    const allOutcomes = req.query.outcome === 'all';
    const limit = Math.floor(bounded(req.query.limit, 200, 500));
    if (action === 'prices') {
      const rows = rowsOf(await sql`
        SELECT m.id, s.yes_price, s.no_price, s.prices, s.snapshot_at
          FROM protocol_markets m CROSS JOIN LATERAL (
            SELECT yes_price, no_price, prices, snapshot_at FROM price_snapshots
             WHERE market_id = m.id AND snapshot_at >= ${since}::timestamptz
             ORDER BY snapshot_at DESC LIMIT ${limit}
          ) s WHERE m.id = ANY(${protocolIds}::int[]) ORDER BY s.snapshot_at
      `);
      const history = {};
      for (const m of markets) history[m.id] = rows.filter(r => Number(r.id) === m.protocolMarketId).flatMap(r => {
        const price = jsonArray(r.prices)[outcome] ?? (outcome === 0 ? r.yes_price : outcome === 1 ? r.no_price : null);
        return price == null ? [] : [{ t: Math.floor(new Date(r.snapshot_at).getTime() / 1000), p: Number(price) * 100 }];
      });
      return res.status(200).json({ history });
    }
    const rows = rowsOf(await sql`
      SELECT market_id, side, is_yes, outcome_index, collateral_amt, shares_amt, fee_amt, created_at,
             block_number, log_index FROM trades
       WHERE market_id = ANY(${protocolIds}::int[]) AND created_at >= ${since}::timestamptz
       ORDER BY block_number DESC, log_index DESC LIMIT 10001
    `);
    if (rows.length > 10000) return res.status(503).json({ error: 'onchain_read_limit' });
    const tape = {}, activity = {};
    const buckets = Math.floor(bounded(req.query.buckets, 48, 200));
    const start = new Date(since).getTime();
    const width = hours * 3600000 / buckets;
    for (const id of ids) {
      const related = markets.filter(m => m.id === id || m.parentMarketId === id);
      const byProtocol = new Map(related.map(m => [m.protocolMarketId, m]));
      const relevant = rows.filter(r => byProtocol.has(Number(r.market_id)));
      tape[id] = relevant.slice(0, limit).map(r => {
        const m = byProtocol.get(Number(r.market_id));
        const index = r.outcome_index == null ? (r.is_yes ? 0 : 1) : Number(r.outcome_index);
        return { marketId: m.id, side: r.side, outcomeIndex: index,
          outcomeLabel: m.legLabel || m.outcomes[index], outcomeDisplayLabel: m.legLabel ? `${m.legLabel} · ${m.outcomes[index]}` : m.outcomes[index],
          shares: Number(r.shares_amt), collateral: Number(r.collateral_amt), fee: Number(r.fee_amt),
          createdAt: r.created_at, username: null };
      });
      const bins = new Map();
      for (const r of relevant) {
        const index = r.outcome_index == null ? (r.is_yes ? 0 : 1) : Number(r.outcome_index);
        if (!allOutcomes && index !== outcome) continue;
        const bucket = Math.floor((new Date(r.created_at).getTime() - start) / width);
        const bin = bins.get(bucket) || { t: Math.floor((start + bucket * width) / 1000), count: 0, volume: 0, buyVolume: 0, sellVolume: 0 };
        bin.count += 1; bin.volume += Number(r.collateral_amt);
        bin[r.side === 'buy' ? 'buyVolume' : 'sellVolume'] += Number(r.collateral_amt);
        bins.set(bucket, bin);
      }
      activity[id] = [...bins.values()].sort((a, b) => a.t - b.t);
    }
    return res.status(200).json(action === 'tape' ? { tape } : { activity });
  } catch (error) {
    console.error('[points-onchain]', error.message);
    return res.status(error.status || 503).json({ error: error.status ? error.message : 'onchain_read_unavailable' });
  }
}
