/**
 * GET /api/protocol/positions
 *   ?address=0x...   (optional; falls back to the session's wallet)
 *
 * Returns the user's outstanding on-chain positions across all
 * protocol markets, joined with current prices and resolution
 * status so the Portfolio view can render unrealized PnL + redeem
 * buttons.
 *
 * Reads from `outcome_positions` (V2) and `positions` (V1) — both
 * indexer-owned. We union them into a uniform shape keyed by
 * (marketId, outcomeIndex). Only rows with a positive share count
 * are returned.
 *
 * Auth: session-based (Turnkey suborg). Address override is allowed
 * for admin-side debugging; the regular client always passes its
 * own wallet, which we cross-check against the session.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const requestedAddr = typeof req.query.address === 'string' ? req.query.address.trim() : '';
  let userAddress = requestedAddr.toLowerCase() || null;

  try {
    if (!userAddress) {
      const userRows = await sql`
        SELECT wallet_address FROM points_users
        WHERE turnkey_sub_org_id = ${session.sub}
        LIMIT 1
      `;
      userAddress = (userRows[0]?.wallet_address || '').toLowerCase() || null;
    }
    if (!userAddress) {
      return res.status(400).json({ error: 'wallet_not_found' });
    }
    if (!/^0x[a-f0-9]{40}$/i.test(userAddress)) {
      return res.status(400).json({ error: 'invalid_address' });
    }

    // V2 outcome_positions (one row per outcome held)
    const v2Rows = await sql`
      SELECT op.market_id, op.outcome_index, op.shares, op.total_cost,
             op.redeemed, op.payout,
             m.id AS market_db_id, m.question, m.category, m.outcomes,
             m.protocol_version, m.outcome_count, m.status, m.outcome,
             m.end_time, m.pool_address,
             s.prices AS s_prices, s.yes_price AS s_yes, s.no_price AS s_no
        FROM outcome_positions op
        JOIN protocol_markets m ON m.id = op.market_id
        LEFT JOIN LATERAL (
          SELECT prices, yes_price, no_price
            FROM price_snapshots
           WHERE market_id = m.id
           ORDER BY snapshot_at DESC
           LIMIT 1
        ) s ON TRUE
       WHERE op.user_address = ${userAddress}
         AND op.shares > 0
       ORDER BY m.created_at DESC
    `;

    // V1 positions (legacy: yes_shares + no_shares per row)
    const v1Rows = await sql`
      SELECT p.market_id, p.yes_shares, p.no_shares, p.total_cost,
             p.redeemed, p.payout,
             m.id AS market_db_id, m.question, m.category, m.outcomes,
             m.protocol_version, m.outcome_count, m.status, m.outcome,
             m.end_time, m.pool_address,
             s.yes_price AS s_yes, s.no_price AS s_no
        FROM positions p
        JOIN protocol_markets m ON m.id = p.market_id
        LEFT JOIN LATERAL (
          SELECT yes_price, no_price
            FROM price_snapshots
           WHERE market_id = m.id
           ORDER BY snapshot_at DESC
           LIMIT 1
        ) s ON TRUE
       WHERE p.user_address = ${userAddress}
         AND (p.yes_shares > 0 OR p.no_shares > 0)
       ORDER BY m.created_at DESC
    `;

    // Field names mirror what the MVP Portfolio.jsx PositionRow expects:
    //   costBasis, currentValue, unrealizedPnl, shares, outcomeLabel.
    // The portfolio computes pl as `unrealizedPnl ?? (currentValue - costBasis)`,
    // so providing both makes the row render without further mapping.
    const positions = [];
    function pushRow({ row, outcomes, idx, shares, totalCost, currentPrice, label, version }) {
      const sharesNum = Number(shares) || 0;
      const costBasis = Number(totalCost) || 0;
      const currentValue = currentPrice != null ? sharesNum * Number(currentPrice) : null;
      positions.push({
        marketId: row.market_db_id,
        question: row.question,
        category: row.category,
        outcomes,
        outcomeIndex: idx,
        outcomeLabel: label ?? outcomes[idx] ?? `#${idx}`,
        protocolVersion: version,
        status: row.status,
        winningOutcome: row.outcome != null ? Number(row.outcome) : null,
        endTime: row.end_time,
        poolAddress: row.pool_address,
        shares: sharesNum,
        costBasis,
        currentPrice: currentPrice != null ? Number(currentPrice) : null,
        currentValue,
        unrealizedPnl: currentValue != null ? currentValue - costBasis : null,
        redeemed: Boolean(row.redeemed),
        payout: row.payout != null ? Number(row.payout) : 0,
      });
    }
    for (const r of v2Rows) {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      const prices = parseJsonb(r.s_prices, null)
        || (r.s_yes != null ? [Number(r.s_yes), Number(r.s_no)] : null);
      const idx = Number(r.outcome_index);
      pushRow({
        row: r,
        outcomes,
        idx,
        shares: r.shares,
        totalCost: r.total_cost,
        currentPrice: prices ? prices[idx] : null,
        label: outcomes[idx],
        version: r.protocol_version || 'v2',
      });
    }
    for (const r of v1Rows) {
      const outcomes = parseJsonb(r.outcomes, ['Sí', 'No']);
      // V1 splits across two columns; expand into two normalized rows
      // when both sides are held (rare but possible after partial sells).
      if (Number(r.yes_shares) > 0) {
        pushRow({
          row: r, outcomes, idx: 0,
          shares: r.yes_shares,
          totalCost: r.total_cost,
          currentPrice: r.s_yes,
          label: outcomes[0] ?? 'Sí',
          version: r.protocol_version || 'v1',
        });
      }
      if (Number(r.no_shares) > 0) {
        pushRow({
          row: r, outcomes, idx: 1,
          shares: r.no_shares,
          totalCost: r.total_cost,
          currentPrice: r.s_no,
          label: outcomes[1] ?? 'No',
          version: r.protocol_version || 'v1',
        });
      }
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ address: userAddress, positions });
  } catch (e) {
    console.error('[protocol/positions] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'positions_failed' });
  }
}
