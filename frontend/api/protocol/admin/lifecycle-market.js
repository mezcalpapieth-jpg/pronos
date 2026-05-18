/**
 * POST /api/protocol/admin/lifecycle-market
 * Body: { marketId, action, note?, onchain? }
 *
 * Lifecycle controls for protocol markets:
 *   - cancel: marks status='canceled', blocks app/API trading, returns an
 *     indexed refund report for later admin push-refunds.
 *   - dispute: marks status='disputed' so a resolved market is visible
 *     to admins and not overwritten by late indexer resolution events.
 *   - clear_dispute: restores the market to its previous status.
 *   - reopen: restores a canceled/disputed shell market to active.
 *
 * By default it is a DB shell so old deployed contracts remain usable.
 * When onchain=true, cancel/dispute/clear_dispute first call the owner-only
 * factory lifecycle methods added for the next deployment, then mirror the
 * result in Postgres. Refund payout batches stay explicit admin work.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { isOnchainReady, lifecycleMarketOnChain } from '../../_lib/onchain-trader.js';

const schemaSql = neon(process.env.DATABASE_URL);

const ACTIONS = new Set(['cancel', 'dispute', 'clear_dispute', 'reopen']);

function cleanNote(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : fallback;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function buildRefundReport(client, marketId) {
  const outcomeRows = await client.query(
    `SELECT user_address, outcome_index, shares, total_cost, redeemed, payout
       FROM outcome_positions
      WHERE market_id = $1
        AND (shares > 0 OR total_cost > 0)
      ORDER BY total_cost DESC, user_address ASC`,
    [marketId],
  );
  const binaryRows = await client.query(
    `SELECT user_address, yes_shares, no_shares, total_cost, redeemed, payout
       FROM positions
      WHERE market_id = $1
        AND (yes_shares > 0 OR no_shares > 0 OR total_cost > 0)
      ORDER BY total_cost DESC, user_address ASC`,
    [marketId],
  );
  const tradeRows = await client.query(
    `SELECT COUNT(*)::int AS trade_count,
            COUNT(DISTINCT trader)::int AS trader_count,
            COALESCE(SUM(CASE WHEN side = 'buy' THEN collateral_amt ELSE 0 END), 0) AS gross_buy,
            COALESCE(SUM(CASE WHEN side = 'sell' THEN collateral_amt ELSE 0 END), 0) AS gross_sell,
            COALESCE(SUM(fee_amt), 0) AS fees
       FROM trades
      WHERE market_id = $1`,
    [marketId],
  );

  const outcomePositions = outcomeRows.rows.map(row => ({
    userAddress: row.user_address,
    outcomeIndex: row.outcome_index != null ? Number(row.outcome_index) : null,
    shares: num(row.shares),
    openCost: num(row.total_cost),
    redeemed: row.redeemed === true,
    payout: num(row.payout),
  }));
  const binaryPositions = binaryRows.rows.map(row => ({
    userAddress: row.user_address,
    yesShares: num(row.yes_shares),
    noShares: num(row.no_shares),
    openShares: num(row.yes_shares) + num(row.no_shares),
    openCost: num(row.total_cost),
    redeemed: row.redeemed === true,
    payout: num(row.payout),
  }));
  const tradeSummary = tradeRows.rows[0] || {};
  const openCost = outcomePositions.reduce((sum, row) => sum + row.openCost, 0)
    + binaryPositions.reduce((sum, row) => sum + row.openCost, 0);
  const openShares = outcomePositions.reduce((sum, row) => sum + row.shares, 0)
    + binaryPositions.reduce((sum, row) => sum + row.openShares, 0);
  const uniqueUsers = new Set([
    ...outcomePositions.map(row => row.userAddress),
    ...binaryPositions.map(row => row.userAddress),
  ].filter(Boolean));

  return {
    marketId,
    traderCount: Math.max(num(tradeSummary.trader_count), uniqueUsers.size),
    openPositionCount: outcomePositions.length + binaryPositions.length,
    openCost,
    openShares,
    tradeCount: num(tradeSummary.trade_count),
    grossBuy: num(tradeSummary.gross_buy),
    grossSell: num(tradeSummary.gross_sell),
    fees: num(tradeSummary.fees),
    outcomePositions,
    binaryPositions,
    shellOnly: true,
    onchainPaused: false,
    onchainRefunded: false,
  };
}

function publicMarket(row) {
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    status: row.status,
    previousStatus: row.previous_status || null,
    outcome: row.outcome != null ? Number(row.outcome) : null,
    lifecycleNote: row.lifecycle_note || null,
    lifecycleUpdatedAt: row.lifecycle_updated_at || null,
    lifecycleUpdatedBy: row.lifecycle_updated_by || null,
    canceledAt: row.canceled_at || null,
    disputeOpenedAt: row.dispute_opened_at || null,
    resolvedAt: row.resolved_at || null,
  };
}

function statusError(message, status, detail) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { marketId, action: requestedAction, note } = req.body || {};
  const mid = Number.parseInt(marketId, 10);
  const action = typeof requestedAction === 'string' ? requestedAction.trim() : '';
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!ACTIONS.has(action)) return res.status(400).json({ error: 'invalid_action' });

  try {
    await ensureProtocolSchema(schemaSql);
    let onchainResult = null;
    const wantsOnchain = req.body?.onchain === true || req.body?.onchain === 'true';
    if (wantsOnchain) {
      if (action === 'reopen') {
        return res.status(400).json({ error: 'onchain_reopen_not_supported' });
      }
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
      const rows = await schemaSql`
        SELECT id, status, market_id, factory_address, protocol_version
        FROM protocol_markets
        WHERE id = ${mid}
        LIMIT 1
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });
      const market = rows[0];
      if (!market.factory_address || market.market_id == null) {
        return res.status(500).json({ error: 'market_missing_chain_metadata' });
      }
      onchainResult = await lifecycleMarketOnChain({
        ownerSuborgId,
        ownerAddr,
        factoryAddress: market.factory_address,
        factoryVariant: market.protocol_version === 'v2' ? 'v2' : 'v1',
        marketId: market.market_id,
        action,
      });
    }

    const result = await withTransaction(async (client) => {
      const currentRows = await client.query(
        `SELECT id, question, status, previous_status, outcome, resolved_at,
                lifecycle_note, lifecycle_updated_at, lifecycle_updated_by,
                canceled_at, dispute_opened_at
           FROM protocol_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      if (currentRows.rows.length === 0) {
        throw statusError('market_not_found', 404);
      }
      const market = currentRows.rows[0];
      const refundReport = await buildRefundReport(client, mid);
      const actor = admin.username || admin.user || 'admin';
      const lifecycleNote = cleanNote(note, action === 'cancel'
        ? 'Mercado anulado: el evento no ocurrió'
        : action === 'dispute'
          ? 'Resolución marcada en disputa'
          : null);

      let updated;

      if (action === 'cancel') {
        if (market.status === 'canceled') {
          throw statusError('market_already_canceled', 400, 'El mercado ya está anulado.');
        }
        if (market.status === 'resolved') {
          throw statusError('market_already_resolved', 400, 'Abre una disputa antes de anular un mercado resuelto.');
        }
        const rows = await client.query(
          `UPDATE protocol_markets
              SET previous_status = CASE WHEN status <> 'canceled' THEN status ELSE previous_status END,
                  status = 'canceled',
                  outcome = NULL,
                  lifecycle_note = $2,
                  lifecycle_updated_at = NOW(),
                  lifecycle_updated_by = $3,
                  canceled_at = NOW(),
                  dispute_opened_at = NULL
            WHERE id = $1
            RETURNING id, question, status, previous_status, outcome, resolved_at,
                      lifecycle_note, lifecycle_updated_at, lifecycle_updated_by,
                      canceled_at, dispute_opened_at`,
          [mid, lifecycleNote, actor],
        );
        updated = rows.rows[0];
      } else if (action === 'dispute') {
        if (market.status === 'disputed') {
          throw statusError('market_already_disputed', 400, 'El mercado ya está en disputa.');
        }
        if (market.status === 'canceled') {
          throw statusError('market_canceled', 400, 'Reabre el mercado antes de marcar disputa.');
        }
        if (market.status !== 'resolved') {
          throw statusError('market_not_resolved', 400, 'Solo se disputan mercados ya resueltos.');
        }
        const rows = await client.query(
          `UPDATE protocol_markets
              SET previous_status = status,
                  status = 'disputed',
                  lifecycle_note = $2,
                  lifecycle_updated_at = NOW(),
                  lifecycle_updated_by = $3,
                  dispute_opened_at = COALESCE(dispute_opened_at, NOW())
            WHERE id = $1
            RETURNING id, question, status, previous_status, outcome, resolved_at,
                      lifecycle_note, lifecycle_updated_at, lifecycle_updated_by,
                      canceled_at, dispute_opened_at`,
          [mid, lifecycleNote, actor],
        );
        updated = rows.rows[0];
      } else if (action === 'clear_dispute') {
        if (market.status !== 'disputed') {
          throw statusError('market_not_disputed', 400, 'El mercado no está en disputa.');
        }
        const rows = await client.query(
          `UPDATE protocol_markets
              SET status = CASE
                    WHEN previous_status IN ('active', 'resolved') THEN previous_status
                    ELSE 'active'
                  END,
                  lifecycle_note = $2,
                  lifecycle_updated_at = NOW(),
                  lifecycle_updated_by = $3,
                  dispute_opened_at = NULL
            WHERE id = $1
            RETURNING id, question, status, previous_status, outcome, resolved_at,
                      lifecycle_note, lifecycle_updated_at, lifecycle_updated_by,
                      canceled_at, dispute_opened_at`,
          [mid, cleanNote(note, 'Disputa cerrada por admin'), actor],
        );
        updated = rows.rows[0];
      } else if (action === 'reopen') {
        if (!['canceled', 'disputed'].includes(market.status)) {
          throw statusError('market_not_reopenable', 400, `Estado actual: ${market.status}.`);
        }
        const rows = await client.query(
          `UPDATE protocol_markets
              SET previous_status = status,
                  status = 'active',
                  outcome = NULL,
                  resolved_at = NULL,
                  lifecycle_note = $2,
                  lifecycle_updated_at = NOW(),
                  lifecycle_updated_by = $3,
                  canceled_at = NULL,
                  dispute_opened_at = NULL
            WHERE id = $1
            RETURNING id, question, status, previous_status, outcome, resolved_at,
                      lifecycle_note, lifecycle_updated_at, lifecycle_updated_by,
                      canceled_at, dispute_opened_at`,
          [mid, cleanNote(note, 'Mercado reabierto por admin'), actor],
        );
        updated = rows.rows[0];
      }

      return {
        ok: true,
        action,
        market: publicMarket(updated),
        refundReport,
        onchain: onchainResult,
        onchainPaused: Boolean(onchainResult && action === 'cancel'),
        onchainRefunded: false,
        nextContractStep: onchainResult
          ? 'push_cancel_refunds_from_indexed_report'
          : 'contract_cancel_refund_or_dispute_settlement',
      };
    });

    return res.status(200).json(result);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[protocol/admin/lifecycle-market] failed', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'lifecycle_failed',
      detail: e?.message?.slice(0, 240) || null,
      code: e?.code || null,
    });
  }
}
