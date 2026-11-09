import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const source = await readFile(new URL('./run-generators.js', import.meta.url), 'utf8');

test('disabled Points airport generators make no source calls while unrelated generators still run', async () => {
  const { runAllGenerators, upsertPending } = await import('./run-generators.js');
  let otherCalls = 0;
  const { allSpecs, sourceStats } = await runAllGenerators({
    disabledGenerators: ['aicm', 'aicm-48h'],
    generators: [
      { name: 'aicm', run: () => assert.fail('disabled airport generator called') },
      { name: 'aicm-48h', run: () => assert.fail('disabled airport generator called') },
      { name: 'other', run: async () => { otherCalls++; return []; } },
    ],
  });
  assert.equal(otherCalls, 1);
  assert.deepEqual(allSpecs, []);
  assert.equal(sourceStats.aicm.skipped, true);
  const savedFlag = process.env.POINTS_AVIATION_EDGE_ENABLED;
  delete process.env.POINTS_AVIATION_EDGE_ENABLED;
  try {
    const result = await upsertPending(() => assert.fail('disabled airport must not be persisted'), [{ source: 'aviation-edge-timetable' }]);
    assert.equal(result.skipped, 1);
  } finally {
    if (savedFlag === undefined) delete process.env.POINTS_AVIATION_EDGE_ENABLED;
    else process.env.POINTS_AVIATION_EDGE_ENABLED = savedFlag;
  }
  // Shared protocol callers retain the default runner behavior.
  let defaultCalls = 0;
  await runAllGenerators({ generators: [{ name: 'aicm', run: async () => { defaultCalls++; return []; } }] });
  assert.equal(defaultCalls, 1);
});

test('runAllGenerators attaches suggested pricing to generated specs before upsert', () => {
  assert.match(source, /attachUniformGeneratedPricing/);
  assert.match(source, /attachMarketContextBlocks/);
  assert.match(source, /attachMarketTranslations/);
  assert.match(source, /attachGeneratorPricing/);
  assert.match(source, /export async function prepareGeneratedSpecs/);
  assert.match(source, /return specs\.map\(spec => attachUniformGeneratedPricing\(spec\)\)/);
  assert.match(source, /return pricedSpecs\.map\(spec => attachMarketTranslations\(attachMarketContextBlocks\(spec\)\)\)/);
  assert.match(source, /const contextualSpecs = await prepareGeneratedSpecs\(specs\)/);
});

test('source timing is reported for empty, failed and skipped generators and the batch continues', async t => {
  const { runAllGenerators } = await import('./run-generators.js');
  t.mock.method(console, 'error', () => {});
  const { sourceStats } = await runAllGenerators({
    disabledGenerators: ['disabled'],
    generators: [
      { name: 'disabled', run: () => assert.fail('disabled generator called') },
      { name: 'failed', run: async () => { await delay(5); throw new Error('unavailable'); } },
      { name: 'empty', run: async () => { await delay(5); return []; } },
    ],
  });
  assert.deepEqual(sourceStats.disabled, { count: 0, skipped: true, reason: 'source_disabled', elapsedMs: 0 });
  assert.equal(sourceStats.failed.error, 'unavailable');
  assert.ok(sourceStats.failed.elapsedMs > 0);
  assert.equal(sourceStats.empty.count, 0);
  assert.ok(sourceStats.empty.elapsedMs > 0);
});

test('Football Data and charts overlap the serial lane without reordering output', async t => {
  const { runAllGenerators } = await import('./run-generators.js');
  t.mock.method(console, 'error', () => {});
  let releaseSoccer;
  const held = new Promise(resolve => { releaseSoccer = resolve; });
  const started = [];
  const spec = id => [{ source_event_id: id, question: id, outcomes: ['Sí', 'No'] }];
  const generators = [
    { name: 'soccer', run: async () => { started.push('soccer'); await held; return spec('soccer'); } },
    { name: 'espn-soccer', run: async () => { started.push('espn-soccer'); return spec('espn-soccer'); } },
    { name: 'charts', run: async () => { started.push('charts'); throw new Error('chart unavailable'); } },
    { name: 'next', run: async () => { started.push('next'); return spec('next'); } },
  ];
  const pending = runAllGenerators({ generators, parallelSources: true });
  assert.deepEqual(started, ['soccer', 'charts', 'espn-soccer']);
  releaseSoccer();
  const { allSpecs, sourceStats } = await pending;
  assert.deepEqual(started, ['soccer', 'charts', 'espn-soccer', 'next']);
  assert.deepEqual(allSpecs.map(spec => spec.source_event_id), ['soccer', 'espn-soccer', 'next']);
  assert.deepEqual(Object.keys(sourceStats), ['soccer', 'espn-soccer', 'charts', 'next']);
  assert.equal(sourceStats.charts.error, 'chart unavailable');
});

test('expired candidates are counted separately and partial or empty feed failures are reported', async t => {
  const { runAllGenerators, upsertPending, upsertProtocolPending } = await import('./run-generators.js');
  t.mock.method(console, 'warn', () => {});
  const expired = { source_event_id: 'past', end_time: '2000-01-01T00:00:00Z' };
  const upcoming = { source_event_id: 'future', end_time: '2099-01-01T00:00:00Z' };
  const { allSpecs, sourceStats } = await runAllGenerators({ generators: [
    { name: 'partial', async run({ reportFeedError }) {
      reportFeedError('Chart', Object.assign(new Error('provider detail'), { status: 504 }));
      return [expired, upcoming];
    } },
    { name: 'empty', async run() { return []; } },
    { name: 'offline', async run({ reportFeedError }) {
      reportFeedError('Provider', new DOMException('request timed out', 'TimeoutError'));
      return [];
    } },
  ] });
  assert.deepEqual(allSpecs.map(s => s.source_event_id), ['future']);
  assert.equal(sourceStats.partial.count, 1);
  assert.equal(sourceStats.partial.expiredCount, 1);
  assert.deepEqual(sourceStats.partial.feedErrors, [{ feed: 'Chart', code: 'http_504' }]);
  assert.deepEqual(sourceStats.offline.feedErrors, [{ feed: 'Provider', code: 'timeout' }]);
  assert.equal(sourceStats.empty.feedErrors, undefined);
  for (const upsert of [upsertPending, upsertProtocolPending]) {
    assert.equal((await upsert(() => assert.fail('expired candidate must not reach storage'), [expired])).skipped, 1);
  }
});

test('generator runner includes the AICM infrastructure pipeline', () => {
  assert.match(source, /generateAicmMarkets/);
  assert.match(source, /\{ name:\s*'aicm',\s*run:\s*generateAicmMarkets/);
});

test('reality show feeds are skipped outside their dated Mexico City seasons', async () => {
  const { GENERATORS, runAllGenerators } = await import('./run-generators.js');
  const windows = [
    { name: 'lcdlf', start: '2026-07-26', dayAfter: '2026-10-05' },
    { name: 'granja-vip', start: '2026-09-06', dayAfter: '2026-12-21' },
  ];

  for (const { name, start, dayAfter } of windows) {
    const { run } = GENERATORS.find(generator => generator.name === name);
    for (const [instant, inSeason] of [
      [`${start}T05:59:59Z`, false],
      [`${start}T06:00:00Z`, true],
      [`${dayAfter}T05:59:59Z`, true],
      [`${dayAfter}T06:00:00Z`, false],
      [`2027${start.slice(4)}T12:00:00Z`, false],
    ]) {
      let requests = 0;
      const fetchImpl = async () => {
        requests++;
        return { ok: true, status: 200, text: async () => '<html></html>' };
      };
      const { sourceStats } = await runAllGenerators({ generators: [{
        name,
        run: options => run({ ...options, now: new Date(instant), fetchImpl }),
      }] });
      const context = `${name} at ${instant}`;
      assert.equal(requests > 0, inSeason, context);
      assert.equal(sourceStats[name].reason, inSeason ? undefined : 'outside_season', context);
      assert.equal(sourceStats[name].skipped, inSeason ? undefined : true, context);
      assert.equal(sourceStats[name].feedErrors, undefined, context);
    }
  }
});

test('generator runner includes the MLB World Series winner pipeline', () => {
  assert.match(source, /generateMlbWorldSeries2026Markets/);
  assert.match(source, /\{ name:\s*'mlb-world-series-2026',\s*run:\s*generateMlbWorldSeries2026Markets/);
});

test('generator runner includes the Gilberto Mora transfer pipeline', () => {
  assert.match(source, /generateGilbertoMoraTransfer2026Markets/);
  assert.match(source, /\{ name:\s*'gilberto-mora-transfer-2026',\s*run:\s*generateGilbertoMoraTransfer2026Markets/);
});

test('points pending upsert persists per-option seed liquidities', () => {
  assert.match(source, /seed_liquidity,\s*seed_liquidities/);
  assert.match(source, /\$\{s\.seed_liquidities \? JSON\.stringify\(s\.seed_liquidities\) : null\}::jsonb/);
  assert.match(source, /seed_liquidities\s*=\s*EXCLUDED\.seed_liquidities/);
});

test('larger generated reserve floors apply only to the Points pending queue', () => {
  const points = source.split('export async function upsertPending')[1].split('export async function upsertProtocolPending')[0];
  const protocol = source.split('export async function upsertProtocolPending')[1];
  assert.match(points, /const s = attachGeneratedPointsLiquidity\(spec\)/);
  assert.doesNotMatch(protocol, /attachGeneratedPointsLiquidity\(/);
});

test('points pending upsert preserves generator featured flags', () => {
  assert.match(source, /featured,\s*tournament_featured,\s*category_tags/);
  assert.match(source, /\$\{s\.featured === true\}/);
  assert.match(source, /\$\{s\.tournament_featured === true\}/);
  assert.match(source, /featured\s*=\s*points_pending_markets\.featured OR EXCLUDED\.featured/);
  assert.match(source, /tournament_featured\s*=\s*points_pending_markets\.tournament_featured OR EXCLUDED\.tournament_featured/);
  assert.match(source, /EXCLUDED\.tournament_featured IS TRUE AND points_pending_markets\.tournament_featured IS DISTINCT FROM TRUE/);
});

test('points pending upsert avoids rewriting unchanged pending rows', () => {
  assert.match(source, /points_pending_markets\.status = 'pending'[\s\S]*IS DISTINCT FROM EXCLUDED\.source_data/);
  assert.match(source, /points_pending_markets\.question IS DISTINCT FROM EXCLUDED\.question/);
  assert.match(source, /points_pending_markets\.seed_liquidities IS DISTINCT FROM EXCLUDED\.seed_liquidities/);
  assert.match(source, /points_pending_markets\.topic_tags IS DISTINCT FROM EXCLUDED\.topic_tags/);
  assert.match(source, /unchanged pending row/);
});

test('protocol pending upsert avoids rewriting unchanged pending rows', () => {
  assert.match(source, /protocol_pending_markets\.status = 'pending'[\s\S]*IS DISTINCT FROM EXCLUDED\.source_data/);
  assert.match(source, /protocol_pending_markets\.question IS DISTINCT FROM EXCLUDED\.question/);
  assert.match(source, /protocol_pending_markets\.seed_liquidity IS DISTINCT FROM EXCLUDED\.seed_liquidity/);
  assert.match(source, /protocol_pending_markets\.topic_tags IS DISTINCT FROM EXCLUDED\.topic_tags/);
});

test('generator runner can sync approved ATP H2H schedule changes', () => {
  assert.match(source, /APPROVED_SCHEDULE_SYNC_SOURCES[\s\S]*espn-atp-match/);
  assert.match(source, /export async function syncApprovedMarketSchedules/);
  assert.match(source, /UPDATE points_markets m[\s\S]*SET end_time = \$\{s\.end_time\}::timestamptz/);
  assert.match(source, /UPDATE points_pending_markets[\s\S]*resolver_config = \$\{freshResolverConfig\}::jsonb/);
});
