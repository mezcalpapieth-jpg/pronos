import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { loadTradingDelegation } from '../../_lib/trading-delegation-store.js';
import { verifyTradingPolicy } from '../../_lib/trading-delegation.js';

const sql = neon(process.env.DATABASE_URL);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true })) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });
    await ensurePointsSchema(sql);
    const { row, config, plan, snapshot, backendUserId, policyIds } = await loadTradingDelegation(sql, session);
    const installed = snapshot.policies.find(p => p.policyId === row.delegation_policy_id);
    const verified = backendUserId && verifyTradingPolicy(installed, config);
    const active = Boolean(verified && policyIds.length === 1);
    return res.status(200).json({
      active, enabled: true, persistent: active, simulated: false,
      needsRefresh: !active || verified.scopeHash !== plan.scopeHash,
      policyId: row.delegation_policy_id || null, expiresAt: row.delegation_expires_at || null,
      dailyCapMxnb: null, dailyCapEnforced: false,
      authorizedAt: row.delegation_authorized_at || null,
      coveredPools: active ? verified.pools.map(p => p.address) : [],
      poolCount: config.pools.length,
    });
  } catch (e) {
    if (e.message === 'delegation_not_enabled') return res.status(200).json({ active: false, enabled: false, persistent: false });
    console.error('[turnkey/delegation-status]', { message: e?.message, code: e?.code });
    return res.status(e.status || 502).json({ error: e.status ? e.message : 'status_failed' });
  }
}
