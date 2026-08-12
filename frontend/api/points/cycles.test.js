import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const currentSource = await readFile(new URL('./cycles/current.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./admin/cycles.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');

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
});

test('points rollover archives exposure and carries only approved pre-cycle bonuses on bootstrap', () => {
  assert.match(schemaSource, /points_cycle_position_snapshots/);
  assert.match(adminSource, /archiveAndClearPositionsForCycleReset/);
  assert.match(adminSource, /cancelOpenLimitOrdersForCycleReset/);
  assert.match(adminSource, /includePreCycleCarryover:\s*true/);
  assert.match(adminSource, /PRE_CYCLE_SIGNUP_BONUS/);
  assert.match(adminSource, /PRE_CYCLE_REFERRAL_REWARD/);
  assert.match(adminSource, /PRE_CYCLE_FOLLOW_TASK_KEYS/);
  assert.match(adminSource, /SOCIAL_LINK_CARRYOVER_KINDS/);
  assert.match(adminSource, /cycle_carryover/);
});

test('public cycles prefer the active database cycle once admin opens one', () => {
  assert.match(currentSource, /dbCyclePayload/);
  assert.match(currentSource, /points:cycles:current:v4/);
  assert.match(currentSource, /if \(paused\) \{\s*return pausedPayload\(\);/);
  assert.match(currentSource, /const row = await timer\.time\('db_current'/);
  assert.match(currentSource, /return pausedPayload\(\);/);
  assert.doesNotMatch(currentSource, /tournamentPayload/);
});
