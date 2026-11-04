import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');
const { parseHTML } = require('linkedom');
const { outputFiles } = buildSync({ entryPoints: [new URL('./AdminOnchainOperations.jsx', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs',
  external: ['react','@app/lib/pointsAuth.js','../lib/PointsExecution.jsx','../lib/pointsApi.js'] });
let auth = { authenticated: true, user: { username: 'admin', suborgId: 'owner-a' } };
let execution = { enabled: true, durableTrades: true };
const pending = [];
const compiled = { exports: {} };
const bindings = {
  react: React,
  '@app/lib/pointsAuth.js': { usePointsAuth: () => auth },
  '../lib/PointsExecution.jsx': { usePointsExecution: () => execution },
  '../lib/pointsApi.js': { getJson: path => {
    assert.equal(path, '/api/points/admin/onchain-operations');
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  } },
};
new Function('require','module','exports',outputFiles[0].text)(name => bindings[name] || require(name), compiled, compiled.exports);
const { OperationsPresentation, default: AdminOnchainOperations } = compiled.exports;
const report = { status: 'warning', observedAt: '2026-10-21T10:00:00.000Z', sections: {
  trades: { status: 'warning', requests: [{ id: 'request-1', wallet: `0x${'1'.repeat(40)}`, action: 'sell', reason: 'awaiting_indexing', nonce: '0', step: 'trade', txHash: `0x${'2'.repeat(64)}` }], truncated: true },
  indexer: { status: 'ok', headBlock: 100, factories: [{ version: 'v1', address: null, lastBlock: null, lagBlocks: null }] },
  gas: { status: 'ok', enabled: true, configured: true, schemaReady: true, signerVerified: true,
    balanceEth: '0.05', dailyBudgetUsedEth: '0.001', globalDailyEth: '0.1', pendingTransfers: 0, reserveEth: '0.01' } },
  issues: [{ id: 'trade:1', message: 'Confirmed, awaiting indexing', nextAction: 'Do not repeat a confirmed trade.' }] };
const render = props => renderToStaticMarkup(React.createElement(OperationsPresentation, { refresh() {}, ...props }));

test('operator presentation distinguishes indexing, bounded results, safe references and budget reservations', () => {
  const html = render({ report, loading: false });
  assert.match(html, /Read-only snapshot/); assert.match(html, /2026-10-21T10:00:00.000Z/);
  assert.match(html, /1\+ exceptions shown/); assert.match(html, /Do not repeat a confirmed trade/);
  assert.match(html, /not actual gas spent/); assert.match(html, /Minimum funder reserve: 0.01 ETH/);
  assert.match(html, /configuration ready/); assert.match(html, /prior signer transfer verified/);
  assert.match(html, /0 \/ trade/); assert.match(html, /https:\/\/sepolia.arbiscan.io\/tx\//);
  assert.doesNotMatch(html, /Sign transaction|Retry trade|Send ETH|private-/);
  const partial = render({ report: { ...report, sections: { trades: { status: 'unavailable' }, indexer: { status: 'unavailable' }, gas: { status: 'unavailable' } } } });
  assert.match(partial, /Evidence unavailable/); assert.doesNotMatch(partial, /No exceptions detected/);
  assert.match(render({ loading: true }), /role="status"/);
  assert.match(render({ error: true }), /role="alert"/);
});

test('mounted panel gates reads, clears old evidence on error and ignores requests from an old owner', async t => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  global.window = window; global.document = document; global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    global.window = previous.window; global.document = previous.document; global.IS_REACT_ACT_ENVIRONMENT = previous.act;
  });
  const mount = async (isAdmin = true) => React.act(async () => root.render(React.createElement(AdminOnchainOperations, { isAdmin })));
  await mount(false); assert.equal(pending.length, 0);
  execution = { enabled: true, durableTrades: false }; await mount(); assert.equal(pending.length, 0);
  execution = { enabled: true, durableTrades: true }; await mount(); assert.equal(pending.length, 1);
  await React.act(async () => pending.shift().resolve(report));
  assert.match(document.body.textContent, /Confirmed, awaiting indexing/);
  await React.act(async () => document.querySelector('button').click());
  assert.doesNotMatch(document.body.textContent, /Confirmed, awaiting indexing/);
  await React.act(async () => pending.shift().reject(new Error('private-provider-url')));
  assert.match(document.body.textContent, /could not be loaded/);
  assert.doesNotMatch(document.body.textContent, /private-provider-url|No exceptions detected/);
  await React.act(async () => document.querySelector('button').click());
  const oldOwner = pending.shift();
  auth = { authenticated: true, user: { username: 'second-admin', suborgId: 'owner-b' } }; await mount();
  await React.act(async () => oldOwner.resolve(report));
  assert.doesNotMatch(document.body.textContent, /Confirmed, awaiting indexing/);
  await React.act(async () => pending.shift().resolve({ ...report, issues: [], status: 'ok' }));
  assert.match(document.body.textContent, /No exceptions detected/);
  auth = { authenticated: false, user: null }; await mount();
  assert.equal(document.getElementById('root').textContent, ''); assert.equal(pending.length, 0);
});
