import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOfficialDocument, parseBallonDorWinner, parseFedTargetRange, pickWorldSeriesWinner, readOfficialResult, upgradeLegacyOfficialResult } from './official-results.js';
import { parallelLegResolutions } from './parallel-resolution.js';
import { resolveAutoResolverCandidate } from './auto-resolver-core.js';

function statement({ date = 'October 28, 2026', range = '3-3/4 to 4', extra = '' } = {}) {
  return `<main id="article"><time class="article__time">${date}</time><h3>Federal Reserve issues FOMC statement</h3>
    <div class="col-xs-12 col-sm-8"><p>The Committee decided to maintain the target range for the federal funds rate at ${range} percent.</p>${extra}</div></main>`;
}

test('Fed reads fractions and exact dated statements, not discount-rate or navigation text', () => {
  assert.deepEqual(parseFedTargetRange(statement(), '2026-10-28'), [3.75, 4]);
  assert.deepEqual(parseFedTargetRange(statement({ range: '3.5 to 3.75' }), '2026-10-28'), [3.5, 3.75]);
  assert.throws(() => parseFedTargetRange(statement(), '2026-10-29'), /date_mismatch/);
  assert.throws(() => parseFedTargetRange(statement().replace('Federal Reserve issues FOMC statement', 'Discount rate minutes'), '2026-10-28'), /not_available/);
  assert.throws(() => parseFedTargetRange(statement({ range: '4 to 3.75' }), '2026-10-28'), /ambiguous/);
  assert.throws(() => parseFedTargetRange(statement({ extra: '<p>target range for the federal funds rate at 3.5 to 3.75 percent</p>' }), '2026-10-28'), /ambiguous/);
  const splitLayout = `<main id="article"><div class="heading col-md-8"><time class="article__time">October 28, 2026</time><h3>Federal Reserve issues FOMC statement</h3></div><div class="col-md-8"><p>The Committee decided to raise the target range for the federal funds rate by 1/4 percentage point<strong> </strong>to 3-3/4<strong> </strong>to 4 percent.</p></div></main>`;
  assert.deepEqual(parseFedTargetRange(splitLayout, '2026-10-28'), [3.75, 4]);
});

test('Fed official reader and shared resolver map cut, hold and hike without changing outcomes', async () => {
  const cfg = { source: 'official-result', kind: 'fed-target-range', statementDate: '2026-10-28', previousStatementDate: '2026-09-16', resolveAt: '2026-10-28T18:00:00Z' };
  const outcomes = ['Recorta', 'Mantiene', 'Sube'];
  for (const [range, expected] of [['3.5 to 3.75', 0], ['3-3/4 to 4', 1], ['4 to 4-1/4', 2]]) {
    const fetchImpl = async url => ({ ok: true, text: async () => String(url).includes('20260916')
      ? statement({ date: 'September 16, 2026' }) : statement({ range }) });
    const result = await readOfficialResult(cfg, outcomes, { fetchImpl, now: new Date('2026-10-28T19:00:00Z') });
    assert.equal(result.winningIdx, expected);
  }
  await assert.rejects(() => readOfficialResult(cfg, outcomes, { fetchImpl: () => assert.fail('before release'), now: new Date('2026-10-28T17:00:00Z') }), /not_due/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, text: async () => String(url).includes('20260916') ? statement({ date: 'September 16, 2026' }) : statement() });
  try {
    const result = await resolveAutoResolverCandidate({ resolver_type: 'api_chart', resolver_config: { ...cfg, resolveAt: '2026-01-01T00:00:00Z' }, outcomes });
    assert.equal(result.winningIdx, 1);
  } finally { globalThis.fetch = originalFetch; }
});

function series(count = 4) {
  return { dates: [{ games: Array.from({ length: count }, (_, i) => ({
    gamePk: i + 1, gameType: 'W', season: '2026', gamesInSeries: 7, seriesGameNumber: i + 1, status: { abstractGameState: 'Final' },
    teams: { home: { team: { id: 119, name: 'Los Angeles Dodgers' }, score: 5, isWinner: true },
      away: { team: { id: 158, name: 'Milwaukee Brewers' }, score: 2, isWinner: false } },
  })) }] };
}

test('MLB requires four verified World Series wins and exact season and scores', () => {
  const cfg = { season: 2026, outcomes: ['Milwaukee Brewers', 'Los Angeles Dodgers'] };
  assert.equal(pickWorldSeriesWinner(series(), cfg).winningIdx, 1);
  assert.throws(() => pickWorldSeriesWinner(series(3), cfg), /not_decided/);
  assert.throws(() => pickWorldSeriesWinner(series(5), cfg), /not_decided/);
  const duplicate = series(); duplicate.dates[0].games[3].gamePk = 1;
  assert.throws(() => pickWorldSeriesWinner(duplicate, cfg), /duplicate/);
  const stale = series(); stale.dates[0].games[3].season = '2025';
  assert.throws(() => pickWorldSeriesWinner(stale, cfg), /identity/);
  const invalid = series(); invalid.dates[0].games[3].teams.home.score = null;
  assert.throws(() => pickWorldSeriesWinner(invalid, cfg), /incomplete/);
  assert.throws(() => pickWorldSeriesWinner(series(), { ...cfg, outcomes: ['Other'] }), /not_in_market/);
  const reversed = series();
  reversed.dates[0].games.forEach(game => { [game.teams.home, game.teams.away] = [game.teams.away, game.teams.home]; });
  assert.equal(pickWorldSeriesWinner(reversed, cfg).winningIdx, 1);
  const wrongNumber = series(); wrongNumber.dates[0].games[3].seriesGameNumber = 1;
  assert.throws(() => pickWorldSeriesWinner(wrongNumber, cfg), /identity/);
  const seven = series(7);
  seven.dates[0].games.slice(0, 3).forEach(game => {
    game.teams.home.score = 1; game.teams.home.isWinner = false;
    game.teams.away.score = 2; game.teams.away.isWinner = true;
  });
  assert.equal(pickWorldSeriesWinner(seven, cfg).wins.find(team => team.name === 'Los Angeles Dodgers').wins, 4);
});

test('official fetch rejects untrusted redirects and oversized documents', async () => {
  await assert.rejects(() => fetchOfficialDocument('https://evil.test/result', { host: 'www.federalreserve.gov' }), /untrusted/);
  await assert.rejects(() => fetchOfficialDocument('https://www.federalreserve.gov/result', { host: 'www.federalreserve.gov', fetchImpl: async () => ({ status: 302, headers: new Headers({ location: 'https://evil.test/' }) }) }), /untrusted/);
  await assert.rejects(() => fetchOfficialDocument('https://www.federalreserve.gov/result', { host: 'www.federalreserve.gov', fetchImpl: async () => ({ ok: true, text: async () => 'x'.repeat(2_000_001) }) }), /too_large/);
});

test('legacy upgrades are identity and contract guarded', () => {
  const market = { resolverType: 'manual_review', cfg: { criteria: 'Se resuelve con el comunicado FOMC publicado el 28 de octubre de 2026 a las 14:00 ET. Recorta si el rango objetivo baja, Mantiene si no cambia, Sube si aumenta.', resolveAt: '2026-10-28T18:00:00Z' }, source: 'october-tournament-2026', sourceEventId: 'october-2026:fed-october-decision', outcomes: ['Recorta', 'Mantiene', 'Sube'] };
  assert.equal(upgradeLegacyOfficialResult(market).kind, 'fed-target-range');
  assert.equal(upgradeLegacyOfficialResult({ ...market, outcomes: ['Sí', 'No'] }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...market, sourceEventId: 'different' }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...market, cfg: { criteria: 'Admin custom rule' } }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...market, cfg: { ...market.cfg, criteria: market.cfg.criteria + ' Solo después de otra confirmación.' } }), null);
});

test('World Series and Ballon d Or upgrades keep published rules and refuse modified contracts', () => {
  const mlb = {
    resolverType: 'manual_review', source: 'mlb-world-series-2026', sourceEventId: 'world-series-winner-2026',
    endTime: '2026-11-01T05:59:59Z', outcomes: ['Los Angeles Dodgers', 'Milwaukee Brewers'],
    cfg: { competition: 'mlb-world-series', season: 2026, legs: [{ label: 'Los Angeles Dodgers' }, { label: 'Milwaukee Brewers' }],
      criteria: 'Se resuelve con el equipo que MLB declare campeon oficial de la Serie Mundial 2026. Si la Serie Mundial se cancela, MLB no declara campeon, o hay una contingencia no cubierta por las reglas oficiales, el mercado pasa a revision manual.' },
  };
  assert.equal(upgradeLegacyOfficialResult(mlb).kind, 'mlb-world-series');
  assert.equal(upgradeLegacyOfficialResult(mlb).criteria, mlb.cfg.criteria);
  assert.equal(upgradeLegacyOfficialResult({ ...mlb, outcomes: [...mlb.outcomes].reverse() }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...mlb, cfg: { ...mlb.cfg, criteria: 'Admin custom rule' } }), null);
  const ballon = {
    resolverType: 'manual_review', source: 'october-tournament-2026', sourceEventId: 'october-2026:ballon-dor-men',
    outcomes: ['Ousmane Dembélé', 'Otro'], cfg: {
      criteria: 'Se resuelve con el ganador del Balon de Oro masculino 2026 anunciado por France Football/Ballon d’Or. Si gana alguien fuera de la lista, gana Otro.',
      evidence: [{ url: 'https://www.uefa.com/ballondor/' }], resolveAt: '2026-10-27T05:59:00Z',
    },
  };
  assert.equal(upgradeLegacyOfficialResult(ballon).kind, 'ballon-dor-men');
  assert.equal(upgradeLegacyOfficialResult(ballon).criteria, ballon.cfg.criteria);
  assert.equal(upgradeLegacyOfficialResult({ ...ballon, outcomes: ['Ousmane Dembélé'] }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...ballon, cfg: { ...ballon.cfg, criteria: 'Admin custom rule' } }), null);
});

function ballonArticle({ winner = 'Ousmane Dembélé', year = 2026, award = 'Men', date = '2026-10-26T20:00:00Z' } = {}) {
  return `<meta property="article:published_time" content="${date}"><main><h1>${winner} wins ${year} ${award}'s Ballon d'Or</h1><p>${winner} has been awarded the ${year} ${award}'s Ballon d'Or, with other honours going to Lamine Yamal.</p></main>`;
}

test('Ballon d Or requires the year, mens award, a published result and matching declaration', () => {
  const now = new Date('2026-10-27T06:00:00Z');
  assert.equal(parseBallonDorWinner(ballonArticle(), 2026, now).winner, 'Ousmane Dembélé');
  assert.equal(parseBallonDorWinner(ballonArticle({ year: 2025 }), 2026, now), null);
  assert.equal(parseBallonDorWinner(ballonArticle({ award: 'Women' }), 2026, now), null);
  assert.equal(parseBallonDorWinner(ballonArticle({ date: '2026-10-28T00:00:00Z' }), 2026, now), null);
  assert.equal(parseBallonDorWinner(ballonArticle().replace('has been awarded', 'might win'), 2026, now), null);
});

test('Ballon d Or pays a named winner or Other only after an explicit official result', async () => {
  const cfg = { kind: 'ballon-dor-men', year: 2026, resolveAt: '2026-10-27T05:59:00Z' };
  const url = 'https://www.uefa.com/uefachampionsleague/news/example--winner-wins-2026-men-s-ballon-d-or/';
  const fetchImpl = async input => ({ ok: true, text: async () => input.endsWith('/ballondor/')
    ? `<a href="https://[invalid">Navigation</a><a href="${url}?utm_source=landing">Dembélé wins 2026 Men's Ballon d'Or</a><a href="${url}#result">Result</a>` : ballonArticle() });
  const options = { fetchImpl, now: new Date('2026-10-27T06:00:00Z') };
  assert.equal((await readOfficialResult(cfg, ['Ousmane Dembele', 'Otro'], options)).winningIdx, 0);
  assert.equal((await readOfficialResult(cfg, ['Lamine Yamal', 'Otro'], options)).winningIdx, 1);
  await assert.rejects(() => readOfficialResult(cfg, ['Lamine Yamal', 'Otro'], { ...options, fetchImpl: async () => ({ ok: true, text: async () => '<a href="/old">2025 winner</a>' }) }), /missing_or_ambiguous/);
});

test('parallel settlement uses labels even after cancellations or earlier NO resolutions', () => {
  const outcomes = ['A', 'B', 'C'];
  const legs = [{ id: 1, leg_label: 'A', status: 'canceled' }, { id: 2, leg_label: 'B', status: 'resolved', outcome: 1 }, { id: 3, leg_label: 'C', status: 'active' }];
  assert.deepEqual(parallelLegResolutions(legs, outcomes, 2).map(leg => leg.winningOutcome), [1, 1, 0]);
  assert.equal(parallelLegResolutions([legs[2], legs[0], legs[1]], outcomes, 2)[0].winningOutcome, 0);
  assert.throws(() => parallelLegResolutions(legs, outcomes, 0), /winner_canceled/);
  assert.throws(() => parallelLegResolutions(legs, outcomes, 1), /prior_resolution_conflict/);
  assert.throws(() => parallelLegResolutions([{ ...legs[2], leg_label: 'Unknown' }], outcomes, 2), /identity/);
  assert.throws(() => parallelLegResolutions(legs.map((leg, i) => i === 0 ? { ...leg, leg_label: null } : leg), outcomes, 2), /partial_leg_labels/);
  assert.throws(() => parallelLegResolutions([{ id: 1, leg_label: 'A', status: 'resolved', outcome: null }], ['A'], 0), /prior_resolution_conflict/);
  assert.deepEqual(parallelLegResolutions([{ id: 1, status: 'active' }, { id: 2, status: 'active' }], ['A', 'B'], 1).map(leg => leg.winningOutcome), [1, 0]);
});
