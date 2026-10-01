import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./claimable.js', import.meta.url), 'utf8');

test('claimable endpoint counts only winning resolved points positions', () => {
  assert.match(source, /requireSession/);
  assert.match(source, /points_positions p/);
  assert.match(source, /JOIN points_markets m/);
  assert.match(source, /m\.status = 'resolved'/);
  assert.match(source, /m\.outcome = p\.outcome_index/);
  assert.match(source, /p\.shares > 0/);
  assert.match(source, /COUNT\(\*\)::int AS count/);
  assert.match(source, /COALESCE\(SUM\(p\.shares\), 0\)::text AS payout/);
});

test('claimable ignores resolved winners outside the active scoring window', () => {
  assert.match(source, /readActiveCycleWindow/);
  assert.match(source, /scoringStartIsoForWindow/);
  assert.match(source, /if \(!scoringStartIso\)/);
  assert.match(source, /EXISTS \(\s*SELECT 1\s*FROM points_trades t/s);
  assert.match(source, /t\.side = 'buy'/);
  assert.match(source, /t\.created_at >= \$\{scoringStartIso\}::timestamptz/);
});
