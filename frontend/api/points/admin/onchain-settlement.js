import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { signDelegatedTransaction } from '../../_lib/turnkey-delegation.js';
import { tradeRequestKey } from '../../_lib/trade-requests.js';
import { settlementSettings, settlementInput, assertSettlementMarket, settleOnchainMarket } from '../../_lib/onchain-admin-settlement.js';

export function createSettlementHandler({ env = process.env, sqlFor = neon,
  providerFor = () => new ethers.providers.JsonRpcProvider({ url: env.ONCHAIN_RPC_URL, timeout: 10000 }),
  sign = signDelegatedTransaction, settle = settleOnchainMarket, adminFor = requirePointsAdmin } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const admin = adminFor(req, res);
    if (!admin) return;
    const settings = settlementSettings(env);
    if (!settings.enabled) return res.status(403).json({ error: 'onchain_settlement_disabled' });
    if (!settings.configured) return res.status(503).json({ error: 'onchain_settlement_unavailable' });
    if (Object.keys(req.query || {}).length) return res.status(400).json({ error: 'query_overrides_forbidden' });
    if (rateLimit(req, res, { key: `onchain-settlement:${admin.username}:${clientIp(req)}`, limit: 20, windowMs: 60000 })) return;
    try {
      const input = req.method === 'POST' ? settlementInput(req.body) : null;
      const key = input ? tradeRequestKey(req) : null;
      const sql = sqlFor(env.DATABASE_URL);
      if (input) {
        const result = await settle({ sql, provider: providerFor(), env, input, key, sign, actor: admin.username });
        return res.status(result.httpStatus).json(result.body);
      }
      const rows = await sql`SELECT p.id AS points_id, p.mode, p.chain_id AS points_chain_id,
          p.chain_address, p.chain_market_id, p.parent_id, p.amm_mode, p.question,
          m.id AS protocol_id, m.chain_id, m.factory_address, m.pool_address, m.market_id AS contract_id,
          m.protocol_version, m.outcome_count, m.outcomes, m.status, m.outcome,
          c.last_block::text AS indexed_block
        FROM points_markets p LEFT JOIN protocol_markets m ON m.chain_id=p.chain_id
          AND LOWER(m.pool_address)=LOWER(p.chain_address) AND m.market_id::text=p.chain_market_id::text
        LEFT JOIN indexer_factory_state c ON c.chain_id=m.chain_id AND LOWER(c.factory_address)=LOWER(m.factory_address)
        WHERE p.mode='onchain' AND p.chain_id=421614 AND p.parent_id IS NULL
        ORDER BY p.id DESC LIMIT 201`;
      const counts = new Map();
      rows.forEach(m => counts.set(m.points_id, (counts.get(m.points_id) || 0) + 1));
      const markets = rows.slice(0,200).map(m => {
        let ready = true;
        try { assertSettlementMarket(m, env); if (counts.get(m.points_id) !== 1) ready = false; } catch { ready = false; }
        return { id: Number(m.points_id), question: m.question, status: ready ? m.status : 'unavailable',
          outcomes: Array.isArray(m.outcomes) ? m.outcomes : [],
          outcome: ready && m.outcome != null ? Number(m.outcome)-(m.protocol_version === 'v1' ? 1 : 0) : null,
          settlementReady: ready, factory: m.factory_address, indexedBlock: m.indexed_block };
      });
      const runs = await sql`SELECT status,started_at,completed_at,report FROM sepolia_resolver_runs ORDER BY started_at DESC LIMIT 1`;
      const requests = await sql`SELECT r.request_key, r.action, r.status, r.payload->>'marketId' AS market_id,
          r.payload->>'reason' AS reason, r.payload->'outcome' AS requested_outcome,
          r.payload->>'origin' AS origin, r.plan->>'actor' AS actor, r.updated_at, r.result,
          t.tx_hash, t.receipt->>'blockNumber' AS block_number
        FROM sepolia_trade_requests r LEFT JOIN sepolia_trade_transactions t ON t.request_id=r.id AND t.step='trade'
        WHERE r.chain_id=421614 AND r.action LIKE 'admin_%'
        ORDER BY (r.status IN ('created','validated','pending','needs_reconciliation')) DESC, r.created_at DESC LIMIT 51`;
      return res.status(200).json({ chainId: 421614, scheduler:{enabled:env.ONCHAIN_RESOLVER_SCHEDULE_ENABLED==='true',
        latest:runs[0]?{status:runs[0].status,startedAt:runs[0].started_at,completedAt:runs[0].completed_at,report:runs[0].report}:null}, markets, marketsTruncated: rows.length>200,
        requestsTruncated: requests.length>50, requests: requests.slice(0,50).map(r => {
          const m = markets.find(m => m.id === Number(r.market_id)), result = r.result;
          const expected = { resolve:'resolved',correct_resolution:'resolved',cancel:'canceled',dispute:'disputed',clear_dispute:'resolved' }[r.action.slice(6)];
          const indexed = r.status === 'confirmed' && m?.settlementReady && m.status === expected
            && r.block_number != null && Number(m.indexedBlock) >= Number(r.block_number)
            && (!['resolve','correct_resolution'].includes(r.action.slice(6)) || m.outcome === result?.outcome);
          return { requestId:r.request_key, marketId:Number(r.market_id), action:r.action.slice(6), status:r.status,
            input:{ marketId:Number(r.market_id),action:r.action.slice(6),outcome:r.requested_outcome,reason:r.reason },
            origin:r.origin, actor:r.actor, updatedAt:r.updated_at, txHash:r.tx_hash, blockNumber:r.block_number,
            awaitingIndexing:r.status==='confirmed' && (!m?.settlementReady || r.block_number==null
              || m.indexedBlock==null || Number(m.indexedBlock)<Number(r.block_number)),
            indexingStatus:indexed?'indexed':'pending_or_superseded' };
        }) });
    } catch (error) {
      // Never forward signer, database or RPC errors containing credentials.
      const safe = /^(?:(?:onchain|settlement|invalid|idempotency|trade)_[a-z0-9_]+|market_not_found|ambiguous_settlement_market)$/.test(error.message || '');
      return res.status(safe && error.status ? error.status : 503).json({ error: safe ? error.message : 'onchain_settlement_unavailable' });
    }
  };
}
export default createSettlementHandler();
