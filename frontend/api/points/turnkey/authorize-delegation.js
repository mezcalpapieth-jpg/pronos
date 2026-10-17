/** Owner signs Turnkey mutations in-browser; completion verifies real state. */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { loadTradingDelegation } from '../../_lib/trading-delegation-store.js';
import { delegationError, verifyTradingPolicy } from '../../_lib/trading-delegation.js';

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
    const state = await loadTradingDelegation(sql, session);
    const { row, plan, snapshot, backendUserId, policyIds, config } = state;
    const { action = 'prepare', policyId } = req.body || {};
    if (action === 'prepare') {
      return res.status(200).json({
        ok: true, organizationId: session.sub, walletAddress: row.wallet_address,
        backendPublicKey: config.backendPublicKey, backendUserId,
        policy: plan.policy, scopeHash: plan.scopeHash, previousPolicyIds: policyIds,
        persistent: true, expiresAt: null, dailyCapMxnb: null,
        chainId: config.chainId, poolCount: config.pools.length,
      });
    }
    if (action !== 'complete') return res.status(400).json({ error: 'invalid_action' });
    const installed = snapshot.policies.find(p => p.policyId === policyId);
    const verified = verifyTradingPolicy(installed, config);
    if (!backendUserId || !verified || verified.scopeHash !== plan.scopeHash) throw delegationError('delegation_policy_unverified');
    if (policyIds.some(id => id !== policyId)) throw delegationError('delegation_previous_policy_active');
    await sql`
      UPDATE points_users SET delegation_policy_id = ${policyId},
        delegation_expires_at = NULL, delegation_daily_cap_mxnb = NULL,
        delegation_authorized_at = NOW()
      WHERE turnkey_sub_org_id = ${session.sub}
    `;
    return res.status(200).json({ ok: true, active: true, enabled: true, persistent: true,
      policyId, expiresAt: null, dailyCapMxnb: null, poolCount: config.pools.length });
  } catch (e) {
    console.error('[turnkey/authorize-delegation]', { message: e?.message, code: e?.code });
    return res.status(e.status || 502).json({ error: e.status ? e.message : 'authorize_failed' });
  }
}
