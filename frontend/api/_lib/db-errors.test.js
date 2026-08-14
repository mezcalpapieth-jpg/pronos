import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDatabaseQuotaError,
  socialTasksUnavailablePayload,
} from './db-errors.js';

test('isDatabaseQuotaError detects Neon compute quota failures', () => {
  assert.equal(
    isDatabaseQuotaError(new Error('Server error (HTTP status 402): {"message":"Your account or project has exceeded the compute time quota."}')),
    true,
  );
  assert.equal(
    isDatabaseQuotaError({ status: 402, message: 'payment required' }),
    true,
  );
  assert.equal(
    isDatabaseQuotaError(new Error('column "reviewer" does not exist')),
    false,
  );
});

test('socialTasksUnavailablePayload returns an empty queue with an explicit unavailable flag', () => {
  assert.deepEqual(socialTasksUnavailablePayload(), {
    tasks: [],
    unavailable: true,
    error: 'db_quota_exceeded',
  });
});
