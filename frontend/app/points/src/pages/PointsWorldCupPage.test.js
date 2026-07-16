import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./PointsWorldCupPage.jsx', import.meta.url), 'utf8');

test('World Cup page prioritizes final markets over stale semifinal markets', () => {
  const finalIndex = source.indexOf('const finals = finalMarkets.filter');
  const semifinalIndex = source.indexOf('const semis = semifinalMarkets.filter');

  assert.ok(finalIndex >= 0, 'final markets should be selected explicitly');
  assert.ok(semifinalIndex >= 0, 'semifinal fallback should still exist');
  assert.ok(finalIndex < semifinalIndex, 'final markets must be checked before semifinal markets');
  assert.match(source, /if \(finals\.length > 0\) return finals/);
  assert.match(source, /if \(finalMarkets\.length > 0\) return finalMarkets/);
});

test('World Cup page uses final stage copy and avoids stale opening kickoff fallback', () => {
  assert.match(source, /title:\s*'Final del Mundial'/);
  assert.match(source, /liveBadge:\s*'FINAL · Mercado del título'/);
  assert.match(source, /stageMeta=\{stageMeta\}/);
  assert.doesNotMatch(source, /OPENING_KICKOFF_ISO/);
});

test('World Cup final hero is personalized for Spain and Argentina', () => {
  assert.match(source, /FINAL_MATCHUP/);
  assert.match(source, /TEAMS\.es/);
  assert.match(source, /TEAMS\.ar/);
  assert.match(source, /España y Argentina llegan al partido por el título/);
  assert.match(source, /wc-final-matchup-strip/);
});
