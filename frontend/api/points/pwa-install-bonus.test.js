/**
 * Mobile installed-web-app reward contract tests.
 *
 * Run with:
 *   node --test frontend/api/points/pwa-install-bonus.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bonusSource = await readFile(new URL('./pwa-install-bonus.js', import.meta.url), 'utf8');
const statusSource = await readFile(new URL('./pwa-install-status.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../../app/points/src/lib/pointsApi.js', import.meta.url), 'utf8');
const earnSource = await readFile(new URL('../../app/points/src/pages/PointsEarn.jsx', import.meta.url), 'utf8');

test('pwa install bonus is a one-time audited points credit', () => {
  assert.match(schemaSource, /points_pwa_install_claims/);
  assert.match(schemaSource, /username\s+TEXT PRIMARY KEY/);
  assert.match(bonusSource, /ON CONFLICT \(username\) DO NOTHING/);
  assert.match(bonusSource, /points_distributions/);
  assert.match(bonusSource, /pwa_install_bonus/);
  assert.match(bonusSource, /withTransaction/);
});

test('pwa install bonus requires an authenticated mobile standalone session', () => {
  assert.match(bonusSource, /requireSession/);
  assert.match(bonusSource, /sec-ch-ua-mobile/);
  assert.match(bonusSource, /displayMode === 'standalone'/);
  assert.match(bonusSource, /pwa_bonus_not_eligible/);
  assert.match(statusSource, /mobileEligible/);
});

test('points earn page surfaces the install reward from standalone mode', () => {
  assert.match(apiSource, /fetchPwaInstallStatus/);
  assert.match(apiSource, /claimPwaInstallBonus/);
  assert.match(earnSource, /display-mode: standalone/);
  assert.match(earnSource, /beforeinstallprompt/);
  assert.match(earnSource, /InstallAppBonusCard/);
});
