import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const currentSource = await readFile(new URL('./cycles/current.js', import.meta.url), 'utf8');
const historySource = await readFile(new URL('./cycles/history.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./admin/cycles.js', import.meta.url), 'utf8');
const snapshotCronSource = await readFile(new URL('../cron/points-tournament-snapshot.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const vercelSource = await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8');
const frontendVercelSource = await readFile(new URL('../../vercel.json', import.meta.url), 'utf8');

test('public points cycles default to a paused coming-soon state', () => {
  assert.match(schemaSource, /points_app_settings/);
  assert.match(currentSource, /CYCLES_PAUSED_KEY\s*=\s*'points_cycles_paused'/);
  assert.match(currentSource, /parseSettingBool\(rows\[0\]\?\.value,\s*true\)/);
  assert.match(currentSource, /pausedPayload/);
  assert.match(currentSource, /Próximamente/);
  assert.doesNotMatch(currentSource, /INSERT INTO points_cycles/);
});

test('points admin can pause and later reopen public cycles', () => {
  assert.match(adminSource, /action === 'pause'/);
  assert.match(adminSource, /setCyclesPaused\(client,\s*true\)/);
  assert.match(adminSource, /setCyclesPaused\(client,\s*false\)/);
  assert.match(adminSource, /restarted:\s*true/);
  assert.match(adminSource, /openNewCycle/);
  assert.match(adminSource, /cycleWindowForOpen/);
  assert.match(adminSource, /configured\.status === 'scheduled'/);
  assert.match(adminSource, /startIso:\s*configured\.startsAt/);
  assert.match(adminSource, /configuredCycleEndIso/);
  assert.match(adminSource, /cycleEndIso/);
});

test('points rollover archives exposure and carries only approved pre-cycle bonuses on bootstrap', () => {
  assert.match(schemaSource, /points_cycle_position_snapshots/);
  assert.match(adminSource, /archiveAndClearPositionsForCycleReset/);
  assert.match(adminSource, /cancelOpenLimitOrdersForCycleReset/);
  assert.match(adminSource, /getCyclesPausedForClient/);
  assert.match(adminSource, /includePreCycleCarryover:\s*wasPaused/);
  assert.match(adminSource, /includePreCycleCarryover:\s*true/);
  assert.match(adminSource, /PRE_CYCLE_SIGNUP_BONUS/);
  assert.match(adminSource, /PRE_CYCLE_REFERRAL_REWARD/);
  assert.match(adminSource, /PRE_CYCLE_REFERRAL_CAP/);
  assert.match(adminSource, /LEAST\(COUNT\(\*\)::numeric,\s*\$3::numeric\)/);
  assert.match(adminSource, /FROM social_tasks\s+WHERE status = 'approved'/);
  assert.match(adminSource, /SOCIAL_LINK_CARRYOVER_KINDS/);
  assert.match(adminSource, /cycle_carryover/);
  assert.match(adminSource, /action === 'apply_pre_cycle_carryover'/);
  assert.match(adminSource, /applyPreCycleCarryoverForCycle/);
  assert.match(adminSource, /WHERE kind = 'cycle_carryover'[\s\S]*AND reference_id = \$1/);
});

test('points cycle cutoff snapshot freezes leaderboard without rolling over', () => {
  assert.match(adminSource, /action === 'snapshot_cutoff'/);
  assert.match(adminSource, /handleSnapshotCutoff/);
  assert.match(adminSource, /action === 'standings_snapshot'/);
  assert.match(adminSource, /handleGetStandingsSnapshot/);
  assert.match(adminSource, /readCycleSnapshotRows/);
  assert.match(adminSource, /buildTournamentLeaderboardRows/);
  assert.match(adminSource, /snapshotActiveCycleAtCutoff/);
  assert.match(adminSource, /cutoffSnapshotTaken/);
  assert.match(adminSource, /snapshot_count/);
  assert.match(snapshotCronSource, /snapshotActiveCycleAtCutoff/);
  assert.match(snapshotCronSource, /tournament_snapshot_failed/);
  assert.match(snapshotCronSource, /does not close the cycle/);
  assert.match(snapshotCronSource, /does not close the cycle, clear positions, cancel\s*\n \* orders, or reset balances/);
  assert.match(vercelSource, /"path": "\/api\/cron\/points-tournament-snapshot"[\s\S]*"schedule": "59 5 \* \* \*"/);
  assert.match(frontendVercelSource, /"path": "\/api\/cron\/points-tournament-snapshot"[\s\S]*"schedule": "59 5 \* \* \*"/);
  assert.doesNotMatch(snapshotCronSource, /archiveAndClearPositionsForCycleReset|cancelOpenLimitOrdersForCycleReset|resetBalancesForCycle/);
});

test('public cycles prefer the active database cycle once admin opens one', () => {
  assert.match(currentSource, /dbCyclePayload/);
  assert.match(currentSource, /configuredCycleWindowFromRow/);
  assert.match(currentSource, /points:cycles:current:v4/);
  assert.match(currentSource, /if \(paused\) \{\s*return pausedPayload\(\);/);
  assert.match(currentSource, /const row = await timer\.time\('db_current'/);
  assert.match(currentSource, /return pausedPayload\(\);/);
  assert.doesNotMatch(currentSource, /tournamentPayload/);
});

test('public cycle history exposes enough rows for expanded tournament leaderboards', () => {
  assert.match(historySource, /top-20 snapshot/);
  assert.match(historySource, /CYCLE_HISTORY_LEADERBOARD_LIMIT = 20/);
  assert.match(historySource, /rank <= \$\{CYCLE_HISTORY_LEADERBOARD_LIMIT\}/);
  assert.match(historySource, /points:cycles:history:v4/);
  assert.match(historySource, /u\.profile_image_url/);
  assert.match(historySource, /profileImageUrl:\s*s\.profile_image_url \|\| null/);
});
