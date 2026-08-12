import test from 'node:test';
import assert from 'node:assert/strict';

import { soccerMatchTypeLabel } from './soccerMarketType.js';

test('soccerMatchTypeLabel marks tournament only from the admin trophy flag', () => {
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'leagues-cup' }), null);
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'uefa-cl' }), null);
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'copa-libertadores' }), null);
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'copa-libertadores', tournamentFeatured: true }), 'TORNEO');
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', sourceData: { matchTypeLabel: 'cup' } }), null);
});

test('soccerMatchTypeLabel marks friendlies and international fixtures', () => {
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'international' }), 'INTERNACIONAL');
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'club-friendlies' }), 'AMISTOSO');
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', sourceData: { matchTypeLabel: 'friendly' } }), 'AMISTOSO');
});

test('soccerMatchTypeLabel stays quiet for regular leagues', () => {
  assert.equal(soccerMatchTypeLabel({ sport: 'soccer', league: 'liga-mx' }), null);
  assert.equal(soccerMatchTypeLabel({ sport: 'basketball', league: 'nba' }), null);
});
