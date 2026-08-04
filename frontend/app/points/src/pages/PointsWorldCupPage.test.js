import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./PointsWorldCupPage.jsx', import.meta.url), 'utf8');

test('World Cup page prioritizes final markets over stale semifinal markets', () => {
  const finalIndex = source.indexOf('const finalWeekend = finalWeekendMarkets.filter');
  const semifinalIndex = source.indexOf('const semis = semifinalMarkets.filter');

  assert.ok(finalIndex >= 0, 'final weekend markets should be selected explicitly');
  assert.ok(semifinalIndex >= 0, 'semifinal fallback should still exist');
  assert.ok(finalIndex < semifinalIndex, 'final weekend markets must be checked before semifinal markets');
  assert.match(source, /if \(finalWeekend\.length > 0\) return finalWeekend/);
  assert.match(source, /if \(finalWeekendMarkets\.length > 0\) return finalWeekendMarkets/);
});

test('World Cup page uses completed champion copy and avoids stale opening kickoff fallback', () => {
  assert.match(source, /WORLD_CUP_COMPLETE = true/);
  assert.match(source, /title:\s*'España campeona del mundo'/);
  assert.match(source, /liveBadge:\s*'TORNEO FINALIZADO · ESPAÑA CAMPEONA'/);
  assert.match(source, /WORLD_CUP_CHAMPION_LINE/);
  assert.match(source, /stageMeta=\{stageMeta\}/);
  assert.doesNotMatch(source, /OPENING_KICKOFF_ISO/);
});

test('World Cup final hero is personalized for Spain and Argentina', () => {
  assert.match(source, /FINAL_MATCHUP/);
  assert.match(source, /TEAMS\.es/);
  assert.match(source, /TEAMS\.ar/);
  assert.match(source, /Campeona mundial 2026/);
  assert.match(source, /Subcampeona mundial 2026/);
  assert.match(source, /La Copa del Mundo 2026 terminó con España campeona/);
  assert.match(source, /wc-final-matchup-strip/);
});

test('World Cup final weekend also surfaces the third-place match', () => {
  assert.match(source, /THIRD_PLACE_MATCHUP/);
  assert.match(source, /TEAMS\.fr/);
  assert.match(source, /TEAMS\.eng/);
  assert.match(source, /Tercer lugar · finalizado/);
  assert.match(source, /wc-third-place-strip/);
  assert.match(source, /keys:\s*\['third', 'final'\]/);
});
