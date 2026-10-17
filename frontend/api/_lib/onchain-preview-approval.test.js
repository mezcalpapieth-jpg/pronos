import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingApprovalOptions, pendingApprovalSettings } from './onchain-preview-approval.js';

const previewEnv = {
  ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'onchain-sepolia',
  ONCHAIN_CHAIN_ID: '421614',
};
const onchainOpts = { mode: 'onchain', chainId: 421614, autoDeploy: true };

test('only the opted-in onchain-sepolia Arbitrum Sepolia preview defaults to on-chain', () => {
  assert.deepEqual(pendingApprovalSettings(previewEnv), {
    previewEnabled: true, defaultMode: 'onchain', chainId: 421614,
  });
  assert.deepEqual(pendingApprovalOptions({ action: 'approve' }, previewEnv), onchainOpts);
});

for (const [name, overrides] of [
  ['production even with the flag on', { VERCEL_ENV: 'production' }],
  ['local development', { VERCEL_ENV: 'development' }],
  ['missing deployment metadata', { VERCEL_ENV: undefined }],
  ['pointbreak previews', { VERCEL_GIT_COMMIT_REF: 'pointbreak' }],
  ['other branches', { VERCEL_GIT_COMMIT_REF: 'onchain-points' }],
  ['disabled flag', { ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'false' }],
  ['missing flag', { ONCHAIN_PREVIEW_APPROVALS_ENABLED: undefined }],
  ['Arbitrum mainnet', { ONCHAIN_CHAIN_ID: '42161' }],
  ['Base Sepolia', { ONCHAIN_CHAIN_ID: '84532' }],
  ['missing chain', { ONCHAIN_CHAIN_ID: undefined }],
  ['malformed chain', { ONCHAIN_CHAIN_ID: '421614extra' }],
]) {
  test(`${name} keeps existing Points approval behavior`, () => {
    const env = { ...previewEnv, ...overrides };
    assert.deepEqual(pendingApprovalSettings(env), {
      previewEnabled: false, defaultMode: 'points', chainId: null,
    });
    assert.notEqual(pendingApprovalOptions({ action: 'approve' }, env).mode, 'onchain');
    assert.doesNotThrow(() => pendingApprovalOptions({ action: 'approve_all' }, env));
    assert.throws(() => pendingApprovalOptions({ previewApprovalMode: 'onchain' }, env),
      { message: 'preview_approvals_disabled', status: 403 });
  });
}

test('preview admin can explicitly choose Points for single or bulk approval', () => {
  for (const action of ['approve', 'approve_all']) {
    assert.deepEqual(pendingApprovalOptions({ action, previewApprovalMode: 'points' }, previewEnv), { mode: 'points' });
  }
});

test('preview selector pins deployment to Sepolia and ignores browser-supplied contract coordinates', () => {
  assert.deepEqual(pendingApprovalOptions({
    action: 'approve', previewApprovalMode: 'onchain',
    mode: 'points', chainId: 42161, chainAddress: '0x123', chainMarketId: 42, autoDeploy: false,
  }, previewEnv), onchainOpts);
  assert.throws(() => pendingApprovalOptions({ previewApprovalMode: 'typo' }, previewEnv),
    { message: 'invalid_preview_approval_mode', status: 400 });
});

test('implicit, selected and legacy explicit on-chain bulk approval are all rejected', () => {
  for (const body of [{}, { previewApprovalMode: 'onchain' }, { mode: 'onchain', chainId: 421614 }]) {
    assert.throws(() => pendingApprovalOptions({ action: 'approve_all', ...body }, previewEnv),
      { message: 'bulk_approve_onchain_unsupported', status: 400 });
  }
  assert.throws(() => pendingApprovalOptions({ action: 'approve_all', mode: 'onchain' }, {}),
    { message: 'bulk_approve_onchain_unsupported', status: 400 });
});

test('legacy explicit MVP approval options remain supported without enabling the preview setting', () => {
  const body = { mode: 'onchain', chainId: 42161, chainAddress: '0x123', chainMarketId: '42', autoDeploy: false };
  assert.deepEqual(pendingApprovalOptions(body, { VERCEL_ENV: 'production' }), body);
  assert.throws(() => pendingApprovalOptions(body, previewEnv), { message: 'invalid_preview_chain', status: 400 });
});
