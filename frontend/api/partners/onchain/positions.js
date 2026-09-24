import { neon } from '@neondatabase/serverless';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { clientIp, rateLimit } from '../../_lib/rate-limit.js';
import {
  applyPartnerCors,
  normalizeWalletAddress,
  parseJsonb,
  partnerError,
  withPartnerEnvelope,
} from '../../_lib/partner-onchain.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positionRow({ row, outcomes, outcomeIndex, shares, totalCost, currentPrice, version }) {
  const sharesNum = Number(shares) || 0;
  const costBasis = Number(totalCost) || 0;
  const price = numberOrNull(currentPrice);
  const currentValue = price !== null ? sharesNum * price : null;
  const winningOutcome = row.outcome != null ? Number(row.outcome) : null;
  return {
    marketId: String(row.market_db_id),
    venueMarketId: `pronos:${row.chain_id || 'unknown'}:${row.market_id ?? row.market_db_id}`,
    chainMarketId: row.market_id != null ? String(row.market_id) : null,
    poolAddress: row.pool_address || null,
    chainId: row.chain_id != null ? Number(row.chain_id) : null,
    question: row.question || null,
    category: row.category || 'general',
    protocolVersion: version,
    status: row.status,
    outcomeIndex,
    outcome: outcomes[outcomeIndex] || `#${outcomeIndex}`,
    winningOutcome,
    shares: sharesNum,
    costBasis,
    currentPrice: price,
    currentValue,
    unrealizedPnl: currentValue !== null ? currentValue - costBasis : null,
    redeemable: row.status === 'resolved' && winningOutcome === outcomeIndex && !row.redeemed,
    redeemed: Boolean(row.redeemed),
    payout: Number(row.payout || 0),
    endTime: row.end_time || null,
  };
}

export default async function handler(req, res) {
  const cors = applyPartnerCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return partnerError(res, 405, 'method_not_allowed');

  const limited = rateLimit(req, res, {
    key: `partner-onchain-positions:${clientIp(req)}`,
    limit: 180,
    windowMs: 60_000,
    structuredError: true,
  });
  if (limited) return;

  const address = normalizeWalletAddress(req.query?.wallet || req.query?.address || req.query?.user);
  if (!address) return partnerError(res, 400, 'invalid_wallet_address');

  try {
    await ensureProtocolSchema(schemaSql);
    const v2 = await sql.query(`
      SELECT op.market_id, op.outcome_index, op.shares, op.total_cost,
             op.redeemed, op.payout,
             m.id AS market_db_id, m.market_id AS market_id, m.chain_id,
             m.question, m.category, m.outcomes, m.protocol_version,
             m.outcome_count, m.status, m.outcome, m.end_time, m.pool_address,
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
       WHERE LOWER(op.user_address) = LOWER($1)
         AND op.shares > 0
       ORDER BY m.created_at DESC
    `, [address]);

    const v1 = await sql.query(`
      SELECT p.market_id, p.yes_shares, p.no_shares, p.total_cost,
             p.redeemed, p.payout,
             m.id AS market_db_id, m.market_id AS market_id, m.chain_id,
             m.question, m.category, m.outcomes, m.protocol_version,
             m.outcome_count, m.status, m.outcome, m.end_time, m.pool_address,
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
       WHERE LOWER(p.user_address) = LOWER($1)
         AND (p.yes_shares > 0 OR p.no_shares > 0)
       ORDER BY m.created_at DESC
    `, [address]);

    const positions = [];
    for (const row of v2?.rows || []) {
      const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
      const prices = parseJsonb(row.s_prices, null)
        || (row.s_yes != null ? [Number(row.s_yes), Number(row.s_no)] : null);
      const outcomeIndex = Number(row.outcome_index);
      positions.push(positionRow({
        row,
        outcomes,
        outcomeIndex,
        shares: row.shares,
        totalCost: row.total_cost,
        currentPrice: prices ? prices[outcomeIndex] : null,
        version: row.protocol_version || 'v2',
      }));
    }
    for (const row of v1?.rows || []) {
      const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
      if (Number(row.yes_shares) > 0) {
        positions.push(positionRow({
          row,
          outcomes,
          outcomeIndex: 0,
          shares: row.yes_shares,
          totalCost: row.total_cost,
          currentPrice: row.s_yes,
          version: row.protocol_version || 'v1',
        }));
      }
      if (Number(row.no_shares) > 0) {
        positions.push(positionRow({
          row,
          outcomes,
          outcomeIndex: 1,
          shares: row.no_shares,
          totalCost: row.total_cost,
          currentPrice: row.s_no,
          version: row.protocol_version || 'v1',
        }));
      }
    }

    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(withPartnerEnvelope(req, {
      wallet: address,
      count: positions.length,
      positions,
    }));
  } catch (e) {
    console.error('[partners/onchain/positions] failed', { message: e?.message, code: e?.code });
    return partnerError(res, 500, 'positions_failed', 'Could not load partner positions.');
  }
}

