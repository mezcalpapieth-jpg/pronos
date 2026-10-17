import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pendingApprovalOptions, pendingApprovalSettings } from '../../_lib/onchain-preview-approval.js';

const source = await readFile(new URL('./pending-markets.js', import.meta.url), 'utf8');
const previewEnv = {
  ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
};

// Run the actual route with isolated auth, DB and deployment boundaries.
// No database credentials or chain transactions are used by these tests.
function harness(env, { approvalError, authenticated = true } = {}) {
  const calls = { schema: 0, sql: 0, approved: [] };
  const context = {
    process: { env },
    console: { error() {} },
    neon: () => async () => { calls.sql++; return []; },
    applyCors: () => false,
    requirePointsAdmin: (_req, res) => {
      if (authenticated) return { username: 'test-admin' };
      res.status(401).json({ error: 'unauthorized' });
      return null;
    },
    ensurePointsSchema: async () => { calls.schema++; },
    pendingApprovalOptions: body => pendingApprovalOptions(body, env),
    pendingApprovalSettings: () => pendingApprovalSettings(env),
    LCDLF_SOURCE: 'lcdlf-official',
    mocks: {
      approveOne: async (id, reviewer, note, opts) => {
        calls.approved.push({ id, reviewer, note, opts });
        if (approvalError) throw approvalError;
        return { id, marketId: 99 };
      },
    },
  };
  const executable = source.replace(/^import .*;\n/gm, '')
    .replace('export default async function handler', 'async function handler')
    .replace(/^export /gm, '');
  vm.runInNewContext(`${executable}\napproveOne = mocks.approveOne; globalThis.handler = handler;`, context);
  return {
    calls,
    async request(body, method = 'POST') {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; },
      };
      await context.handler({ method, body, query: {} }, res);
      return res;
    },
  };
}

test('pending list advertises the same server-owned setting used by approval', async () => {
  for (const env of [previewEnv, { ...previewEnv, VERCEL_ENV: 'production' }]) {
    const api = harness(env);
    const res = await api.request(undefined, 'GET');
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.approvalSettings, pendingApprovalSettings(env));
    assert.deepEqual(res.body.pending, []);
  }
});

test('preview approval without client options passes Arbitrum Sepolia deployment options', async () => {
  const api = harness(previewEnv);
  const res = await api.request({ id: 7, action: 'approve' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(api.calls.approved, [{
    id: 7, reviewer: 'test-admin', note: undefined,
    opts: { mode: 'onchain', chainId: 421614, autoDeploy: true },
  }]);
});

test('production default is unchanged even when the preview flag is accidentally enabled', async () => {
  const api = harness({ ...previewEnv, VERCEL_ENV: 'production' });
  const res = await api.request({ id: 7, action: 'approve' });
  assert.equal(res.statusCode, 200);
  assert.notEqual(api.calls.approved[0].opts.mode, 'onchain');
});

test('preview selector can approve a Points market without deploying', async () => {
  const api = harness(previewEnv);
  const res = await api.request({ id: 7, action: 'approve', previewApprovalMode: 'points' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(api.calls.approved[0].opts, { mode: 'points' });
});

test('on-chain bulk approval returns 400 before touching the DB', async () => {
  const api = harness(previewEnv);
  const res = await api.request({ action: 'approve_all' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'bulk_approve_onchain_unsupported');
  assert.deepEqual(api.calls, { schema: 0, sql: 0, approved: [] });
});

test('stale preview UI cannot activate the setting against production', async () => {
  const api = harness({ ...previewEnv, VERCEL_ENV: 'production' });
  const res = await api.request({ id: 7, action: 'approve', previewApprovalMode: 'onchain' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'preview_approvals_disabled');
  assert.deepEqual(api.calls, { schema: 0, sql: 0, approved: [] });
});

test('missing on-chain configuration propagates 503 and never retries as Points', async () => {
  const api = harness(previewEnv, {
    approvalError: Object.assign(new Error('onchain_not_enabled'), { status: 503, detail: 'Missing runtime configuration' }),
  });
  const res = await api.request({ id: 7, action: 'approve' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.detail, 'Missing runtime configuration');
  assert.equal(api.calls.approved.length, 1);
  assert.equal(api.calls.approved[0].opts.mode, 'onchain');
});

test('preview setting does not bypass Points admin authentication', async () => {
  const api = harness(previewEnv, { authenticated: false });
  const res = await api.request({ id: 7, action: 'approve' });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(api.calls, { schema: 0, sql: 0, approved: [] });
});
