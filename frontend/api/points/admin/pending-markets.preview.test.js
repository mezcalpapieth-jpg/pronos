import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { deriveMarketTags } from '../../_lib/category-tags.js';
import { normalizeSeedLiquidities } from '../../_lib/market-liquidity.js';
import { attachPointsOpeningLiquidity } from '../../_lib/market-pricing.js';
import { attachMarketTranslations } from '../../_lib/market-translations.js';
import { checkPendingProposal, checkPendingProposals } from '../../_lib/points-admin-approval-checks.js';
import { ADMIN_SEARCH_MARKS, parseAdminMarketSearch } from '../../_lib/points-admin-market-search.js';
import { pendingApprovalResolutionRules, pendingResolutionCriteria } from '../../_lib/points-pending-resolution-rules.js';
import { pointsResolverReadiness } from '../../_lib/points-resolver-readiness.js';
import { pendingApprovalOptions, pendingApprovalSettings } from '../../_lib/onchain-preview-approval.js';

const source = await readFile(new URL('./pending-markets.js', import.meta.url), 'utf8');
const previewEnv = {
  ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
};

// Run the actual route with isolated auth, DB and deployment boundaries.
// No database credentials or chain transactions are used by these tests.
function harness(env, { approvalError, authenticated = true, rows = [], executeApproval = false, duplicates = [] } = {}) {
  const calls = { schema: 0, sql: 0, approved: [] };
  const writes = [];
  const deploys = [];
  const sql = async (strings, ...values) => {
    calls.sql++;
    const query = strings.join('');
    if (query.includes('FROM points_pending_markets WHERE id')) return rows.filter(row => row.id === values[0]);
    return query.includes('FROM points_pending_markets p') ? rows : [];
  };
  sql.query = async () => { calls.sql++; return duplicates; };
  const passThrough = ({ resolverConfig, sourceData }) => ({ resolverConfig, sourceData });
  const context = {
    process: { env },
    createHash,
    console: { error() {} },
    neon: () => sql,
    withTransaction: async handler => handler({
      query: async (query, values) => {
        if (query.startsWith('SELECT * FROM points_pending_markets')) {
          assert.match(query, /FOR UPDATE/);
          return { rows: rows.filter(row => row.id === values[0]) };
        }
        if (/^(UPDATE|INSERT)/.test(query)) {
          writes.push({ query, values });
          return { rows: [{ id: 99 }] };
        }
        if (query.includes('AS pending_id')) return { rows: duplicates };
        return { rows: [] };
      },
    }),
    deriveMarketTags,
    normalizeSeedLiquidities,
    attachMarketTranslations,
    checkPendingProposal,
    checkPendingProposals,
    pendingApprovalResolutionRules,
    pendingResolutionCriteria,
    assertNetflixDraftChart: () => {},
    syncMananeraPhraseFromQuestion: passThrough,
    syncApiPriceFromQuestion: passThrough,
    syncWeatherDateFromMarket: passThrough,
    validateBeforeMonthDeadline: () => null,
    ADMIN_SEARCH_MARKS,
    parseAdminMarketSearch,
    attachPointsOpeningLiquidity,
    pointsResolverReadiness,
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
      onchainTrader: {
        isOnchainReady: () => true,
        async deployMarketOnChain(options) {
          deploys.push(options);
          return { marketAddress: '0x0000000000000000000000000000000000000001', marketId: 12 };
        },
      },
      approveOne: async (id, reviewer, note, opts) => {
        calls.approved.push({ id, reviewer, note, opts });
        if (approvalError) throw approvalError;
        return { id, marketId: 99 };
      },
    },
  };
  const executable = source.replace(/^import .*;\n/gm, '')
    .replace('export default async function handler', 'async function handler')
    .replace("await import('../../_lib/onchain-trader.js')", 'mocks.onchainTrader')
    .replace(/^export /gm, '');
  vm.runInNewContext(`${executable}\n${executeApproval ? '' : 'approveOne = mocks.approveOne;'} globalThis.handler = handler;`, context);
  return {
    calls,
    writes,
    deploys,
    async request(body, method = 'POST', query = {}) {
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = JSON.parse(JSON.stringify(value)); return this; },
      };
      await context.handler({ method, body, query }, res);
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


test('preview seed display follows the chosen approval destination without changing saved seeds', async () => {
  const row = { id: 7, status: 'pending', question: 'Test', category: 'deportes',
    outcomes: ['A', 'B', 'C'], seed_liquidity: 1000, seed_liquidities: [1000,1000,1000], source_data: {} };
  const api = harness(previewEnv, { rows: [row] });
  for (const [query, expected] of [[{}, 1000], [{ previewApprovalMode: 'onchain' }, 1000], [{ previewApprovalMode: 'points' }, 7500]]) {
    const res = await api.request(undefined, 'GET', query);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.pending[0].seedLiquidity, expected);
    assert.deepEqual(res.body.pending[0].seedLiquidities, [expected,expected,expected]);
    assert.equal(res.body.pending[0].resolutionReadiness?.mode, query.previewApprovalMode === 'points' ? 'missing' : undefined);
  }
  assert.equal(row.seed_liquidity, 1000);
  const production = harness({ ...previewEnv, VERCEL_ENV: 'production' }, { rows: [row] });
  assert.equal((await production.request(undefined, 'GET')).body.pending[0].seedLiquidity, 7500);
  assert.equal((await production.request(undefined, 'GET', { previewApprovalMode: 'onchain' })).statusCode, 403);
});

function ncaafProposal() {
  return {
    id: 35984, status: 'pending', source: 'espn-ncaaf', source_event_id: '401866475',
    question: '¿Quién gana Massachusetts Minutemen @ Bowling Green Falcons?',
    category: 'deportes', sport: 'ncaaf', league: 'ncaaf', amm_mode: 'unified',
    outcomes: ['Bowling Green Falcons', 'Massachusetts Minutemen'], seed_liquidity: 1000,
    start_time: '2099-11-28T17:00:00Z', end_time: '2099-11-28T21:00:00Z',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn', leaguePath: 'football/college-football', eventId: '401866475',
      dateYmd: '2099-11-28', shape: 'binary',
    },
    source_data: {
      eventId: '401866475', kickoffUtc: '2099-11-28T17:00Z',
      home: { id: '189', name: 'Bowling Green Falcons' },
      away: { id: '113', name: 'Massachusetts Minutemen' },
    },
  };
}

const configuredPreviewEnv = { ...previewEnv, ONCHAIN_DEPLOYER_SUBORG_ID: 'mock', ONCHAIN_DEPLOYER_ADDRESS: 'mock' };

test('Sepolia precheck drafts ESPN criteria and approval persists them with the original resolver', async () => {
  const row = ncaafProposal();
  const api = harness(configuredPreviewEnv, { rows: [row], executeApproval: true });
  const precheck = await api.request(null, 'GET', { check_id: String(row.id), previewApprovalMode: 'onchain' });
  assert.equal(precheck.statusCode, 200);
  assert.equal(precheck.body.checks.some(check => check.code === 'missing_criteria'), false);
  assert.equal(precheck.body.resolutionRules.generated, true);
  const { criteria, sourceUrl } = precheck.body.resolutionRules;
  assert.match(criteria, /401866475/);
  assert.match(criteria, /Bowling Green Falcons si gana el local y Massachusetts Minutemen si gana el visitante/);
  assert.match(sourceUrl, /football\/college-football\/summary\?event=401866475$/);
  assert.equal(api.writes.length, 0);
  assert.equal(api.deploys.length, 0);

  const list = await api.request(null, 'GET', { previewApprovalMode: 'onchain' });
  const listed = list.body.pending[0];
  assert.deepEqual(listed.generatedResolutionRules, precheck.body.resolutionRules);
  assert.match(listed.oneClickApprovalKey, /^[a-f0-9]{64}$/);
  assert.equal(listed.oneClickApprovalKey, precheck.body.oneClickApprovalKey);

  const points = await api.request(null, 'GET', { check_id: String(row.id), previewApprovalMode: 'points' });
  assert.equal(points.body.resolutionRules, undefined);
  assert.ok(points.body.checks.some(check => check.code === 'missing_criteria' && check.severity === 'warning'));

  const pointsList = await api.request(null, 'GET', { previewApprovalMode: 'points' });
  assert.equal(pointsList.body.pending[0].generatedResolutionRules, undefined);
  const approval = await api.request({ id: row.id, action: 'approve', previewApprovalMode: 'onchain',
    oneClickApprovalKey: listed.oneClickApprovalKey });
  assert.equal(approval.statusCode, 200, JSON.stringify(approval.body));
  assert.equal(api.deploys.length, 1);
  assert.equal(api.deploys[0].resolutionSource, sourceUrl);
  const [market, proposal] = api.writes;
  assert.match(market.query, /INSERT INTO points_markets/);
  assert.deepEqual(JSON.parse(market.values[13]), { ...row.resolver_config, criteria, evidenceUrl: sourceUrl });
  assert.match(proposal.query, /UPDATE points_pending_markets/);
  assert.equal(JSON.parse(proposal.values[3]).resolutionCriteria, criteria);
  assert.equal(JSON.parse(proposal.values[4]).criteria, criteria);
});

test('one-click approval requires current criteria, market inputs and no other warnings', async () => {
  const row = ncaafProposal();
  const duplicates = [];
  const api = harness(configuredPreviewEnv, { rows: [row], executeApproval: true, duplicates });
  const list = () => api.request(null, 'GET', { previewApprovalMode: 'onchain' });
  const key = (await list()).body.pending[0].oneClickApprovalKey;
  const request = { id: row.id, action: 'approve', previewApprovalMode: 'onchain', oneClickApprovalKey: key };
  assert.equal((await api.request({ ...request, previewApprovalMode: 'points' })).statusCode, 400);
  row.seed_liquidity = 2000;
  assert.equal((await api.request(request)).body.error, 'proposal_approval_changed');
  row.seed_liquidity = 1000;
  duplicates.push({ pending_id: row.id, id: 100, exact: false });
  const warned = (await list()).body.pending[0];
  assert.equal(warned.generatedResolutionRules.generated, true);
  assert.equal(warned.oneClickApprovalKey, null);
  assert.equal((await api.request(request)).body.error, 'proposal_approval_changed');
  duplicates[0].exact = true;
  assert.equal((await api.request(request)).body.error, 'proposal_approval_changed');
  assert.equal((await api.request({ id: row.id, action: 'approve' })).body.error, 'duplicate_market');
  duplicates.length = 0;
  row.outcomes.reverse();
  assert.equal((await api.request(request)).body.error, 'proposal_approval_changed');
  assert.deepEqual(api.deploys, []);
  assert.deepEqual(api.writes, []);
});

test('edited outcome order requires manual criteria and blocks approval before deployment', async () => {
  const row = ncaafProposal();
  row.outcomes.reverse();
  const api = harness(configuredPreviewEnv, { rows: [row], executeApproval: true });
  const precheck = await api.request(null, 'GET', { check_id: String(row.id) });
  assert.equal(precheck.body.resolutionRules, null);
  assert.ok(precheck.body.checks.some(check => check.code === 'missing_criteria' && check.severity === 'block'));
  const approval = await api.request({ id: row.id, action: 'approve' });
  assert.equal(approval.statusCode, 409);
  assert.equal(approval.body.error, 'missing_criteria');
  assert.deepEqual(api.deploys, []);
  assert.deepEqual(api.writes, []);
});

test('written criteria take precedence and a preview admin can add criteria to an unsupported proposal', async () => {
  const row = { ...ncaafProposal(), source: 'manual', resolver_config: null, resolver_type: null };
  const api = harness(configuredPreviewEnv, { rows: [row], executeApproval: true });
  const criteria = 'El resultado se verifica con el acta oficial del evento.';
  const invalid = await api.request({ id: row.id, action: 'edit', patch: { resolutionCriteria: '  ' } });
  assert.equal(invalid.statusCode, 400);
  const edit = await api.request({ id: row.id, action: 'edit', patch: { resolutionCriteria: criteria } });
  assert.equal(edit.statusCode, 200, JSON.stringify(edit.body));
  assert.deepEqual(JSON.parse(api.writes[0].values[10]), { criteria });
  row.resolver_config = JSON.parse(api.writes[0].values[10]);
  const precheck = await api.request(null, 'GET', { check_id: String(row.id) });
  assert.deepEqual(precheck.body.resolutionRules, { criteria, generated: false });
  const espn = ncaafProposal();
  espn.source_data.resolutionCriteria = criteria;
  assert.deepEqual(pendingApprovalResolutionRules(espn), { criteria, generated: false });
});

test('ESPN soccer draw3 rules use regulation time and keep the resolver outcome order', () => {
  const row = ncaafProposal();
  row.source = 'espn-soccer';
  row.source_event_id = 'eng.1:401866475';
  row.question = 'Fulham vs Leeds United';
  row.outcomes = ['Fulham', 'Empate', 'Leeds United'];
  Object.assign(row.resolver_config, { leaguePath: 'soccer/eng.1', shape: 'draw3' });
  Object.assign(row.source_data, {
    leagueCode: 'eng.1', home: { id: '370', name: 'Fulham' }, away: { id: '357', name: 'Leeds United' },
  });
  const rules = pendingApprovalResolutionRules(row);
  assert.match(rules.criteria, /tiempo reglamentario.*sin prórroga ni penales/);
  assert.match(rules.criteria, /Fulham si gana el local, Empate si terminan igualados y Leeds United si gana el visitante/);
  row.resolver_config.eventId = '401866476';
  assert.equal(pendingApprovalResolutionRules(row), null);
});
