/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.league-table.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiClientSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const pointsMarketApiSource = await readFile(new URL('../../../../api/points/market.js', import.meta.url), 'utf8');
const cssSource = await readFile(new URL('../points.css', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');

test('UEFA match markets load and render a compact competition table', () => {
  assert.match(detailSource, /fetchLeagueStandings/);
  assert.match(detailSource, /const UEFA_TABLE_LEAGUES = new Set/);
  assert.match(detailSource, /'uefa-cl'/);
  assert.match(detailSource, /'uefa-europa-league'/);
  assert.match(detailSource, /'uefa-conference-league'/);
  assert.match(detailSource, /function leagueTableTeamsForMarket/);
  assert.match(detailSource, /market\?\.soccerMatchMeta\?\.homeName/);
  assert.match(detailSource, /market\?\.soccerMatchMeta\?\.awayName/);
  assert.match(detailSource, /marketSupportsLeagueTable\(market\)/);
  assert.match(detailSource, /fetchLeagueStandings\(\{\s+league: market\.league,\s+home: leagueTableTeams\.home,\s+away: leagueTableTeams\.away,/);
  assert.match(detailSource, /<TopHolders marketId=\{market\.id\} refreshKey=\{orderBookRefresh\} \/>[\s\S]*<LeagueTablePanel/);
  assert.match(cssSource, /\.points-league-table-card/);
  assert.match(cssSource, /\.points-league-table-row\.highlighted/);
  assert.match(i18nSource, /'points\.detail\.leagueTableKicker'/);
  assert.match(i18nSource, /'points\.detail\.leagueTablePoints'/);
});

test('market payload exposes minimal soccer match metadata for table highlights', () => {
  assert.match(apiClientSource, /export async function fetchLeagueStandings/);
  assert.match(apiClientSource, /\/api\/team-standings\?\$\{q\}/);
  assert.match(pointsMarketApiSource, /function soccerMatchMetaFromSource/);
  assert.match(pointsMarketApiSource, /sourceData\?\.home/);
  assert.match(pointsMarketApiSource, /sourceData\?\.away/);
  assert.match(pointsMarketApiSource, /soccerMatchMeta,/);
});
