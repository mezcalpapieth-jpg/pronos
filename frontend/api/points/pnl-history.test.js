import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./pnl-history.js', import.meta.url), 'utf8');

test('pnl-history serves public profiles by username and falls back to the session', () => {
  assert.match(source, /req\.query\.username/);
  assert.match(source, /readSession\(req, res\)/);
  assert.match(source, /auth_required/);
});

test('usernames are lowercased so a mixed-case profile link still resolves', () => {
  assert.match(source, /raw\.toLowerCase\(\)\.slice\(0, 32\)/);
  assert.match(source, /LOWER\(t\.username\) = \$\{username\}/);
  assert.match(source, /LOWER\(d\.username\) = \$\{username\}/);
});

test('the series never folds on-chain MVP trades into Points numbers', () => {
  assert.match(source, /const modeFilter = 'points'/);
  assert.match(source, /COALESCE\(m\.mode, 'points'\) = \$\{modeFilter\}/);
});

test('the array parameter is cast, matching the rest of the API', () => {
  assert.match(source, /market_id = ANY\(\$\{marketIds\}::int\[\]\)/);
});

test('snapshots are not limited to the requested window', () => {
  // Replaying earlier trades needs the prices that were live back then,
  // otherwise a 30-day view misprices everything opened before it.
  assert.doesNotMatch(source, /points_price_snapshots[\s\S]{0,240}snapshotted_at >=/);
});

test('the maths is delegated to the unit-tested lib rather than inlined', () => {
  assert.match(source, /import \{ buildPnlSeries \} from '\.\.\/_lib\/points-pnl-series\.js'/);
  assert.match(source, /buildPnlSeries\(\{/);
  assert.match(source, /fromMs,\s*nowMs,/);
});

test('an empty history short-circuits before the snapshot query', () => {
  assert.match(source, /if \(tradeRows\.length === 0\)[\s\S]{0,200}series: \[\]/);
});

test('pnl-history defaults to the active cycle and can read the previous cycle', () => {
  assert.match(source, /function parseCycleScope\(value\)/);
  assert.match(source, /String\(value \|\| 'current'\)\.toLowerCase\(\)/);
  assert.match(source, /resolveCycleWindow\(cycleScope\)/);
  assert.match(source, /WHERE status = 'active'/);
  assert.match(source, /WHERE status = 'closed'/);
  assert.match(source, /t\.created_at >= \$\{cycleWindow\.fromIso\}::timestamptz/);
  assert.match(source, /t\.created_at < \$\{cycleWindow\.toIso\}::timestamptz/);
  assert.match(source, /d\.created_at >= \$\{cycleWindow\.fromIso\}::timestamptz/);
  assert.match(source, /cycle: cycleWindow/);
});

test('pnl-history includes resolution correction reversals', () => {
  assert.match(source, /d\.kind IN \('market_cancel_refund', 'void_refund', 'invalid_field_refund', 'redemption_reversal'\)/);
  assert.match(source, /kind: r\.kind/);
});
