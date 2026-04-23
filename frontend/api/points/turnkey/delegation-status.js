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
  isDelegationEnabled, DELEGATION_DAYS, DELEGATION_DAILY_CAP_MXNB,
} from '../../_lib/turnkey-delegation.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

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
    const expMs = row.delegation_expires_at ? new Date(row.delegation_expires_at).getTime() : 0;
    const active = Boolean(row.delegation_policy_id) && expMs > Date.now();
    const simulated = String(row.delegation_policy_id || '').startsWith('simulated-');

    return res.status(200).json({
      active,
      simulated,
      // When delegation is disabled at the env level the active
      // column may still be true (a simulated policy exists) but
      // signing won't actually work. Flag this explicitly so the
      // UI can show "pending contract deployment" rather than a
      // misleading green tick.
      enabled: isDelegationEnabled(),
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
