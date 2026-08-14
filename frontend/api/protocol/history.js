/**
 * GET /api/protocol/history
 *   ?address=0x...   (optional; falls back to the session's wallet)
 *   ?limit=...       (default 100, max 500)
 *
 * Returns a chronologically descending list of the user's on-chain
 * trades (buys + sells) and redemptions, joined with their markets'
 * questions. Used by the MVP Portfolio "Historial" tab.
 *
 * Reads from `trades` (V1+V2 unified) and `redemptions`, both
 * indexer-owned. Sorted by block_number DESC then log_index DESC
 * for tx-ordering accuracy.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const requestedAddr = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  let userAddress = requestedAddr.toLowerCase() || null;
  const limitRaw = Number.parseInt(req.query.limit, 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);

  try {
    if (!userAddress) {
      const userRows = await sql`
        SELECT wallet_address FROM points_users
        WHERE turnkey_sub_org_id = ${session.sub}
        LIMIT 1
      `;
      userAddress = (userRows[0]?.wallet_address || '').toLowerCase() || null;
    }
    if (!userAddress) return res.status(400).json({ error: 'wallet_not_found' });
    if (!/^0x[a-f0-9]{40}$/i.test(userAddress)) {
      return res.status(400).json({ error: 'invalid_address' });
    }

    const tradeRows = await sql`
      SELECT t.id, t.market_id, t.side, t.is_yes, t.outcome_index,
             t.collateral_amt, t.shares_amt, t.fee_amt, t.price_at_trade,
             t.tx_hash, t.block_number, t.created_at,
             m.question, m.category
        FROM trades t
        LEFT JOIN protocol_markets m ON m.id = t.market_id
       WHERE t.trader = ${userAddress}
       ORDER BY t.block_number DESC, t.log_index DESC
       LIMIT ${limit}
    `;
    const redeemRows = await sql`
      SELECT r.id, r.market_id, r.outcome_index, r.shares, r.payout,
             r.tx_hash, r.block_number, r.created_at,
             m.question, m.category
        FROM redemptions r
        LEFT JOIN protocol_markets m ON m.id = r.market_id
       WHERE r.user_address = ${userAddress}
       ORDER BY r.block_number DESC, r.log_index DESC
       LIMIT ${limit}
    `;

    const trades = [];
    for (const t of tradeRows) {
      trades.push({
        id: t.id,
        marketId: t.market_id,
        question: t.question,
        category: t.category,
        side: t.side,
        isYes: t.is_yes,
        outcomeIndex: t.outcome_index != null ? Number(t.outcome_index) : null,
        collateral: Number(t.collateral_amt),
        shares: Number(t.shares_amt),
        fee: Number(t.fee_amt) || 0,
        priceAtTrade: t.price_at_trade != null ? Number(t.price_at_trade) : null,
        txHash: t.tx_hash,
        blockNumber: Number(t.block_number),
        createdAt: t.created_at,
      });
    }
    for (const r of redeemRows) {
      trades.push({
        id: `r${r.id}`,
        marketId: r.market_id,
        question: r.question,
        category: r.category,
        side: 'redeem',
        outcomeIndex: r.outcome_index != null ? Number(r.outcome_index) : null,
        shares: Number(r.shares),
        collateral: Number(r.payout),
        priceAtTrade: 1,
        fee: 0,
        txHash: r.tx_hash,
        blockNumber: Number(r.block_number),
        createdAt: r.created_at,
      });
    }
    // Final sort: block_number DESC across both tables.
    trades.sort((a, b) => {
      const dn = Number(b.blockNumber) - Number(a.blockNumber);
      if (dn !== 0) return dn;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ address: userAddress, trades: trades.slice(0, limit) });
  } catch (e) {
    console.error('[protocol/history] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'history_failed' });
  }
}
