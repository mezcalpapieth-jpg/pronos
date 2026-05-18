import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const leaderboardSource = await readFile(new URL('./leaderboard.js', import.meta.url), 'utf8').catch(() => '');
const profileSource = await readFile(new URL('./u.js', import.meta.url), 'utf8').catch(() => '');

test('protocol leaderboard is on-chain, searchable, and has no cycle dependency', () => {
  assert.match(leaderboardSource, /GET \/api\/protocol\/leaderboard/);
  assert.match(leaderboardSource, /buildProtocolLeaderboardPayload/);
  assert.match(leaderboardSource, /points_users/);
  assert.match(leaderboardSource, /outcome_positions/);
  assert.match(leaderboardSource, /redemptions/);
  assert.match(leaderboardSource, /balanceOf/);
  assert.match(leaderboardSource, /query/);
  assert.doesNotMatch(leaderboardSource, /points_cycles|cycle_snapshots|cycles\/current/);
});

test('protocol public profile is username-based and reuses on-chain leaderboard metrics', () => {
  assert.match(profileSource, /GET \/api\/protocol\/u\?username=<name>/);
  assert.match(profileSource, /buildProtocolUserProfilePayload/);
  assert.match(profileSource, /points_users/);
  assert.match(profileSource, /outcome_positions/);
  assert.match(profileSource, /redemptions/);
  assert.match(profileSource, /username_required/);
  assert.doesNotMatch(profileSource, /points_cycles|cycle_snapshots|cycles\/current/);
});
