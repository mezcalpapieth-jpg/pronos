import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./positions.js', import.meta.url), 'utf8');

test('positions only exposes current-cycle holdings', () => {
  assert.match(source, /readActiveCycleWindow/);
  assert.match(source, /scoringStartIsoForWindow/);
  assert.match(source, /if \(!scoringStartIso\)/);
  assert.match(source, /current_cycle_shares/);
  assert.match(source, /t\.side = 'buy'/);
  assert.match(source, /t\.created_at >= \$\{scoringStartIso\}::timestamptz/);
  assert.match(source, /Math\.min\(rawShares, currentCycleShares\)/);
  assert.match(source, /\.filter\(p => Number\(p\.shares \|\| 0\) >= DISPLAYABLE_SHARE_EPSILON\)/);
});
