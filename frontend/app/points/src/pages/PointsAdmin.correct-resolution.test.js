import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('admin markets table can correct a resolved market outcome', () => {
  assert.match(adminSource, /adminCorrectResolution/);
  assert.match(adminSource, /const \[correcting, setCorrecting\]/);
  assert.match(adminSource, /async function correctResolution/);
  assert.match(adminSource, /Cambiar resolución/);
  assert.match(adminSource, /Se revertirán cobros que ahora sean perdedores/);
  assert.match(adminSource, /buttonLabel="Corregir"/);
  assert.match(adminSource, /actionLabel="Cambiar a"/);
});

test('points api client posts correction requests to the admin endpoint', () => {
  assert.match(apiSource, /export async function adminCorrectResolution/);
  assert.match(apiSource, /\/api\/points\/admin\/correct-resolution/);
  assert.match(apiSource, /winningOutcomeIndex/);
});
