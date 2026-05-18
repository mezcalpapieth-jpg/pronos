/**
 * Unit tests for Turnkey delegation safety invariants.
 *
 * Run with:
 *   node --test frontend/api/_lib/turnkey-delegation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDelegationPolicyExpressions,
  buildSuborgCreationParams,
} from './turnkey.js';
import { ethers } from 'ethers';
import {
  buildDelegationAllowedTargets,
  DELEGATION_ALLOWED_SELECTORS,
} from './turnkey-delegation.js';

test('new user suborgs do not install the backend API key as a root user', () => {
  const params = buildSuborgCreationParams('USER@Example.COM');

  assert.equal(params.rootQuorumThreshold, 1);
  assert.equal(params.rootUsers.length, 1);
  assert.equal(params.rootUsers[0].userEmail, 'user@example.com');
  assert.equal(params.rootUsers[0].userName, 'user@example.com');
});

test('delegated policy consensus targets the approving credential public key', () => {
  const { consensus, condition } = buildDelegationPolicyExpressions({
    backendApiPublicKey: 'abc123',
    allowedTargets: ['0xABCDEF0000000000000000000000000000000000'],
  });

  assert.equal(consensus, "credentials.any(credential, credential.public_key == 'abc123')");
  assert.match(condition, /ACTIVITY_TYPE_SIGN_TRANSACTION_V2/);
  assert.match(condition, /0xabcdef0000000000000000000000000000000000/);
});

test('delegated policy pins Arbitrum chain, zero native value, and allowed selectors', () => {
  const { condition } = buildDelegationPolicyExpressions({
    backendApiPublicKey: 'abc123',
    allowedTargets: ['0xABCDEF0000000000000000000000000000000000'],
    chainId: 42161,
    allowedFunctionSelectors: ['0x095EA7B3', '0xe24c469b'],
  });

  assert.match(condition, /activity\.params\.type == 'TRANSACTION_TYPE_ETHEREUM'/);
  assert.match(condition, /eth\.tx\.chain_id == 42161/);
  assert.match(condition, /eth\.tx\.value == 0/);
  assert.match(condition, /eth\.tx\.data\[0\.\.10\] in \['0x095ea7b3', '0xe24c469b'\]/);
});

test('delegated policy allowlist includes guarded AMM min-output selectors', () => {
  const selector = (signature) => ethers.utils.id(signature).slice(0, 10);

  for (const signature of [
    'buy(bool,uint256,uint256)',
    'sell(bool,uint256,uint256)',
    'buy(uint8,uint256,uint256)',
    'sell(uint8,uint256,uint256)',
  ]) {
    assert.ok(
      DELEGATION_ALLOWED_SELECTORS.includes(selector(signature)),
      `${signature} selector should be delegated`,
    );
  }
});

test('delegation target builder includes active protocol pools without duplicates', () => {
  const targets = buildDelegationAllowedTargets({
    cfg: {
      marketFactoryV1: '0x1111111111111111111111111111111111111111',
      marketFactoryV2: '0x2222222222222222222222222222222222222222',
      collateralToken: '0x3333333333333333333333333333333333333333',
      marketPools: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    },
    extraMarketPools: [
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'not-an-address',
    ],
  });

  assert.deepEqual(targets, [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  ]);
});
