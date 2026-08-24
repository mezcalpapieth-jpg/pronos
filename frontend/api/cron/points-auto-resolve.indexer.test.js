import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexerSource = await readFile(new URL('../indexer.js', import.meta.url), 'utf8');

test('indexer keeps points auto-resolve as a production cron safety net', () => {
  assert.match(indexerSource, /runAutoResolve/);
  assert.match(indexerSource, /pointsAutoResolveReport/);
  assert.match(indexerSource, /POINTS_AUTO_RESOLVE_ON_INDEXER !== '0'/);
  assert.match(indexerSource, /POINTS_AUTO_RESOLVE_ON_INDEXER !== 'false'/);
  assert.match(indexerSource, /shouldRunMinuteInterval\(\{ intervalMinutes: 15 \}\)/);
  assert.doesNotMatch(indexerSource, /reason: 'dedicated_cron'/);
});

test('indexer keeps token market-cap snapshots alive for oracle markets', () => {
  assert.match(indexerSource, /runTokenMcapSnapshots/);
  assert.match(indexerSource, /tokenMcapSnapshotsReport/);
  assert.match(indexerSource, /POINTS_TOKEN_MCAP_SNAPSHOTS_ON_INDEXER !== '0'/);
  assert.match(indexerSource, /POINTS_TOKEN_MCAP_SNAPSHOTS_ON_INDEXER !== 'false'/);
  assert.match(indexerSource, /shouldRunMinuteInterval\(\{ intervalMinutes: 5 \}\)/);
  assert.match(indexerSource, /runTokenMcapSnapshots\(\{ dryRun: dryTokenMcapSnapshots, purgeOld: false \}\)/);
});
