import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const interestLib = await readFile(new URL('../lib/interest.js', import.meta.url), 'utf8');
const interestPanel = await readFile(new URL('../components/AdminInterestPanel.jsx', import.meta.url), 'utf8');
const mvpAdmin = await readFile(new URL('./Admin.jsx', import.meta.url), 'utf8');
const pointsAdmin = await readFile(new URL('../../points/src/pages/PointsAdmin.jsx', import.meta.url), 'utf8');
const mvpCard = await readFile(new URL('../components/MarketCard.jsx', import.meta.url), 'utf8');
const pointsCard = await readFile(new URL('../../points/src/components/PointsMarketCard.jsx', import.meta.url), 'utf8');
const mvpDetail = await readFile(new URL('./MarketDetail.jsx', import.meta.url), 'utf8');
const pointsDetail = await readFile(new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');
const teamSearch = await readFile(new URL('./TeamSearchPage.jsx', import.meta.url), 'utf8');
const teamProfile = await readFile(new URL('./TeamProfilePage.jsx', import.meta.url), 'utf8');
const statsApi = await readFile(new URL('../../../api/points/admin/stats.js', import.meta.url), 'utf8');

test('admin stats includes interest panel with day week month lifetime windows', () => {
  assert.match(interestPanel, /AdminInterestPanel/);
  assert.match(interestPanel, /Hoy/);
  assert.match(interestPanel, /Semana/);
  assert.match(interestPanel, /Mes/);
  assert.match(interestPanel, /Vida/);
  assert.match(interestPanel, /sparkline/i);
  assert.match(mvpAdmin, /<AdminInterestPanel interest=\{stats\.interest\}/);
  assert.match(pointsAdmin, /<AdminInterestPanel interest=\{stats\.interest\}/);
});

test('team and market surfaces send daily interest events', () => {
  assert.match(interestLib, /\/api\/interest/);
  assert.match(interestLib, /trackInterest/);

  for (const source of [mvpCard, pointsCard, mvpDetail, pointsDetail, teamSearch, teamProfile]) {
    assert.match(source, /trackInterest/);
  }

  assert.match(teamSearch, /objectType:\s*'team'/);
  assert.match(teamProfile, /action:\s*'view'/);
  assert.match(mvpCard, /objectType:\s*'protocol_market'/);
  assert.match(pointsCard, /objectType:\s*'points_market'/);
});

test('points admin stats endpoint returns aggregate interest metrics', () => {
  assert.match(statsApi, /ensureInterestSchema/);
  assert.match(statsApi, /interest_daily_counts/);
  assert.match(statsApi, /interest:\s*\{/);
  assert.match(statsApi, /teams/);
  assert.match(statsApi, /markets/);
});
