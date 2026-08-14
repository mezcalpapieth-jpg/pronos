import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const portfolioSource = await readFile(new URL('./Portfolio.jsx', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('./MvpUserProfile.jsx', import.meta.url), 'utf8').catch(() => '');
const leaderboardSource = await readFile(new URL('../components/MvpLeaderboard.jsx', import.meta.url), 'utf8').catch(() => '');

test('MVP portfolio renders searchable on-chain leaderboards with clickable usernames', () => {
  assert.match(portfolioSource, /MvpLeaderboard/);
  assert.match(leaderboardSource, /\/api\/protocol\/leaderboard/);
  assert.match(leaderboardSource, /Buscar usuario/);
  assert.match(leaderboardSource, /Top carteras/);
  assert.match(leaderboardSource, /Total ganado/);
  assert.match(leaderboardSource, /Mayor victoria/);
  assert.match(leaderboardSource, /navigate\(`\/u\/\$\{encodeURIComponent\(clean\)\}`/);
  assert.doesNotMatch(leaderboardSource, /ciclo|cycle/i);
});

test('MVP app exposes public username profiles backed by protocol data', () => {
  assert.match(appSource, /path="\/u\/:username"/);
  assert.match(appSource, /MvpUserProfile/);
  assert.match(profileSource, /\/api\/protocol\/u\?username=/);
  assert.match(profileSource, /Valor de cartera/);
  assert.match(profileSource, /Total ganado/);
  assert.match(profileSource, /Mayor victoria/);
  assert.doesNotMatch(profileSource, /ciclo|cycle/i);
});
