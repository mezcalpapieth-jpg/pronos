import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

const base = fileURLToPath(new URL('../../', import.meta.url));
const entries = [
  'api/points/stocks/assets.js',
  'api/points/stocks/buy.js',
  'api/points/stocks/candles.js',
  'api/points/stocks/health.js',
  'api/points/stocks/positions.js',
  'api/points/stocks/quote.js',
  'api/points/stocks/sell.js',
  'api/points/leaderboard.js',
  'api/cron/points-stock-snapshot.js',
  'api/cron/points-tournament-snapshot.js',
];

test('Vercel can trace the stock endpoints and their scoring dependencies', async () => {
  // Runtime arithmetic tests do not cover the packager's static evaluation.
  const { fileList } = await nodeFileTrace(entries.map(entry => `${base}${entry}`), { base, processCwd: base });
  for (const entry of entries) assert.ok(fileList.has(entry), `missing entry: ${entry}`);
  assert.ok(fileList.has('api/_lib/stock-math.js'));
  assert.ok(fileList.has('api/_lib/stock-marks.js'));
  assert.ok(fileList.has('api/_lib/stock-liquidation.js'));
});
