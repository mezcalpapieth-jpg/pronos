import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./strategies.js', import.meta.url), 'utf8');

test('admin strategies endpoint audits combinadas and long hold read-only', () => {
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /points_parlay_tickets/);
  assert.match(source, /points_parlay_legs/);
  assert.match(source, /buildTournamentLeaderboardRows/);
  assert.match(source, /includeConvictionBreakdown:\s*true/);
  assert.match(source, /points_cycle_snapshots/);
  assert.match(source, /derivedStatus/);
  assert.doesNotMatch(source, /settleOpenParlayTickets/);
  assert.doesNotMatch(source, /INSERT INTO/);
  assert.doesNotMatch(source, /UPDATE points_/);
});
