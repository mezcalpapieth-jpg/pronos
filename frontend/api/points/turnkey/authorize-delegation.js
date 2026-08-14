/**
 * POST /api/points/turnkey/authorize-delegation
 *
 * User has explicitly confirmed the "Autorizar operaciones
 * automáticas" consent sheet. We create (or refresh) their Turnkey
 * delegation policy and persist the id + expiry on points_users.
 *
 * Idempotent: if the user already has an unexpired policy, we
 * return it unchanged. If expired/near-expiry, we issue a fresh
 * one. Revoke flow lives in the sibling endpoint.
 *
 * Until `TURNKEY_POLICIES_ENABLED=true` AND chain-contract env vars
 * are set, the Turnkey call is simulated — the DB row gets a
 * `simulated-...` policy id and the delegation isn't actually
 * usable for signing. This lets the rest of the stack run now;
 * M3 flips the flag when contracts exist.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import {
  createDelegationPolicy,
  deriveDelegationPolicyState,
  isDelegationEnabled,
  DELEGATION_DAILY_CAP_MXNB,
} from '../../_lib/turnkey-delegation.js';

const sql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

// Consider a policy "fresh enough" if it has >14 days left. Users
// who re-auth inside that window just hit idempotent success.
const REFRESH_THRESHOLD_MS = 14 * 86_400_000;

async function readProtocolPolicyPools() {
  try {
    const rows = await readSql`
      SELECT pool_address, created_at
      FROM protocol_markets
      WHERE pool_address IS NOT NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT 500
    `;
    const pools = rows.map(r => r.pool_address).filter(Boolean);
    const latestCreatedAt = rows.find(r => r.created_at)?.created_at || null;
    return { pools, latestCreatedAt };
  } catch (e) {
    console.warn('[turnkey/authorize-delegation] protocol pool lookup failed', { message: e?.message });
    return { pools: [], latestCreatedAt: null };
  }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

    await ensurePointsSchema(sql);

    const existing = await readSql`
      SELECT delegation_policy_id, delegation_expires_at, delegation_authorized_at
      FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    if (existing.length === 0) {
      return res.status(404).json({ error: 'user_not_found' });
    }
    const row = existing[0];
    const poolCoverage = await readProtocolPolicyPools();
    const now = Date.now();
    const enabled = isDelegationEnabled();
    const policyState = deriveDelegationPolicyState({
      policyId: row.delegation_policy_id,
      expiresAt: row.delegation_expires_at,
      authorizedAt: row.delegation_authorized_at,
      latestPoolCreatedAt: poolCoverage.latestCreatedAt,
      delegationEnabled: enabled,
      nowMs: now,
      refreshThresholdMs: REFRESH_THRESHOLD_MS,
    });
    if (policyState.reusable) {
      return res.status(200).json({
        ok: true,
        status: 'already_authorized',
        policyId: row.delegation_policy_id,
        expiresAt: row.delegation_expires_at,
        enabled,
        simulated: policyState.simulated,
        needsRealPolicy: policyState.needsRealPolicy,
        policyPoolCount: poolCoverage.pools.length,
      });
    }

    const policy = await createDelegationPolicy({
      suborgId: session.sub,
      backendApiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY || null,
      extraMarketPools: poolCoverage.pools,
    });

    await sql`
      UPDATE points_users
      SET delegation_policy_id       = ${policy.policyId},
          delegation_expires_at      = ${policy.expiresAt},
          delegation_daily_cap_mxnb  = ${policy.dailyCapMxnb},
          delegation_authorized_at   = NOW()
      WHERE turnkey_sub_org_id = ${session.sub}
    `;

    return res.status(200).json({
      ok: true,
      status: 'authorized',
      policyId: policy.policyId,
      expiresAt: policy.expiresAt,
      dailyCapMxnb: policy.dailyCapMxnb,
      simulated: !!policy.simulated,
      enabled,
      policyPoolCount: poolCoverage.pools.length,
      refreshedForNewPools: policyState.staleForNewPools,
      refreshedForRealPolicy: policyState.needsRealPolicy,
    });
  } catch (e) {
    console.error('[turnkey/authorize-delegation] error', {
      message: e?.message, code: e?.code,
    });
    return res.status(e?.status || 500).json({
      error: 'authorize_failed',
    });
  }
}
