import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelegationClient } from './delegationClient.js';
const completed = { activity: { status: 'ACTIVITY_STATUS_COMPLETED' } };
const policy = { policyName: 'pronos-trading-v1-scope', condition: 'restricted', consensus: 'backend', effect: 'EFFECT_ALLOW' };
function fixture({ existing = [], ownerError, deleteError, backendUserId = null } = {}) {
  const calls = [];
  const owner = Object.fromEntries(['createUsers', 'getPolicies', 'createPolicy', 'deletePolicy'].map(method => [method, async body => {
    calls.push([method, body]);
    if (method === 'deletePolicy' && deleteError) throw deleteError;
    return method === 'getPolicies' ? { policies: existing } : { ...completed, policyId: 'new' };
  }]));
  const client = createDelegationClient({
    ownerClient: async org => { assert.equal(org, 'owner-suborg'); if (ownerError) throw ownerError; return owner; },
    post: async (url, body) => {
      calls.push([url, body]);
      if (body.action === 'complete') return { ok: true };
      return { organizationId: 'owner-suborg', policy, backendPublicKey: 'key', backendUserId,
        previousPolicyIds: ['old'], policyIds: ['new', 'old'] };
    },
  });
  return { client, calls };
}

test('owner signs non-root registration, persistent policy and old grant deletion before verified completion', async () => {
  const { client, calls } = fixture();
  await client.authorize();
  assert.deepEqual(calls.map(c => c[0]), ['/api/points/turnkey/authorize-delegation', 'createUsers', 'getPolicies', 'createPolicy', 'deletePolicy', '/api/points/turnkey/authorize-delegation']);
  assert.equal(calls[1][1].users[0].apiKeys[0].expirationSeconds, undefined);
  assert.equal(calls[3][1].time, undefined);
  assert.equal(calls.at(-1)[1].policyId, 'new');
});
test('a retry reuses the owner-created policy rather than duplicating it', async () => {
  const { client, calls } = fixture({ existing: [{ ...policy, policyId: 'new' }], backendUserId: 'existing-backend' });
  await client.authorize();
  assert.ok(!calls.some(c => ['createUsers', 'createPolicy'].includes(c[0])));
});
test('expired owner login and failed deletion never claim authorization', async () => {
  for (const options of [{ ownerError: Error('login_required') }, { deleteError: Error('delete_failed') }]) {
    const { client, calls } = fixture(options);
    await assert.rejects(client.authorize());
    assert.ok(!calls.some(c => c[1].action === 'complete'));
  }
});
test('revocation deletes all managed Turnkey grants before clearing DB status', async () => {
  const { client, calls } = fixture();
  await client.revoke();
  assert.deepEqual(calls.filter(c => c[0] === 'deletePolicy').map(c => c[1].policyId), ['new', 'old']);
  assert.equal(calls.at(-1)[1].action, 'complete');
});
