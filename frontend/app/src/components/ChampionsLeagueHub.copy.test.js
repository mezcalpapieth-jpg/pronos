import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./ChampionsLeagueHub.jsx', import.meta.url), 'utf8');

test('Champions League hub copy describes the final itself', () => {
  assert.doesNotMatch(SOURCE, /Una final con tratamiento de torneo/);
  assert.match(SOURCE, /La final se vive aqui|La final se vive aquí/);
});
