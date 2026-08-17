import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./Sparkline.jsx', import.meta.url), 'utf8');

test('sparkline renders real trade activity without synthetic price smoothing', () => {
  assert.match(source, /activity = \[\]/);
  assert.match(source, /activityPoints/);
  assert.match(source, /volume > 0 \? pt\.volume : pt\.count/);
  assert.match(source, /sellVolume > pt\.buyVolume/);
  assert.match(source, /<rect/);
  assert.match(source, /rx=\{0\.8\}/);
  assert.doesNotMatch(source, /activityMarkers|showActivityMarkers|-marker-/);
  assert.match(source, /timeBounds/);
  assert.match(source, /xForTime/);
  assert.match(source, /yAxisGutter/);
  assert.match(source, /plotRight/);
  assert.match(source, /Math\.min\(34, Math\.max\(28, chartWidth \* 0\.06\)\)/);
  assert.doesNotMatch(source, /const times = \[\.\.\.priceTimes, \.\.\.activityTimes\]/);
  assert.match(source, /price holds where it was until the next trade/);
  assert.doesNotMatch(source, /curveBasis|curveMonotone|Math\.random/);
});

test('sparkline steps between snapshots instead of drawing invented drift', () => {
  // Each segment is a horizontal hold at the previous price followed by
  // a vertical jump — never a diagonal between two sparse trades.
  assert.match(source, /L\$\{pts\[i\]\.x\.toFixed\(2\)\},\$\{pts\[i - 1\]\.y\.toFixed\(2\)\}/);
  assert.match(source, /L\$\{pts\[i\]\.x\.toFixed\(2\)\},\$\{pts\[i\]\.y\.toFixed\(2\)\}/);
});

test('sparkline fits the y axis to the data instead of always spanning 0-100', () => {
  assert.match(source, /function priceDomain/);
  assert.match(source, /MIN_DOMAIN_SPAN/);
  assert.match(source, /function axisTicks/);
  assert.match(source, /yForValue/);
  // The old hardcoded full-range ladder must be gone.
  assert.doesNotMatch(source, /\[100, 75, 50, 25, 0\]/);
});

test('sparkline renders a time axis and true-scale geometry', () => {
  assert.match(source, /shouldShowXAxis/);
  assert.match(source, /formatAxisTick/);
  assert.match(source, /xTicks/);
  // viewBox must track measured pixels, not a fixed stretched space.
  assert.match(source, /ResizeObserver/);
  assert.match(source, /measuredWidth/);
  assert.doesNotMatch(source, /preserveAspectRatio="none"/);
});

test('sparkline pins the end label above the last point', () => {
  assert.match(source, /const endLabelX = Math\.max/);
  assert.match(source, /left: `\$\{endLabelX\}px`/);
  assert.match(source, /transform: 'translate\(-50%, calc\(-100% - 8px\)\)'/);
  assert.doesNotMatch(source, /right: yAxisGutter \+ 6/);
});
