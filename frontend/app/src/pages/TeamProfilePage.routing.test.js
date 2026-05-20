import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mvpApp = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const pointsApp = await readFile(new URL('../../points/src/App.jsx', import.meta.url), 'utf8');
const mvpCard = await readFile(new URL('../components/MarketCard.jsx', import.meta.url), 'utf8');
const pointsCard = await readFile(new URL('../../points/src/components/PointsMarketCard.jsx', import.meta.url), 'utf8');

test('team profile route is available in points and MVP apps', () => {
  assert.match(mvpApp, /TeamProfilePage/);
  assert.match(mvpApp, /path="\/teams\/:sport\/:teamSlug"/);
  assert.match(pointsApp, /TeamProfilePage/);
  assert.match(pointsApp, /path="\/teams\/:sport\/:teamSlug"/);
});

test('market cards expose team profile links from outcome labels', () => {
  assert.match(mvpCard, /findTeamByName/);
  assert.match(mvpCard, /teamProfilePath/);
  assert.match(pointsCard, /findTeamByName/);
  assert.match(pointsCard, /teamProfilePath/);
});
