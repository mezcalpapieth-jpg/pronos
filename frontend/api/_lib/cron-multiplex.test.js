import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldRunMinuteInterval } from './cron-multiplex.js';

test('shouldRunMinuteInterval fires on UTC interval boundaries', () => {
  assert.equal(
    shouldRunMinuteInterval({
      now: new Date('2026-05-15T12:30:42.000Z'),
      intervalMinutes: 15,
    }),
    true,
  );
  assert.equal(
    shouldRunMinuteInterval({
      now: new Date('2026-05-15T12:31:00.000Z'),
      intervalMinutes: 15,
    }),
    false,
  );
});

test('shouldRunMinuteInterval can be forced for manual indexer probes', () => {
  assert.equal(
    shouldRunMinuteInterval({
      now: new Date('2026-05-15T12:31:00.000Z'),
      intervalMinutes: 15,
      force: true,
    }),
    true,
  );
});
