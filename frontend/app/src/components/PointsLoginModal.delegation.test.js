import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const loginSource = await readFile(new URL('./PointsLoginModal.jsx', import.meta.url), 'utf8');
const delegationSource = await readFile(new URL('./DelegationPrompt.jsx', import.meta.url), 'utf8');
const mvpAppSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const pointsAppSource = await readFile(new URL('../../points/src/App.jsx', import.meta.url), 'utf8');
const authorizeEndpointSource = await readFile(new URL('../../../api/points/turnkey/authorize-delegation.js', import.meta.url), 'utf8');

test('delegated signing prompt is MVP-only during signup', () => {
  assert.match(loginSource, /enableDelegationStep\s*=\s*false/);
  assert.match(loginSource, /if \(enableDelegationStep\)[\s\S]*setStep\('delegate'\)/);
  assert.match(mvpAppSource, /<PointsLoginModal[\s\S]*enableDelegationStep/);
  assert.doesNotMatch(pointsAppSource, /enableDelegationStep/);
});

test('delegation prompt copy avoids emoji and raw Turnkey details', () => {
  assert.doesNotMatch(loginSource, /🎁/u);
  assert.doesNotMatch(delegationSource, /⚡|🔒|🚪|📅/u);
  assert.doesNotMatch(delegationSource, /Error:\s*\{err\}/);
  assert.doesNotMatch(delegationSource, /e\?\.detail/);
  assert.doesNotMatch(authorizeEndpointSource, /detail:\s*e\?\.message/);
});
