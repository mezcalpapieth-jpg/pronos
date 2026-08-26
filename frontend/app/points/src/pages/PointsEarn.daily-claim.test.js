import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const earnSource = await readFile(new URL('./PointsEarn.jsx', import.meta.url), 'utf8');
const claimDailySource = await readFile(new URL('../../../../api/points/claim-daily.js', import.meta.url), 'utf8');
const dailyStatusSource = await readFile(new URL('../../../../api/points/daily-status.js', import.meta.url), 'utf8');

test('daily claim endpoints expose the next Mexico City claim rollover', () => {
  assert.match(dailyStatusSource, /nextClaimAtUtc:\s*nextMexicoMidnightUtcIso\(now\)/);
  assert.match(claimDailySource, /nextMexicoMidnightUtcIso/);
  assert.match(claimDailySource, /const nextClaimAtUtc = nextMexicoMidnightUtcIso\(now\)/);
  assert.match(claimDailySource, /json\(\{ ok: true, \.\.\.result, nextClaimAtUtc \}\)/);
});

test('earn daily claim button shows a countdown while locked', () => {
  assert.match(earnSource, /function formatDailyClaimCountdown/);
  assert.match(earnSource, /nextClaimAtUtc/);
  assert.match(earnSource, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  assert.match(earnSource, /`Disponible en \$\{formatDailyClaimCountdown\(remainingMs\)\}`/);
  assert.doesNotMatch(earnSource, /\?\s*'Ya reclamaste hoy'\s*:\s*'Reclamar'/);
});
