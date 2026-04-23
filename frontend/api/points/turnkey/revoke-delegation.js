/**
 * POST /api/points/turnkey/revoke-delegation
 *
 * User chose to revoke the backend's delegated signing authority.
 * After this, on-chain trades via /api/points/buy will require a
 * fresh "Autorizar operaciones" consent before executing again.
 *
 * Idempotent — if nothing's authorized, we return success with
 * revoked=false so the UI can just refresh its state.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { revokeDelegationPolicy } from '../../_lib/turnkey-delegation.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

    await ensurePointsSchema(sql);

    const rows = await sql`
      SELECT delegation_policy_id FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const policyId = rows[0]?.delegation_policy_id || null;

    if (!policyId) {
      return res.status(200).json({ ok: true, revoked: false, reason: 'no_policy' });
    }

    await revokeDelegationPolicy({ suborgId: session.sub, policyId });

    await sql`
      UPDATE points_users
      SET delegation_policy_id       = NULL,
          delegation_expires_at      = NULL,
          delegation_daily_cap_mxnb  = NULL,
          delegation_authorized_at   = NULL
      WHERE turnkey_sub_org_id = ${session.sub}
    `;

    return res.status(200).json({ ok: true, revoked: true });
  } catch (e) {
    console.error('[turnkey/revoke-delegation] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'revoke_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
