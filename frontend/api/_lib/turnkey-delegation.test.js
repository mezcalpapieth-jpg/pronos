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
