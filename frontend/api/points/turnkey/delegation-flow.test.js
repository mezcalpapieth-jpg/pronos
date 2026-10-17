import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildTradingDelegation, delegationError, verifyTradingPolicy } from '../../_lib/trading-delegation.js';
const a = n => `0x${String(n).repeat(40)}`;
const config = { walletAddress: a(1), backendPublicKey: `02${'ab'.repeat(32)}`, chainId: 421614, collateral: a(2), shares: { v1: a(3) }, pools: [{ address: a(4), version: 'v1' }] };
const plan = buildTradingDelegation(config);
const base = { row: { delegation_policy_id: 'installed' }, config, plan, backendUserId: 'backend', policyIds: ['installed'], snapshot: { policies: [{ ...plan.policy, policyId: 'installed' }] } };
async function run(name, state, body = {}, session = { sub: 'owner' }) {
  const source = await readFile(new URL(`./${name}.js`, import.meta.url), 'utf8');
  const writes = [];
  const handler = new Function('applyCors', 'requireSession', 'ensurePointsSchema', 'sql', 'loadTradingDelegation', 'loadTradingDelegationIdentity', 'delegationError', 'verifyTradingPolicy', source.slice(source.indexOf('export default')).replace('export default', 'return'))(
    () => false, (_, res) => { if (!session) res.status(401).json({ error: 'not_authenticated' }); return session; }, async () => {}, async (...args) => writes.push(args), async () => state, async () => state, delegationError, verifyTradingPolicy);
  const result = { writes };
  const res = { setHeader() {}, status(n) { result.status = n; return this; }, json(data) { result.data = data; return this; } };
  await handler({ method: name === 'delegation-status' ? 'GET' : 'POST', body }, res);
  return result;
}
test('authorization preparation never records consent, and needs an authenticated owner', async () => {
  const r = await run('authorize-delegation', base);
  assert.equal(r.status, 200); assert.equal(r.data.persistent, true); assert.equal(r.writes.length, 0);
  assert.equal((await run('authorize-delegation', base, {}, null)).status, 401);
});
test('completion verifies exact installed scope and rejects old overlapping permissions', async () => {
  for (const state of [
    { ...base, backendUserId: null },
    { ...base, snapshot: { policies: [] } },
    { ...base, snapshot: { policies: [{ ...plan.policy, policyId: 'installed', condition: 'true' }] } },
    { ...base, policyIds: ['installed', 'old'] },
  ]) {
    const r = await run('authorize-delegation', state, { action: 'complete', policyId: 'installed' });
    assert.equal(r.status, 409); assert.equal(r.writes.length, 0);
  }
  const r = await run('authorize-delegation', base, { action: 'complete', policyId: 'installed' });
  assert.equal(r.status, 200); assert.equal(r.data.expiresAt, null); assert.equal(r.writes.length, 1);
});
test('status proves a persistent policy against Turnkey and never invents a daily cap', async () => {
  const r = await run('delegation-status', base);
  assert.equal(r.data.active, true); assert.equal(r.data.persistent, true); assert.equal(r.data.dailyCapMxnb, null);
  assert.deepEqual(r.data.coveredPools, [a(4)]);
  assert.equal((await run('delegation-status', { ...base, snapshot: { policies: [] } })).data.active, false);
});
test('revocation fails until all Turnkey grants are actually deleted', async () => {
  const rejected = await run('revoke-delegation', base, { action: 'complete' });
  assert.equal(rejected.status, 409); assert.equal(rejected.writes.length, 0);
  const done = await run('revoke-delegation', { ...base, policyIds: [] }, { action: 'complete' });
  assert.equal(done.status, 200); assert.equal(done.writes.length, 1);
});

test('future-market status requires the real installed router grant, and migration still needs owner completion', async () => {
  const routedConfig = { ...config, shares: { v1: a(3), v2: a(5) },
    router: { address: a(6), factories: [a(7), a(8)] } };
  const routedPlan = buildTradingDelegation(routedConfig);
  const state = { ...base, config: routedConfig, plan: routedPlan };
  const old = await run('delegation-status', state);
  assert.equal(old.data.active, true); assert.equal(old.data.needsRefresh, true);
  assert.equal(old.data.availableScope, 'router'); assert.equal(old.data.coversFutureMarkets, false);
  assert.deepEqual(old.data.coveredFactories, []);
  const prepared = await run('authorize-delegation', state);
  assert.equal(prepared.data.coversFutureMarkets, true); assert.equal(prepared.writes.length, 0);
  const installed = { ...state, snapshot: { policies: [{ ...routedPlan.policy, policyId: 'installed' }] } };
  const status = await run('delegation-status', installed);
  assert.equal(status.data.coversFutureMarkets, true); assert.equal(status.data.needsRefresh, false);
  assert.deepEqual(status.data.coveredFactories, [a(7), a(8)]);
  assert.equal((await run('authorize-delegation', installed, { action: 'complete', policyId: 'installed' })).writes.length, 1);
  assert.equal((await run('delegation-status', { ...installed, policyIds: ['installed','broad'] })).data.coversFutureMarkets, false);
});
