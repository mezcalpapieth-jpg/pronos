import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');

test('points create form can attach resolver source and criteria', () => {
  assert.match(source, /resolutionSource/);
  assert.match(source, /resolutionCriteria/);
  assert.match(source, /imageUrl/);
  assert.match(source, /Imagen del mercado/);
  assert.match(source, /MarketImageField/);
  assert.match(source, /marketImageSrc/);
  assert.match(source, /Fuente de resolución/);
  assert.match(source, /Criterio de resolución/);
  assert.match(source, /resolverType:\s*'manual_review'/);
  assert.match(source, /imageUrl:\s*form\.imageUrl\.trim\(\) \|\| null/);
  assert.match(source, /inegi\.org\.mx\/app\/saladeprensa/);
  assert.match(source, /Por resolver cuando cierre/);
});
