import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const resolverSource = await readFile(new URL('./protocol-auto-resolve.js', import.meta.url), 'utf8').catch(() => '');
const indexerSource = await readFile(new URL('../indexer.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../_lib/protocol-schema.js', import.meta.url), 'utf8');
const marketSource = await readFile(new URL('../protocol/market.js', import.meta.url), 'utf8');
const marketsSource = await readFile(new URL('../protocol/markets.js', import.meta.url), 'utf8');

test('protocol auto-resolver resolves active protocol markets on chain', () => {
  assert.match(resolverSource, /export async function runProtocolAutoResolve/);
  assert.match(resolverSource, /FROM protocol_markets/);
  assert.match(resolverSource, /status = 'active'/);
  assert.match(resolverSource, /resolveAutoResolverCandidate/);
  assert.match(resolverSource, /resolveMarketOnChain/);
  assert.match(resolverSource, /factoryAddress: m\.factory_address/);
  assert.match(resolverSource, /marketId: m\.market_id/);
  assert.match(resolverSource, /outcome: winningIdx/);
});

test('protocol auto-resolver defers protocol parallel legs instead of resolving the wrong binary pool', () => {
  assert.match(resolverSource, /protocol_parallel_not_supported/);
  assert.match(resolverSource, /cfg\.shape === 'parallel'/);
  assert.match(resolverSource, /Array\.isArray\(cfg\.legs\)/);
});

test('indexer multiplexes protocol auto-resolution alongside points auto-resolution', () => {
  assert.match(indexerSource, /runProtocolAutoResolve/);
  assert.match(indexerSource, /protocolAutoResolveReport/);
  assert.match(indexerSource, /protocolResolve/);
  assert.match(indexerSource, /shouldRunMinuteInterval\(\{ intervalMinutes: 15 \}\)/);
});

test('protocol markets store and expose auto-resolver final scores', () => {
  assert.match(schemaSource, /ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS final_score TEXT/);
  assert.match(resolverSource, /final_score = \$1/);
  assert.match(marketSource, /m\.final_score/);
  assert.match(marketsSource, /m\.final_score/);
});
