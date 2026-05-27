/**
 * GET /api/points/turnkey/delegation-status
 *
 * Lightweight read used by the client before rendering the trade
 * drawer for an on-chain market. Tells the UI whether the user has
 * an active delegation (happy path, no consent prompt needed) or
 * needs to authorize first.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import {
  deriveDelegationPolicyState,
  isDelegationEnabled,
  DELEGATION_DAYS,
  DELEGATION_DAILY_CAP_MXNB,
} from '../../_lib/turnkey-delegation.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

async function readLatestProtocolPoolCreatedAt() {
  try {
    const rows = await sql`
      SELECT created_at
      FROM protocol_markets
      WHERE pool_address IS NOT NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1
    `;
    return rows[0]?.created_at || null;
  } catch (e) {
    console.warn('[turnkey/delegation-status] protocol pool lookup failed', { message: e?.message });
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

    await ensurePointsSchema(schemaSql);

    const rows = await sql`
      SELECT delegation_policy_id, delegation_expires_at,
             delegation_daily_cap_mxnb, delegation_authorized_at
      FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const row = rows[0] || {};
    const latestPoolCreatedAt = await readLatestProtocolPoolCreatedAt();
    const enabled = isDelegationEnabled();
    const policyState = deriveDelegationPolicyState({
      policyId: row.delegation_policy_id,
      expiresAt: row.delegation_expires_at,
      authorizedAt: row.delegation_authorized_at,
      latestPoolCreatedAt,
      delegationEnabled: enabled,
    });

    return res.status(200).json({
      active: policyState.active,
      needsRefresh: policyState.needsRefresh,
      simulated: policyState.simulated,
      needsRealPolicy: policyState.needsRealPolicy,
      // When delegation is disabled at the env level the active
      // column may still be true (a simulated policy exists) but
      // signing won't actually work. Flag this explicitly so the
      // UI can show "pending contract deployment" rather than a
      // misleading green tick.
      enabled,
      policyId: row.delegation_policy_id || null,
      expiresAt: row.delegation_expires_at || null,
      dailyCapMxnb: row.delegation_daily_cap_mxnb
        ? Number(row.delegation_daily_cap_mxnb)
        : DELEGATION_DAILY_CAP_MXNB,
      authorizedAt: row.delegation_authorized_at || null,
      defaults: {
        days: DELEGATION_DAYS,
        dailyCapMxnb: DELEGATION_DAILY_CAP_MXNB,
      },
    });
  } catch (e) {
    console.error('[turnkey/delegation-status] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'status_failed' });
  }
}
