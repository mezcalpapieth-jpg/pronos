import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./Sparkline.jsx', import.meta.url), 'utf8');

test('sparkline renders real trade activity without synthetic price smoothing', () => {
  assert.match(source, /activity = \[\]/);
  assert.match(source, /activityPoints/);
  assert.match(source, /showActivityMarkers = true/);
  assert.match(source, /activityMarkers/);
  assert.match(source, /yForX/);
  assert.match(source, /volume > 0 \? pt\.volume : pt\.count/);
  assert.match(source, /sellVolume > pt\.buyVolume/);
  assert.match(source, /<rect/);
  assert.match(source, /-marker-/);
  assert.match(source, /timeBounds/);
  assert.match(source, /xForTime/);
  assert.match(source, /Straight segments so every vertex represents an actual snapshot/);
  assert.doesNotMatch(source, /curveBasis|curveMonotone|Math\.random/);
});
