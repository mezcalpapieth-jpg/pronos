/**
 * GET /api/protocol/admin/funding-monitor
 *
 * Operational queue for Juno/Bitso funding readiness: missing CLABEs,
 * pending wallet registrations, stuck deposits, failed provider events,
 * and withdrawal requests waiting for provider keys or manual review.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import {
  buildAdminFundingMonitorPayload,
  ensureJunoFundingSchema,
} from '../../_lib/juno-funding.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    await ensurePointsSchema(schemaSql);
    await ensureJunoFundingSchema(schemaSql);

    const [accounts, withdrawals, events] = await Promise.all([
      sql`
        SELECT a.id, a.turnkey_sub_org_id, a.wallet_address, a.clabe,
               a.juno_account_id, a.blockchain_account_registered, a.kyc_status,
               a.last_deposit_status, a.last_withdrawal_status, a.updated_at,
               u.username, u.email
        FROM juno_funding_accounts a
        LEFT JOIN points_users u ON u.turnkey_sub_org_id = a.turnkey_sub_org_id
        ORDER BY a.updated_at DESC
        LIMIT 100
      `,
      sql`
        SELECT w.id, w.turnkey_sub_org_id, w.wallet_address, w.destination_clabe,
               w.destination_name, w.amount, w.asset, w.status, w.provider,
               w.provider_request_id, w.note, w.requested_at, w.processed_at,
               w.updated_at, u.username, u.email
        FROM juno_withdrawal_requests w
        LEFT JOIN points_users u ON u.turnkey_sub_org_id = w.turnkey_sub_org_id
        WHERE w.status IN ('pending', 'requested', 'processing', 'provider_error')
        ORDER BY w.requested_at DESC
        LIMIT 100
      `,
      sql`
        SELECT e.id, e.provider, e.provider_event_id, e.event_type,
               e.transaction_type, e.transaction_status, e.turnkey_sub_org_id,
               e.wallet_address, e.clabe, e.amount, e.asset, e.network,
               e.tx_hash, e.external_ref, e.created_at, u.username, u.email
        FROM juno_transaction_events e
        LEFT JOIN points_users u ON u.turnkey_sub_org_id = e.turnkey_sub_org_id
        ORDER BY e.created_at DESC
        LIMIT 100
      `,
    ]);

    return res.status(200).json(buildAdminFundingMonitorPayload({
      accounts,
      withdrawals,
      events,
    }));
  } catch (error) {
    console.error('[protocol/admin/funding-monitor] unhandled', { message: error?.message });
    return res.status(500).json({ error: 'funding_monitor_failed' });
  }
}
