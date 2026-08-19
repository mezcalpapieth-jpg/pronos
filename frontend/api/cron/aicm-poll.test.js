import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./aicm-poll.js', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(
  await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
);

function hasCron(path, schedule) {
  return Array.isArray(vercelConfig.crons)
    && vercelConfig.crons.some((cron) => cron.path === path && cron.schedule === schedule);
}

test('AICM oracle cron is secret-gated and does not mutate markets directly', () => {
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /headers\.authorization/);
  assert.match(source, /ensurePointsSchema/);
  assert.match(source, /runAicmOraclePoll/);
  assert.doesNotMatch(source, /points_markets/);
  assert.doesNotMatch(source, /resolveMarket/);
});

test('AICM oracle cron runs every five minutes in production', () => {
  assert.ok(
    hasCron('/api/cron/aicm-poll', '*/5 * * * *'),
    'expected AICM oracle to collect official flight-board evidence every five minutes',
  );
});
