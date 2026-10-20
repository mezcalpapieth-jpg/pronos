import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { tradeRequestSettings, tradeRequestWallet } from '../_lib/trade-request-runtime.js';
import { tradeRequestStore } from '../_lib/trade-request-store.js';
import { publicTradeRequest, tradeRequestKey } from '../_lib/trade-requests.js';

// Read-only recovery/status surface. POST the original action with its saved
// requestId to advance it; GET never signs, broadcasts, funds or changes rows.
export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const session = requireSession(req, res);
  if (!session?.sub) return;
  const settings = tradeRequestSettings();
  if (!settings.enabled) return res.status(403).json({ error: 'trade_requests_disabled' });
  if (!settings.configured) return res.status(503).json({ error: 'trade_requests_unavailable' });
  if (rateLimit(req, res, { key: `trade-request:${clientIp(req)}`, limit: 120, windowMs: 60000 })) return;
  try {
    const sql = neon(process.env.DATABASE_URL);
    const wallet = await tradeRequestWallet(sql, session.sub);
    if (req.query.action === 'identity') return res.status(200).json({ scope: `421614:${wallet}` });
    const store = tradeRequestStore(sql);
    if (req.query.action === 'pending') {
      const entry = await store.recoverable(wallet, session.sub);
      return res.status(200).json({ request: entry ? { action: entry.action,
        body: { ...entry.payload, requestId: entry.request_key }, sourceMarketId: null } : null });
    }
    const key = tradeRequestKey({ body: { requestId: req.query.requestId } });
    const entry = await store.find(wallet, key);
    if (!entry || entry.suborg_id !== session.sub) return res.status(404).json({ error: 'trade_request_not_found' });
    const transactions = await store.transactions(entry.id);
    const hash = transactions.find(t => t.step === 'trade')?.tx_hash;
    let indexed = false;
    if (entry.status === 'confirmed' && hash) {
      const rows = entry.action === 'redeem'
        ? await sql`SELECT r.tx_hash FROM redemptions r JOIN protocol_markets m ON m.id = r.market_id
            WHERE r.tx_hash = ${hash} AND LOWER(r.user_address) = ${wallet}
              AND m.chain_id = 421614 AND LOWER(m.pool_address) = ${entry.plan.market.chain_address.toLowerCase()} LIMIT 1`
        : await sql`SELECT t.tx_hash FROM trades t JOIN protocol_markets m ON m.id = t.market_id
            WHERE t.tx_hash = ${hash} AND LOWER(t.trader) = ${wallet} AND t.side = ${entry.action}
              AND m.chain_id = 421614 AND LOWER(m.pool_address) = ${entry.plan.market.chain_address.toLowerCase()} LIMIT 1`;
      indexed = rows.length > 0;
    }
    return res.status(200).json(publicTradeRequest(entry, transactions, indexed));
  } catch (error) {
    return res.status(error.status || 503).json({ error: error.status ? error.message : 'trade_requests_unavailable' });
  }
}
