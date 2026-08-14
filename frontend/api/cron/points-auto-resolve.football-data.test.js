import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./points-auto-resolve.js', import.meta.url), 'utf8');

test('points auto-resolver treats football-data soccer like ESPN for early final-score checks', () => {
  assert.match(SOURCE, /resolver_config->>'source'\s+IN\s+\('espn',\s*'football-data'\)/);
});

test('points auto-resolver can fall back from football-data to ESPN soccer scoreboards', () => {
  assert.match(SOURCE, /buildFootballDataEspnFallbackConfig/);
  assert.match(SOURCE, /originalSource:\s*'football-data'/);
});
