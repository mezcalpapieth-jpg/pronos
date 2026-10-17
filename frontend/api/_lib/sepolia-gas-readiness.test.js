import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { collectOnchainReadiness } from './onchain-readiness.js';
import { probeGasFunding } from './sepolia-gas-readiness.js';

const env = { ONCHAIN_AUTO_GAS_FUNDING_ENABLED: 'true', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_GAS_FUNDER_ADDRESS: `0x${'1'.repeat(40)}`, ONCHAIN_GAS_FUNDER_SUBORG_ID: 'funder',
  DATABASE_URL: 'postgres://test@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_RPC_URL: 'https://rpc.invalid', TURNKEY_POLICIES_ENABLED: 'true',
  TURNKEY_ORGANIZATION_ID: 'org', TURNKEY_API_PUBLIC_KEY: 'test', TURNKEY_API_PRIVATE_KEY: 'test' };
function fixture() {
  const tables = { lock_ready: true, ledger_ready: true };
  const state = { lock_access: true, ledger_access: true, funder_matches: true, proven: true, pending: 0, spent: '0' };
  const args = { env, provider: { getNetwork: async () => ({ chainId: 421614 }), getCode: async () => '0x',
    getBalance: async () => ethers.utils.parseEther('1') },
    sql: async strings => [strings.join('').includes('to_regclass') ? tables : state] };
  return { args, tables, state };
}
test('configuration never claims gas readiness or confirmed signing evidence', () => {
  const result = collectOnchainReadiness({ env });
  assert.equal(result.gas.autoFunding.configured, true);
  assert.equal(result.gas.autoFunding.ready, false);
  assert.equal(result.gas.autoFunding.signerVerified, false);
  assert.ok(result.launch.reviews.some(r => r.id === 'gas_auto_funding_unverified'));
  assert.ok(!result.launch.reviews.some(r => r.id === 'gas_sponsorship_unset'));
});
test('live probe requires schema/write access, signer evidence, reserve, budget and no unresolved transfer', async () => {
  assert.equal((await probeGasFunding(fixture().args)).ready, true);
  for (const change of [
    f => { f.tables.ledger_ready = false; }, f => { f.state.lock_access = false; },
    f => { f.state.ledger_access = false; }, f => { f.state.proven = false; },
    f => { f.state.pending = 1; }, f => { f.state.funder_matches = false; },
    f => { f.state.spent = ethers.utils.parseEther('0.1').toString(); },
    f => { f.args.provider.getBalance = async () => ethers.utils.parseEther('0.01'); },
    f => { f.args.provider.getNetwork = async () => ({ chainId: 42161 }); },
    f => { f.args.provider.getCode = async () => '0x1234'; },
  ]) {
    const f = fixture(); change(f);
    assert.equal((await probeGasFunding(f.args)).ready, false);
  }
});
