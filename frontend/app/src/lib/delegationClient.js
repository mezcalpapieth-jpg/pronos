const fail = code => { throw Object.assign(new Error(code), { code }); };

// No backend-held owner credentials: mutations are stamped by the OTP-bound
// browser key. Transport/client injection also exercises the real sequence in tests.
export function createDelegationClient({ post, ownerClient }) {
  async function prepareOwner(plan) {
    const client = await ownerClient(plan.organizationId);
    return { client, organizationId: plan.organizationId };
  }
  async function remove(client, organizationId, ids) {
    for (const policyId of ids) {
      const result = await client.deletePolicy({ organizationId, policyId });
      if (result.activity?.status !== 'ACTIVITY_STATUS_COMPLETED') fail('delegation_owner_approval_required');
    }
  }
  return {
    async authorize() {
      const plan = await post('/api/points/turnkey/authorize-delegation', { action: 'prepare' });
      const { client, organizationId } = await prepareOwner(plan);
      if (!plan.backendUserId) {
        const created = await client.createUsers({ organizationId, users: [{
          userName: 'Pronos trading signer',
          apiKeys: [{ apiKeyName: 'Pronos trading', publicKey: plan.backendPublicKey, curveType: 'API_KEY_CURVE_P256' }],
          authenticators: [], oauthProviders: [], userTags: [],
        }] });
        if (created.activity?.status !== 'ACTIVITY_STATUS_COMPLETED') fail('delegation_owner_approval_required');
      }
      const { policies } = await client.getPolicies({ organizationId });
      const reusable = policies.find(p => p.policyName === plan.policy.policyName
        && p.condition === plan.policy.condition && p.consensus === plan.policy.consensus
        && p.effect === 'EFFECT_ALLOW' && !p.time);
      let policyId = reusable?.policyId;
      if (!policyId) {
        const created = await client.createPolicy({ organizationId, ...plan.policy });
        if (created.activity?.status !== 'ACTIVITY_STATUS_COMPLETED' || !created.policyId) fail('delegation_owner_approval_required');
        policyId = created.policyId;
      }
      // Retry recovers a successfully created policy if completion or a prior
      // delete failed. Do not leave an older grant alive after refresh/revoke.
      await remove(client, organizationId, plan.previousPolicyIds.filter(id => id !== policyId));
      return post('/api/points/turnkey/authorize-delegation', { action: 'complete', policyId });
    },
    async revoke() {
      const plan = await post('/api/points/turnkey/revoke-delegation', { action: 'prepare' });
      if (plan.policyIds.length) {
        const { client, organizationId } = await prepareOwner(plan);
        await remove(client, organizationId, plan.policyIds);
      }
      return post('/api/points/turnkey/revoke-delegation', { action: 'complete' });
    },
  };
}
