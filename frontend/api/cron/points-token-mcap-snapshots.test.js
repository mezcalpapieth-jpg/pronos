import assert from 'node:assert/strict';
import test from 'node:test';

const originalDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost/pronos';
const { runTokenMcapSnapshots } = await import('./points-token-mcap-snapshots.js');
if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;

const capturedAt = '2026-11-01T05:59:40.000Z';
const tokenAddress = 'BS7HxRitaY5ipGfbek1nmatWLbaS9yoWRSEQzCb3pump';
const cfg = { coinId: 'holder', network: 'solana', tokenAddress };

function fixture({ shape = 'array', candidates, readError = null } = {}) {
  const inserted = [];
  const reads = [];
  let schemaCalls = 0;
  let purgeCalls = 0;
  const result = rows => shape === 'array' ? rows : { rows };
  const deps = {
    sqlClient: {
      query: async (query, params) => {
        if (query.includes('SELECT id, resolver_config')) {
          assert.deepEqual(params, ['coingecko-token-mcap']);
          assert.match(query, /pg_input_is_valid\(resolver_config->>'closesAt', 'timestamp with time zone'\)/);
          assert.match(query, /ELSE end_time\s+END AS snapshot_deadline/);
          assert.match(query, /WHERE snapshot_deadline > NOW\(\) - INTERVAL '10 minutes'/);
          assert.match(query, /ORDER BY snapshot_deadline ASC, id ASC/);
          return result(candidates ?? [
            { id: 350154, resolver_config: cfg },
            { id: 350155, resolver_config: JSON.stringify(cfg) },
          ]);
        }
        if (query.includes('INSERT INTO points_token_mcap_snapshots')) {
          inserted.push(params);
          return result([]);
        }
        if (query.includes('DELETE FROM points_token_mcap_snapshots')) {
          purgeCalls++;
          return result([{ id: 1 }, { id: 2 }]);
        }
        throw new Error('unexpected query');
      },
    },
    ensureSchema: async () => { schemaCalls++; },
    readSnapshot: async options => {
      reads.push(options);
      if (readError) throw readError;
      return {
        coinId: 'holder',
        source: 'coingecko-markets',
        marketCap: 200001,
        priceUsd: 0.000200001,
        circulatingSupply: 1000000000,
        capturedAt: options.capturedAt,
        sourceUpdatedAt: '2026-11-01T05:59:20.000Z',
        raw: { symbol: 'doggy' },
      };
    },
  };
  return { deps, inserted, reads, schemaCalls: () => schemaCalls, purgeCalls: () => purgeCalls };
}

for (const shape of ['array', 'rows']) {
  test(`collector writes closing evidence from ${shape}-shaped database results`, async () => {
    const f = fixture({ shape });
    const report = await runTokenMcapSnapshots({ capturedAt }, f.deps);
    assert.equal(report.ok, true);
    assert.equal(report.candidates, 2);
    assert.equal(report.written, 2);
    assert.equal(report.fetchedCoins, 1);
    assert.equal(report.purged, 2);
    assert.equal(f.schemaCalls(), 1);
    assert.equal(f.reads.length, 1);
    assert.deepEqual(f.reads[0], { coinId: 'holder', capturedAt });
    assert.equal(f.inserted.length, 2);
    assert.deepEqual(f.inserted.map(params => params[0]), [350154, 350155]);
    for (const params of f.inserted) {
      assert.equal(params[1], 'holder');
      assert.equal(params[3], tokenAddress);
      assert.equal(params[4], 'coingecko-markets');
      assert.equal(params[5], 200001);
      assert.equal(params[10], capturedAt);
    }
  });
}

test('collector dry-run discovers Neon array candidates without fetching or writing', async () => {
  const f = fixture();
  const report = await runTokenMcapSnapshots({ dryRun: true, capturedAt }, f.deps);
  assert.equal(report.count, 2);
  assert.equal(report.sample[0].id, 350154);
  assert.equal(f.reads.length, 0);
  assert.equal(f.inserted.length, 0);
  assert.equal(f.purgeCalls(), 0);
});

test('indexer collection preserves retained evidence when purgeOld is false', async () => {
  const f = fixture();
  const report = await runTokenMcapSnapshots({ capturedAt, purgeOld: false }, f.deps);
  assert.equal(report.written, 2);
  assert.equal(report.purged, 0);
  assert.equal(f.purgeCalls(), 0);
});

test('collector keeps gathering resolution evidence after trading closes early', async () => {
  const f = fixture({ candidates: [{
    id: 350154,
    end_time: '2026-11-01T04:59:00.000Z',
    resolver_config: { ...cfg, closesAt: '2026-11-01T05:59:59.000Z' },
  }] });
  const report = await runTokenMcapSnapshots({ capturedAt, purgeOld: false }, f.deps);
  assert.equal(report.candidates, 1);
  assert.equal(report.written, 1);
  assert.equal(f.inserted[0][10], capturedAt);
});

test('collector skips malformed candidates and reports upstream failures', async () => {
  const f = fixture({
    candidates: [
      { id: 350154, resolver_config: cfg },
      { id: 350155, resolver_config: '{invalid' },
      { id: 350156, resolver_config: { coinId: 'holder' } },
    ],
    readError: new Error('coingecko unavailable'),
  });
  const report = await runTokenMcapSnapshots({ capturedAt, purgeOld: false }, f.deps);
  assert.equal(report.ok, false);
  assert.equal(report.candidates, 1);
  assert.equal(report.written, 0);
  assert.deepEqual(report.errors, [{ id: 350154, coinId: 'holder', error: 'coingecko unavailable' }]);
  assert.equal(f.inserted.length, 0);
});
