import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('./resolve-market.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\n/gm, '').replace('export default async', 'async');

function fixture(marketId, { admin = true } = {}) {
  const calls = [];
  const bindings = {
    neon: () => async () => [{ id: 3, status: 'active', market_id: marketId, factory_address: 'factory', protocol_version: 'v1', outcome_count: 2 }],
    process: { env: { DATABASE_URL: 'unused', ONCHAIN_RESOLVER_SUBORG_ID: 'ops', ONCHAIN_RESOLVER_ADDRESS: 'resolver' } },
    applyCors: () => null, isOnchainReady: () => true,
    requirePointsAdmin: (_req, res) => { if (admin) return { username: 'admin' }; res.status(401).json({ error: 'not_authenticated' }); return null; },
    resolveMarketOnChain: async args => { calls.push(args); return { marketId: String(args.marketId), outcome: 1 }; },
    console: { error() {} },
  };
  const handler = new Function(...Object.keys(bindings), `${source}\nreturn handler;`)(...Object.values(bindings));
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, res, request: () => handler({ method: 'POST', body: { marketId: 3, winningOutcomeIndex: 0 } }, res) };
}

test('admin resolution accepts zero chain IDs while preserving the app outcome index', async () => {
  for (const marketId of [0, '0']) {
    const f = fixture(marketId); await f.request();
    assert.equal(f.res.code, 200); assert.equal(f.calls[0].marketId, marketId); assert.equal(f.calls[0].outcome, 0);
  }
});

test('missing chain metadata and unauthenticated callers cannot resolve', async () => {
  for (const marketId of [null, undefined, '']) {
    const f = fixture(marketId); await f.request();
    assert.equal(f.res.code, 500); assert.equal(f.res.body.error, 'market_missing_chain_metadata'); assert.equal(f.calls.length, 0);
  }
  const f = fixture(0, { admin: false }); await f.request();
  assert.equal(f.res.code, 401); assert.equal(f.calls.length, 0);
});

test('candidate confirmation also permits chain market zero and blocks missing IDs before signing or writes', async () => {
  const candidateSource = (await readFile(new URL('./resolution-candidates.js', import.meta.url), 'utf8'))
    .replace(/^import .+;\n/gm, '').replace('export default async', 'async');
  for (const chainMarketId of [0, '0', null, undefined, '']) {
    const calls = [], writes = [];
    const candidate = { id: 7, status: 'pending', market_status: 'active', protocol_market_id: 3,
      chain_market_id: chainMarketId, factory_address: 'factory', protocol_version: 'v1',
      market_outcome_count: 2, outcome_index: 0, outcomes: ['Sí', 'No'] };
    const bindings = {
      neon: () => async parts => { if (parts.join('').includes('UPDATE')) { writes.push(parts); return [candidate]; } return [candidate]; },
      process: { env: { DATABASE_URL: 'unused', ONCHAIN_RESOLVER_SUBORG_ID: 'ops', ONCHAIN_RESOLVER_ADDRESS: 'resolver' } },
      applyCors: () => null, isOnchainReady: () => true, requirePointsAdmin: () => ({ username: 'admin' }),
      ensureProtocolSchema: async () => {}, formatResolutionCandidate: c => c,
      resolveMarketOnChain: async args => { calls.push(args); return { marketId: String(args.marketId), outcome: 1 }; },
      console: { error() {} },
    };
    const handler = new Function(...Object.keys(bindings), `${candidateSource}\nreturn handler;`)(...Object.values(bindings));
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', body: { candidateId: 7, action: 'confirm' } }, res);
    if (chainMarketId === 0 || chainMarketId === '0') {
      assert.equal(res.code, 200); assert.equal(calls[0].marketId, chainMarketId); assert.equal(calls[0].outcome, 0); assert.equal(writes.length, 2);
    } else {
      assert.equal(res.code, 500); assert.equal(res.body.error, 'market_missing_chain_metadata'); assert.equal(calls.length, 0); assert.equal(writes.length, 0);
    }
  }
});
