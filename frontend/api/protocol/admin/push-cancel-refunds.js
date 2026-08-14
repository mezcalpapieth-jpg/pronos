/**
 * POST /api/protocol/admin/push-cancel-refunds
 * Body: { marketId, refunds: [{ userAddress, outcomeIndexes?, amounts?, outcomeIndex?, shares?, yesShares?, noShares?, payout?, openCost? }] }
 *
 * Sends contract-native cancel refunds for markets already marked canceled.
 * The contract burns the holder's open outcome tokens and caps each payout
 * to the pool's native cost-basis ledger. If fees made the pool short, fund
 * the pool first, then retry this batch.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { isOnchainReady, pushCancelRefundsOnChain } from '../../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const writeSql = neon(process.env.DATABASE_URL);

function normalizeRefund(refund = {}) {
  const holder = refund.userAddress || refund.user_address || refund.holder;
  const payout = refund.payout ?? refund.openCost ?? 0;
  if (Array.isArray(refund.outcomeIndexes) && Array.isArray(refund.amounts)) {
    return { holder, outcomeIndexes: refund.outcomeIndexes, amounts: refund.amounts, payout };
  }
  if (refund.outcomeIndex != null && refund.shares != null) {
    return { holder, outcomeIndexes: [refund.outcomeIndex], amounts: [refund.shares], payout };
  }
  const outcomeIndexes = [];
  const amounts = [];
  if (Number(refund.yesShares) > 0) {
    outcomeIndexes.push(0);
    amounts.push(refund.yesShares);
  }
  if (Number(refund.noShares) > 0) {
    outcomeIndexes.push(1);
    amounts.push(refund.noShares);
  }
  return { holder, outcomeIndexes, amounts, payout };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  if (!isOnchainReady()) {
    return res.status(503).json({
      error: 'onchain_not_enabled',
      detail: 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS',
    });
  }

  const ownerSuborgId = process.env.ONCHAIN_OWNER_SUBORG_ID
    || process.env.ONCHAIN_RESOLVER_SUBORG_ID
    || process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const ownerAddr = process.env.ONCHAIN_OWNER_ADDRESS
    || process.env.ONCHAIN_RESOLVER_ADDRESS
    || process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!ownerSuborgId || !ownerAddr) {
    return res.status(503).json({
      error: 'owner_not_configured',
      detail: 'set ONCHAIN_OWNER_SUBORG_ID + ONCHAIN_OWNER_ADDRESS, or use the Safe path for owner-only actions',
    });
  }

  const { marketId, refunds } = req.body || {};
  const mid = Number.parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Array.isArray(refunds) || refunds.length === 0) return res.status(400).json({ error: 'refunds_required' });
  if (refunds.length > 80) return res.status(400).json({ error: 'refund_batch_too_large' });

  try {
    const rows = await sql`
      SELECT id, status, market_id, factory_address, protocol_version
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
    const market = rows[0];
    if (market.status !== 'canceled') {
      return res.status(400).json({ error: 'market_not_canceled' });
    }
    if (!market.factory_address || market.market_id == null) {
      return res.status(500).json({ error: 'market_missing_chain_metadata' });
    }

    const normalizedRefunds = refunds.map(normalizeRefund);
    const result = await pushCancelRefundsOnChain({
      ownerSuborgId,
      ownerAddr,
      factoryAddress: market.factory_address,
      factoryVariant: market.protocol_version === 'v2' ? 'v2' : 'v1',
      marketId: market.market_id,
      refunds: normalizedRefunds,
    });

    await writeSql`
      UPDATE protocol_markets
      SET lifecycle_note = ${`Reembolsos on-chain enviados: ${result.refundCount}`},
          lifecycle_updated_at = NOW(),
          lifecycle_updated_by = ${admin.username || admin.user || 'admin'}
      WHERE id = ${mid}
    `;

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[protocol/admin/push-cancel-refunds] failed', {
      message: e?.message, code: e?.code,
    });
    return res.status(500).json({
      error: 'push_cancel_refunds_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}
