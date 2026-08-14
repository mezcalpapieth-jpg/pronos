/**
 * Static checks for the public Points surface and gated MVP preview.
 *
 * Run with:
 *   node --test frontend/app/points/src/main.access-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pointsMain = await readFile(new URL('./main.jsx', import.meta.url), 'utf8');
const mvpMain = await readFile(new URL('../../src/main.jsx', import.meta.url), 'utf8');

test('points app does not mount the MVP password gate', () => {
  assert.doesNotMatch(pointsMain, /PasswordGate/);
});

test('mvp preview still mounts the password gate', () => {
  assert.match(mvpMain, /import PasswordGate/);
  assert.match(mvpMain, /<PasswordGate>/);
});
