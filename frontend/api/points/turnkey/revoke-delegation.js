import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { loadTradingDelegationIdentity } from '../../_lib/trading-delegation-store.js';

const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true })) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });
    await ensurePointsSchema(sql);
    const { policyIds } = await loadTradingDelegationIdentity(sql, session);
    const { action = 'prepare' } = req.body || {};
    if (action === 'prepare') return res.status(200).json({ ok: true, organizationId: session.sub, policyIds });
    if (action !== 'complete') return res.status(400).json({ error: 'invalid_action' });
    // Clearing a DB flag does not revoke Turnkey authority. Verify actual
    // deletion before claiming success, including old/overlapping grants.
    if (policyIds.length) return res.status(409).json({ error: 'delegation_policy_still_active' });
    await sql`
      UPDATE points_users SET delegation_policy_id = NULL, delegation_expires_at = NULL,
        delegation_daily_cap_mxnb = NULL, delegation_authorized_at = NULL
      WHERE turnkey_sub_org_id = ${session.sub}
    `;
    return res.status(200).json({ ok: true, revoked: true, active: false });
  } catch (e) {
    console.error('[turnkey/revoke-delegation]', { message: e?.message, code: e?.code });
    return res.status(e.status || 502).json({ error: e.status ? e.message : 'revoke_failed' });
  }
}
