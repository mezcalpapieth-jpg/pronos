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
