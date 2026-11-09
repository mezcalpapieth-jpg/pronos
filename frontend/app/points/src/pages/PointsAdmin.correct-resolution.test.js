import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const operationsSource = await readFile(new URL('./PointsAdminOperations.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('admin markets table can correct a resolved market outcome', () => {
  assert.match(adminSource, /adminCorrectResolution/);
  assert.match(adminSource, /reviewSettlement\('correct', m, winnerIndex\)/);
  assert.match(adminSource, /<SettlementReview/);
  assert.match(operationsSource, /Cobros a revertir/);
  assert.match(operationsSource, /expectedResolvedAt/);
  assert.match(adminSource, /actionLabel="Cambiar a"/);
  assert.match(adminSource, /multiple=\{m\.ammMode === 'parallel'\}/);
  assert.match(adminSource, /normalizeOutcomeSelection/);
  assert.match(adminSource, /resolvedOutcomeIndexes/);
});

test('points api client posts correction requests to the admin endpoint', () => {
  assert.match(apiSource, /export async function adminCorrectResolution/);
  assert.match(apiSource, /\/api\/points\/admin\/correct-resolution/);
  assert.match(apiSource, /winningOutcomeIndex/);
  assert.match(apiSource, /winningOutcomeIndexes/);
});
