import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const React = require('react');
const { parseHTML } = require('linkedom');
const { buildSync } = require('esbuild');
const externals = ['react', '@app/lib/pointsAuth.js', '../lib/PointsExecution.jsx', '../lib/pointsApi.js'];
const { outputFiles } = buildSync({
  entryPoints: [new URL('./AdminOnchainResolution.jsx', import.meta.url).pathname],
  bundle: true, write: false, format: 'cjs', platform: 'node', external: externals,
});
const compiled = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(
  name => name === 'react' ? React : { usePointsAuth: () => ({ user: { username: 'admin' } }) }, compiled, compiled.exports,
);

test('unlinked Sepolia markets show the review flag without settlement controls', () => {
  const { renderToStaticMarkup } = require('react-dom/server');
  const html = renderToStaticMarkup(React.createElement(compiled.exports.default, {
    market: { id: 42, chainMarketId: '0', onchainResolution: { indexedStatus: null, issue: 'missing_mapping' } },
  }));
  assert.match(html, /Revisión onchain requerida/);
  assert.match(html, /no encontró un pool/);
  assert.match(html, /ID 0/);
  assert.doesNotMatch(html, /Consultar evidencia|Confirmar resolución/);
});

test('Sepolia resolution shows evidence and claims, blocks a shortfall, and reuses the confirmed intent on retry', async t => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = { window: global.window, document: global.document, IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window, document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); Object.assign(global, previous); });

  const store = new Map(), posts = [], confirmed = [], prompts = [];
  const key = 'pronos:admin-settlement:test-admin';
  const storage = { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  let allow = false, status = 'deferred', shortfall = '1000000';
  const reviewHash = 'a'.repeat(64), source = 'https://www.espn.com/example';
  const api = {
    async getJson(url) {
      assert.equal(url, '/api/points/admin/onchain-resolution-preview?marketId=42');
      return { status, reviewHash, suggestedOutcome: status === 'ready' ? 1 : null, outcomes: ['Local', 'Visitante'],
        criteria: 'Cuenta el resultado final.', evidence: { provider: 'espn', url: source, score: 'Local 1–3 Visitante' },
        estimate: { blockNumber: 77, payouts: [{ outcome: 1, payoutUnits: '12000000', shortfallUnits: shortfall }] } };
    },
    async postJson(url, body) {
      assert.equal(url, '/api/points/admin/onchain-settlement');
      assert.deepEqual(JSON.parse(store.get(key)), body);
      posts.push(body);
      if (posts.length === 1) throw Error('lost response');
      return { ok: true, txHash: `0x${'ab'.repeat(32)}` };
    },
  };
  await React.act(async () => root.render(React.createElement(compiled.exports.OnchainResolutionReview, {
    market: { id: 42 }, owner: 'test-admin', storage, api,
    confirm: message => { prompts.push(message); return allow; }, onSettled: id => confirmed.push(id),
  })));
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const click = label => React.act(async () => button(label).click());
  const setReason = () => React.act(async () => {
    const input = document.querySelector('input'), props = Object.keys(input).find(k => k.startsWith('__reactProps$'));
    input[props].onChange({ target: { value: 'Marcador final verificado' } });
  });
  const submit = () => React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  const confirmButton = 'Confirmar resolución en Arbitrum Sepolia';

  await click('Consultar evidencia y cobros');
  assert.equal(button(confirmButton), undefined);
  status = 'ready';
  await click('Actualizar evidencia y cobros');
  assert.equal(document.querySelector('a').href, source);
  assert.match(document.body.textContent, /Cuenta el resultado final.*Local 1–3 Visitante.*Ganador sugerido Visitante.*12\.000000 MXNP.*Faltan 1\.000000/);
  await setReason();
  assert.equal(button(confirmButton).disabled, true);
  await submit();
  assert.equal(posts.length, 0);
  shortfall = '0';
  await click('Actualizar evidencia y cobros');
  await setReason();
  await submit();
  assert.equal(posts.length, 0);
  assert.match(prompts[0], /#42.*Visitante/);
  allow = true;
  await submit();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].reviewHash, reviewHash);
  assert.equal(posts[0].outcome, 1);
  await click('Continuar resolución guardada');
  assert.deepEqual(posts[0], posts[1]);
  assert.equal(store.size, 0);
  assert.deepEqual(confirmed, [42]);
  assert.match(document.body.textContent, /Resolución confirmada.*Esperando al indexador/);
});
