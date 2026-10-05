import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_SEPOLIA_CHAIN_ID,
  buildOnchainResetPlan,
  formatFixedUnits,
  parseFixedUnits,
  parseOnchainResetArgs,
} from './onchain-reset-plan.js';

const ADDR = {
  token: '0x1111111111111111111111111111111111111111',
  factoryV1: '0x2222222222222222222222222222222222222222',
  factoryV2: '0x3333333333333333333333333333333333333333',
  shareTokenV1: '0x4444444444444444444444444444444444444444',
  shareTokenV2: '0x5555555555555555555555555555555555555555',
  owner: '0x6666666666666666666666666666666666666666',
  walletA: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  walletB: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

function completeEnv(overrides = {}) {
  return {
    ONCHAIN_CHAIN_ID: String(BASE_SEPOLIA_CHAIN_ID),
    ONCHAIN_RPC_URL: 'https://sepolia.base.org',
    ONCHAIN_TOURNAMENT_MXNP_ADDRESS: ADDR.token,
    ONCHAIN_COLLATERAL_ADDRESS: ADDR.token,
    ONCHAIN_MARKET_FACTORY_ADDRESS: ADDR.factoryV1,
    ONCHAIN_MARKET_FACTORY_V2_ADDRESS: ADDR.factoryV2,
    ONCHAIN_SHARE_TOKEN_ADDRESS: ADDR.shareTokenV1,
    ONCHAIN_SHARE_TOKEN_V2_ADDRESS: ADDR.shareTokenV2,
    ONCHAIN_OWNER_ADDRESS: ADDR.owner,
    ...overrides,
  };
}

test('parseFixedUnits handles MXNP values with six decimals', () => {
  assert.equal(parseFixedUnits('500'), '500000000');
  assert.equal(parseFixedUnits('1.234567'), '1234567');
  assert.equal(formatFixedUnits('1234567'), '1.234567');
  assert.throws(() => parseFixedUnits('1.2345678'), /too_many_decimal_places/);
});

test('parseOnchainResetArgs normalizes users and reset options', () => {
  const args = parseOnchainResetArgs([
    '--allocation=750.5',
    '--gas-eth=0.001',
    '--cycle-label=Octubre onchain',
    '--starts-at=2026-10-31T15:00:00-06:00',
    '--ends-at=2026-11-30T15:00:00-06:00',
    '--user=@Frmm, Alexis',
    '--user=frmm',
    '--limit=25',
    '--preview-limit=3',
    '--strict',
  ]);

  assert.equal(args.apply, false);
  assert.equal(args.strict, true);
  assert.equal(args.allocationMxnp, '750.5');
  assert.deepEqual(args.users, ['frmm', 'alexis']);
  assert.equal(args.limit, 25);
  assert.equal(args.previewLimit, 3);
});

test('buildOnchainResetPlan audits eligible users and funding totals', () => {
  const now = new Date('2026-10-05T18:00:00.000Z');
  const plan = buildOnchainResetPlan({
    env: completeEnv(),
    now,
    args: parseOnchainResetArgs([
      '--allocation=500',
      '--cycle-label=Next tournament',
      '--starts-at=2026-10-31T15:00:00.000Z',
      '--ends-at=2026-11-30T15:00:00.000Z',
      '--gas-eth=0.001',
    ]),
    users: [
      {
        username: 'frmm',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-frmm',
        delegation_policy_id: 'policy-frmm',
        delegation_expires_at: '2026-12-01T00:00:00.000Z',
      },
      {
        username: 'alexis',
        wallet_address: ADDR.walletB,
        turnkey_sub_org_id: 'suborg-alexis',
        delegation_policy_id: null,
      },
      {
        username: 'missingwallet',
        wallet_address: null,
        turnkey_sub_org_id: 'suborg-missing',
      },
    ],
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.reset.cycleLabel, 'Next tournament');
  assert.equal(plan.users.selectedRows, 3);
  assert.equal(plan.users.eligibleCount, 2);
  assert.equal(plan.users.missingWalletCount, 1);
  assert.equal(plan.users.needsDelegationCount, 2);
  assert.deepEqual(plan.users.missingWalletPreview, ['missingwallet']);
  assert.equal(plan.funding.mxnp.amountPerWalletMxnp, '500.000000');
  assert.equal(plan.funding.mxnp.totalMxnp, '1000.000000');
  assert.equal(plan.funding.gas.totalEth, '0.002');
});

test('buildOnchainResetPlan reports missing Sepolia env and rejects apply mode', () => {
  const plan = buildOnchainResetPlan({
    env: {
      ONCHAIN_CHAIN_ID: '42161',
    },
    now: new Date('2026-10-05T18:00:00.000Z'),
    args: parseOnchainResetArgs(['--apply']),
    users: [],
  });
  const blockerIds = plan.blockers.map(b => b.id);

  assert.equal(plan.ok, false);
  assert.equal(plan.dryRun, false);
  assert.ok(blockerIds.includes('apply_not_implemented'));
  assert.ok(blockerIds.includes('chain_not_base_sepolia'));
  assert.ok(blockerIds.includes('onchain_rpc_url_missing'));
  assert.ok(blockerIds.includes('onchain_tournament_mxnp_address_missing'));
  assert.ok(blockerIds.includes('no_eligible_wallets'));
});

test('buildOnchainResetPlan validates gas funding estimate', () => {
  const plan = buildOnchainResetPlan({
    env: completeEnv(),
    now: new Date('2026-10-05T18:00:00.000Z'),
    args: parseOnchainResetArgs(['--gas-eth=0.0000000000000000001']),
    users: [
      {
        username: 'frmm',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-frmm',
      },
    ],
  });
  const blockerIds = plan.blockers.map(b => b.id);

  assert.equal(plan.ok, false);
  assert.ok(blockerIds.includes('invalid_gas_eth'));
});

test('buildOnchainResetPlan blocks duplicate wallets and missing requested users', () => {
  const plan = buildOnchainResetPlan({
    env: completeEnv(),
    now: new Date('2026-10-05T18:00:00.000Z'),
    args: parseOnchainResetArgs(['--user=frmm,missing']),
    users: [
      {
        username: 'frmm',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-frmm',
      },
      {
        username: 'other',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-other',
      },
    ],
  });
  const blockerIds = plan.blockers.map(b => b.id);

  assert.equal(plan.ok, false);
  assert.ok(blockerIds.includes('requested_users_missing'));
  assert.equal(plan.users.eligibleCount, 1);
  assert.equal(plan.users.missingRequestedUsers[0], 'missing');
  assert.deepEqual(plan.users.duplicateWallets, []);
});

test('buildOnchainResetPlan blocks duplicate selected wallet mappings', () => {
  const plan = buildOnchainResetPlan({
    env: completeEnv(),
    now: new Date('2026-10-05T18:00:00.000Z'),
    args: parseOnchainResetArgs([]),
    users: [
      {
        username: 'frmm',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-frmm',
      },
      {
        username: 'other',
        wallet_address: ADDR.walletA,
        turnkey_sub_org_id: 'suborg-other',
      },
    ],
  });
  const blockerIds = plan.blockers.map(b => b.id);

  assert.equal(plan.ok, false);
  assert.ok(blockerIds.includes('duplicate_wallets'));
  assert.equal(plan.users.duplicateWallets[0].walletAddress, ADDR.walletA);
  assert.deepEqual(plan.users.duplicateWallets[0].usernames, ['frmm', 'other']);
});
