import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWorldCupMarkets } from './world-cup.js';

test('World Cup group matches generate ESPN sports_api resolver configs', async () => {
  const specs = await generateWorldCupMarkets();
  const opener = specs.find(s => s.source_event_id === 'wc26-A-MD1-1');

  assert.ok(opener);
  assert.equal(opener.resolver_type, 'sports_api');
  assert.deepEqual(opener.outcomes, ['México', 'Empate', 'Sudáfrica']);
  assert.equal(opener.resolver_config.source, 'espn');
  assert.equal(opener.resolver_config.leaguePath, 'soccer/fifa.world');
  assert.equal(opener.resolver_config.shape, 'draw3');
  assert.equal(opener.resolver_config.dateYmd, '2026-06-11');
  assert.equal(opener.resolver_config.homeName, 'mex');
  assert.equal(opener.resolver_config.awayName, 'rsa');
  assert.equal(opener.source_data.competitionCode, 'WC');
  assert.equal(opener.source_data.home.code, 'mx');
  assert.equal(opener.source_data.home.flagCode, 'mx');
  assert.equal(opener.source_data.home.espn, 'mex');
});

test('World Cup group-winner markets preserve stable team keys for legs', async () => {
  const specs = await generateWorldCupMarkets();
  const groupA = specs.find(s => s.source_event_id === 'wc26-winner-group-A');

  assert.ok(groupA);
  assert.equal(groupA.amm_mode, 'parallel');
  assert.equal(groupA.resolver_type, 'manual');
  assert.deepEqual(groupA.resolver_config.legs.map(l => l.teamCode), ['mx', 'za', 'kr', 'cz']);
  assert.deepEqual(groupA.source_data.teams.map(t => t.code), ['mx', 'za', 'kr', 'cz']);
});
