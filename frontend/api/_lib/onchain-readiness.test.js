import assert from 'node:assert/strict';
import test from 'node:test';

import { collectOnchainReadiness } from './onchain-readiness.js';

const ADDR = {
  factoryV1: '0x1111111111111111111111111111111111111111',
  factoryV2: '0x2222222222222222222222222222222222222222',
  collateral: '0x3333333333333333333333333333333333333333',
  deployer: '0x4444444444444444444444444444444444444444',
  resolver: '0x5555555555555555555555555555555555555555',
  poolA: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  poolB: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
};

function completeEnv(overrides = {}) {
  return {
    DATABASE_URL: 'postgres://db',
    ONCHAIN_RPC_URL: 'https://arb1.arbitrum.io/rpc',
    ARB_RPC_URL: 'https://arb1.arbitrum.io/rpc',
    ONCHAIN_CHAIN_ID: '42161',
    CHAIN_ID: '42161',
    PROTOCOL_CHAIN_ID: '42161',
    ONCHAIN_MARKET_FACTORY_ADDRESS: ADDR.factoryV1,
    ONCHAIN_MARKET_FACTORY_V2_ADDRESS: ADDR.factoryV2,
    FACTORY_ADDRESS: ADDR.factoryV1,
    PRONOS_FACTORY_ADDRESS: ADDR.factoryV1,
    FACTORY_V2_ADDRESS: ADDR.factoryV2,
    PRONOS_FACTORY_V2_ADDRESS: ADDR.factoryV2,
    ONCHAIN_COLLATERAL_ADDRESS: ADDR.collateral,
    ONCHAIN_DEPLOYER_SUBORG_ID: 'deployer-suborg',
    ONCHAIN_DEPLOYER_ADDRESS: ADDR.deployer,
    ONCHAIN_RESOLVER_SUBORG_ID: 'resolver-suborg',
    ONCHAIN_RESOLVER_ADDRESS: ADDR.resolver,
    ADMIN_SAFE_ADDRESS: '0x6666666666666666666666666666666666666666',
    RESOLVER_SAFE_ADDRESS: '0x7777777777777777777777777777777777777777',
    ONCHAIN_OWNER_SUBORG_ID: 'owner-suborg',
    ONCHAIN_OWNER_ADDRESS: '0x8888888888888888888888888888888888888888',
    TURNKEY_POLICIES_ENABLED: 'true',
    TURNKEY_ORGANIZATION_ID: 'parent-org',
    TURNKEY_API_PUBLIC_KEY: 'pub',
    TURNKEY_API_PRIVATE_KEY: 'priv',
    VITE_TURNKEY_ORGANIZATION_ID: 'parent-org',
    VITE_ONCHAIN_CHAIN_ID: '42161',
    VITE_PRONOS_ARBITRUM_FACTORY: ADDR.factoryV1,
    VITE_PRONOS_ARBITRUM_FACTORY_V2: ADDR.factoryV2,
    VITE_PRONOS_ARBITRUM_TOKEN: ADDR.collateral,
    INDEXER_KEY: 'indexer-key',
    CRON_SECRET: 'cron-secret',
    JUNO_API_KEY: 'juno-key',
    JUNO_API_SECRET: 'juno-secret',
    JUNO_BEARER_TOKEN: 'juno-bearer',
    JUNO_API_BASE_URL: 'https://stage.buildwithjuno.com',
    JUNO_WEBHOOK_SECRET: 'juno-webhook-secret',
    ONCHAIN_MARKET_POOL_ADDRESSES: ADDR.poolA,
    ...overrides,
  };
}

test('collectOnchainReadiness reports missing Turnkey and deployment env', () => {
  const result = collectOnchainReadiness({
    env: { ONCHAIN_CHAIN_ID: '42161' },
    protocolPools: [],
  });
  const warnings = result.warnings.join('\n');

  assert.equal(result.ok, false);
  assert.equal(result.env.chainId, 42161);
  assert.equal(result.turnkey.serverConfigured, false);
  assert.match(warnings, /TURNKEY_ORGANIZATION_ID missing/);
  assert.match(warnings, /TURNKEY_API_PUBLIC_KEY missing/);
  assert.match(warnings, /VITE_TURNKEY_ORGANIZATION_ID missing/);
  assert.match(warnings, /ONCHAIN_DEPLOYER_SUBORG_ID missing/);
  assert.match(warnings, /ONCHAIN_RESOLVER_SUBORG_ID missing/);
  assert.match(warnings, /INDEXER_KEY missing/);
  assert.match(warnings, /CRON_SECRET missing/);
  assert.match(warnings, /JUNO_API_KEY missing/);
  assert.match(warnings, /JUNO_WEBHOOK_SECRET missing/);
});

test('collectOnchainReadiness returns grouped mainnet launch blockers and review checks', () => {
  const result = collectOnchainReadiness({
    env: {
      ONCHAIN_CHAIN_ID: '42161',
      DATABASE_URL: 'postgres://db',
      ONCHAIN_RPC_URL: 'https://arb1.arbitrum.io/rpc',
      ONCHAIN_MARKET_FACTORY_ADDRESS: ADDR.factoryV1,
      ONCHAIN_MARKET_FACTORY_V2_ADDRESS: ADDR.factoryV2,
      ONCHAIN_COLLATERAL_ADDRESS: ADDR.collateral,
      ONCHAIN_DEPLOYER_SUBORG_ID: 'deployer-suborg',
      ONCHAIN_DEPLOYER_ADDRESS: ADDR.deployer,
      TURNKEY_POLICIES_ENABLED: 'false',
      TURNKEY_ORGANIZATION_ID: 'parent-org',
      TURNKEY_API_PUBLIC_KEY: 'pub',
      TURNKEY_API_PRIVATE_KEY: 'priv',
      VITE_TURNKEY_ORGANIZATION_ID: 'parent-org',
      INDEXER_KEY: 'indexer-key',
      CRON_SECRET: 'cron-secret',
    },
    protocolPools: [],
  });

  const blockerIds = result.launch.blockers.map(b => b.id);
  const reviewIds = result.launch.reviews.map(r => r.id);

  assert.equal(result.launch.ready, false);
  assert.ok(blockerIds.includes('turnkey_policies_disabled'));
  assert.ok(blockerIds.includes('resolver_wallet_missing'));
  assert.ok(blockerIds.includes('juno_provider_missing'));
  assert.ok(blockerIds.includes('owner_controls_missing'));
  assert.ok(reviewIds.includes('gas_sponsorship_unset'));
  assert.ok(result.launch.nextSteps.some(step => /JUNO_API_KEY/.test(step)));
  assert.ok(result.launch.nextSteps.some(step => /ONCHAIN_RESOLVER_SUBORG_ID/.test(step)));
});

test('collectOnchainReadiness includes Juno funding readiness', () => {
  const result = collectOnchainReadiness({
    env: completeEnv({
      JUNO_CARD_CHECKOUT_ENABLED: 'true',
      JUNO_APPLE_PAY_ENABLED: 'true',
      JUNO_WITHDRAWALS_ENABLED: 'false',
    }),
    protocolPools: [ADDR.poolA],
  });

  assert.equal(result.juno.configured, true);
  assert.equal(result.juno.cardCheckoutEnabled, true);
  assert.equal(result.juno.applePayEnabled, true);
  assert.equal(result.juno.withdrawalsEnabled, false);
  assert.equal(result.launch.ready, true);
  assert.ok(result.launch.reviews.some(r => r.id === 'juno_withdrawals_manual_queue'));
  assert.doesNotMatch(result.warnings.join('\n'), /JUNO_API_KEY missing/);
});

test('collectOnchainReadiness catches deployment alias mismatches', () => {
  const result = collectOnchainReadiness({
    env: completeEnv({
      VITE_ONCHAIN_CHAIN_ID: '421614',
      FACTORY_ADDRESS: '0xffffffffffffffffffffffffffffffffffffffff',
      VITE_PRONOS_ARBITRUM_FACTORY_V2: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      VITE_PRONOS_ARBITRUM_TOKEN: '0xdddddddddddddddddddddddddddddddddddddddd',
    }),
    protocolPools: [ADDR.poolA],
  });
  const warnings = result.warnings.join('\n');

  assert.equal(result.ok, false);
  assert.match(warnings, /VITE_ONCHAIN_CHAIN_ID=421614 does not match ONCHAIN_CHAIN_ID=42161/);
  assert.match(warnings, /FACTORY_ADDRESS does not match ONCHAIN_MARKET_FACTORY_ADDRESS/);
  assert.match(warnings, /VITE_PRONOS_ARBITRUM_FACTORY_V2 does not match ONCHAIN_MARKET_FACTORY_V2_ADDRESS/);
  assert.match(warnings, /VITE_PRONOS_ARBITRUM_TOKEN does not match ONCHAIN_COLLATERAL_ADDRESS/);
});

test('collectOnchainReadiness reports env pool gaps without failing DB-backed policy autofill', () => {
  const result = collectOnchainReadiness({
    env: completeEnv(),
    protocolPools: [ADDR.poolA, ADDR.poolB],
  });

  assert.equal(result.ok, true);
  assert.equal(result.policy.configuredPoolCount, 1);
  assert.equal(result.policy.autoIncludesIndexedPools, true);
  assert.deepEqual(result.policy.missingPools, [ADDR.poolB]);
  assert.doesNotMatch(result.warnings.join('\n'), /ONCHAIN_MARKET_POOL_ADDRESSES missing/);
});
