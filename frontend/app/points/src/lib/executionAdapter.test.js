import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionAdapter } from './executionAdapter.js';

const chainMarket = { id: 360636, mode: 'onchain', chainId: 421614, chainMarketId: '0',
  chainAddress: '0x1111111111111111111111111111111111111111', protocolMarketId: 3,
  executionReady: true, prices: [0.6, 0.4], outcomes: ['Sí', 'No'], status: 'active' };
const pointsMarket = { id: 3, mode: 'points', outcomes: ['Sí', 'No'], prices: [0.5, 0.5] };

function fixture({ enabled = true, mapping = [chainMarket, pointsMarket], requestError = null } = {}) {
  const requests = [];
  let portfolio = { positions: [{ mode: 'onchain', marketId: chainMarket.id }], history: [], summary: {} };
  const client = createExecutionAdapter({
    async get(url) {
      requests.push({ method: 'GET', url });
      const parsed = new URL(url, 'https://pronos.test');
      if (parsed.pathname === '/api/points/onchain') {
        const action = parsed.searchParams.get('action');
        if (action === 'config') {
          if (requestError) throw requestError;
          return { enabled, chainId: enabled ? 421614 : null };
        }
        if (action === 'markets') {
          const ids = parsed.searchParams.get('ids').split(',').map(Number);
          return { markets: mapping.filter(m => ids.includes(m.id) || ids.includes(m.parentMarketId)) };
        }
        if (action === 'portfolio') return portfolio;
        if (action === 'prices') return { history: { [chainMarket.id]: [{ t: 1, p: 60 }] } };
        if (action === 'balance') return { balance: '7.5' };
        throw new Error(`Unexpected action ${action}`);
      }
      if (parsed.pathname === '/api/points/markets') return { markets: parsed.searchParams.get('mode') === 'onchain' ? [chainMarket] : [pointsMarket] };
      if (parsed.pathname === '/api/points/market') {
        const market = mapping.find(m => m.id === Number(parsed.searchParams.get('id')));
        if (!market) throw Object.assign(new Error('market_not_found'), { status: 404 });
        return { market };
      }
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, body) {
      requests.push({ method: 'POST', url, body });
      if (body.collateral === 999) throw Object.assign(new Error('delegation_required'), { code: 'delegation_required' });
      return { ok: true };
    },
  });
  return { client, requests, changeAccount: value => { portfolio = value; } };
}

test('discovery scopes the preview to Sepolia while preserving Points IDs and chain prices', async () => {
  const { client, requests } = fixture();
  const rows = await client.markets({ status: 'active', featured: 'all' });
  assert.equal(client.getMode(), 'onchain');
  assert.equal(rows[0].id, 360636);
  assert.equal(rows[0].protocolMarketId, 3);
  assert.equal(rows[0].chainMarketId, '0');
  assert.deepEqual(rows[0].prices, [0.6, 0.4]);
  assert.match(requests.find(r => r.url.startsWith('/api/points/markets?')).url, /chain_id=421614/);
  await client.setMode('points');
  assert.deepEqual(await client.markets(), [pointsMarket]);
});

for (const [action, args] of [
  ['quote-buy', { collateral: 10 }], ['buy', { collateral: 10, minSharesOut: 17, maxAvgPrice: 0.7 }],
  ['quote-sell', { shares: 5 }], ['sell', { shares: 5, minCollateralOut: 2.4 }],
]) test(`${action} resolves pool identity to protocol DB ID, never contract ID or Points ID`, async () => {
  const { client, requests } = fixture();
  await client.trade(action, { marketId: chainMarket.id, market: chainMarket, outcomeIndex: 0, ...args });
  const post = requests.find(r => r.method === 'POST');
  assert.equal(post.url, `/api/protocol/${action}`);
  assert.deepEqual(post.body, { marketId: 3, outcomeIndex: 0, ...args });
});

test('redeem sends explicit winning share amount and never an outcome-index substitute', async () => {
  const { client, requests } = fixture();
  await assert.rejects(client.trade('redeem', { marketId: chainMarket.id, outcomeIndex: 0 }), { code: 'invalid_amount' });
  await client.trade('redeem', { marketId: chainMarket.id, outcomeIndex: 0, amount: 12.345678 });
  assert.deepEqual(requests.find(r => r.method === 'POST').body, { marketId: 3, amount: 12.345678 });
});

test('a colliding integer ID still executes against its explicit Points market', async () => {
  const { client, requests } = fixture();
  await client.trade('buy', { marketId: 3, collateral: 100, outcomeIndex: 1 });
  assert.equal(requests.find(r => r.method === 'POST').url, '/api/points/buy');
});

test('missing, unindexed, wrong-chain and unknown-mode mappings cannot submit a trade', async () => {
  for (const market of [
    { ...chainMarket, executionReady: false }, { ...chainMarket, protocolMarketId: null },
    { ...chainMarket, chainId: 84532 }, { ...chainMarket, mode: 'surprise' },
  ]) {
    const { client, requests } = fixture({ mapping: [market] });
    await assert.rejects(client.trade('buy', { marketId: market.id, collateral: 10, outcomeIndex: 0 }));
    assert.equal(requests.filter(r => r.method === 'POST').length, 0);
  }
  const { client, requests } = fixture({ mapping: [] });
  await assert.rejects(client.trade('buy', { marketId: chainMarket.id, collateral: 10, outcomeIndex: 0 }));
  assert.equal(requests.filter(r => r.method === 'POST').length, 0);
});

test('protocol signing failures are surfaced without attempting Points execution', async () => {
  const { client, requests } = fixture();
  await assert.rejects(client.trade('buy', { marketId: chainMarket.id, collateral: 999, outcomeIndex: 0 }), { code: 'delegation_required' });
  assert.deepEqual(requests.filter(r => r.method === 'POST').map(r => r.url), ['/api/protocol/buy']);
});

test('parallel parents expose mapped child pools; the parent itself cannot trade', async () => {
  const parent = { id: 50, mode: 'onchain', ammMode: 'parallel', outcomes: ['A', 'B'], legIds: [51, 52] };
  const mapping = [parent, { ...chainMarket, id: 51, parentMarketId: 50, protocolMarketId: 7 },
    { ...chainMarket, id: 52, parentMarketId: 50, protocolMarketId: 8 }];
  const { client, requests } = fixture({ mapping });
  const market = await client.market(50);
  assert.equal(market.executionReady, true);
  assert.deepEqual(market.legs.map(l => l.protocolMarketId), [7, 8]);
  await client.trade('buy', { marketId: 52, market: { ...parent, id: 52 }, outcomeIndex: 0, collateral: 5 });
  assert.equal(requests.find(r => r.method === 'POST').body.marketId, 8);
  await assert.rejects(client.trade('buy', { marketId: 50, outcomeIndex: 0, collateral: 5 }), { code: 'onchain_index_pending' });
});

test('public history partitions mixed ledgers, and chain failures never load Points history for them', async () => {
  const { client } = fixture();
  const calls = [];
  const result = await client.publicRead('prices', [3, chainMarket.id], { outcome: 0 }, async ids => {
    calls.push(ids); return { 3: [{ t: 1, p: 50 }] };
  });
  assert.deepEqual(calls, [[3]]);
  assert.deepEqual(result, { 3: [{ t: 1, p: 50 }], [chainMarket.id]: [{ t: 1, p: 60 }] });
});

test('portfolio data is read afresh across accounts and mode switches', async () => {
  const { client, changeAccount, requests } = fixture();
  assert.equal((await client.portfolio()).positions.length, 1);
  changeAccount({ positions: [], history: [], summary: {} });
  assert.equal((await client.portfolio()).positions.length, 0);
  await client.setMode('points');
  assert.equal(await client.portfolio(), null);
  assert.equal(requests.filter(r => r.url.includes('action=portfolio')).length, 2);
});

test('production stays Points; cached parallel Points legs retain their normal endpoint', async () => {
  const { client, requests } = fixture({ enabled: false });
  client.remember({ id: 90, mode: 'points', ammMode: 'parallel', legIds: [91, 92] });
  await client.trade('sell', { marketId: 91, shares: 2, outcomeIndex: 0 });
  assert.equal(requests.find(r => r.method === 'POST').url, '/api/points/sell');
  assert.equal(await client.portfolio(), null);
  await assert.rejects(client.setMode('onchain'), { code: 'onchain_preview_disabled' });
});

test('config failures stop loading; only an absent legacy/demo route disables the adapter', async () => {
  const down = fixture({ requestError: Object.assign(new Error('unavailable'), { status: 503 }) });
  await assert.rejects(down.client.markets());
  assert.equal(down.requests.length, 1);
  const absent = fixture({ requestError: Object.assign(new Error('missing'), { status: 404 }) });
  assert.equal((await absent.client.config()).enabled, false);
  assert.equal((await absent.client.config()).enabled, false);
  assert.equal(absent.requests.length, 1);
});
