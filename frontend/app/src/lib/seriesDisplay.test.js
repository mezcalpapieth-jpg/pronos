import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  formatSeriesGameLabel,
  formatSeriesScoreSummary,
  formatSeriesSubtitle,
} from './seriesDisplay.js';

test('formats Spanish series labels by default', () => {
  const meta = {
    gameNumber: 7,
    teamAWins: 3,
    teamBWins: 3,
    homeTeam: { shortName: 'Cavaliers' },
    awayTeam: { shortName: 'Pistons' },
  };

  assert.equal(formatSeriesGameLabel(7), 'Juego 7');
  assert.equal(formatSeriesScoreSummary(meta), 'Serie empatada 3-3');
  assert.equal(formatSeriesSubtitle(meta), 'Juego 7 · Serie empatada 3-3');
});

test('formats English series labels through the translation function', () => {
  const t = (key, vars = {}) => ({
    'points.series.game': `Game ${vars.num}`,
    'points.series.tied': `Series tied ${vars.score}`,
    'points.series.leads': `${vars.team} leads ${vars.score}`,
  }[key] || key);
  const meta = {
    gameNumber: 5,
    teamAWins: 3,
    teamBWins: 1,
    homeTeam: { shortName: 'Thunder' },
    awayTeam: { shortName: 'Spurs' },
  };

  assert.equal(formatSeriesGameLabel(5, { t }), 'Game 5');
  assert.equal(formatSeriesScoreSummary(meta, { t }), 'Thunder leads 3-1');
  assert.equal(formatSeriesSubtitle(meta, { t }), 'Game 5 · Thunder leads 3-1');
});


test('incomplete series history displays only the game label', () => {
  const meta = { gameNumber: 3, teamAWins: 1, teamBWins: 0, scoreComplete: false };
  assert.equal(formatSeriesScoreSummary(meta), null);
  assert.equal(formatSeriesSubtitle(meta), 'Juego 3');
});

test('missing score values do not become a fabricated 0-0 tie', () => {
  assert.equal(formatSeriesScoreSummary({ teamAWins: null, teamBWins: null }), null);
});
