import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { planOfficialContractUpgrade, updateOfficialContracts, OFFICIAL_UPGRADE_IDS } from './official-contract-upgrade.js';
import { GDP_OUTCOMES, RT_OUTCOMES, AA_OUTCOMES } from './automated-market-rules.js';

const now = new Date('2026-10-15T12:00:00Z');
const inventory = () => [
  [317495, 'october-tournament-2026', 'october-2026:mexico-gdp-q3-yoy', GDP_OUTCOMES, '2026-10-30T05:59:00Z'],
  [317675, 'october-tournament-2026', 'october-2026:street-fighter-rotten-tomatoes', RT_OUTCOMES, '2026-10-19T13:59:00Z'],
  [332179, 'ai-benchmark', 'ai-benchmark:2026-10:artificial-analysis-index-lab', AA_OUTCOMES, '2026-11-01T05:59:00Z'],
  [337989, 'ai-named-model-release', 'ai-named-release:2026:gpt-astra-6-1', ['Sí', 'No'], '2027-01-01T05:59:59Z'],
].map(([id, source, source_event_id, outcomes, end_time]) => ({ id, source, source_event_id, outcomes, end_time,
  question: `Original ${id}`, resolver_type: 'manual_review', resolver_config: { criteria: 'Original published criteria' },
  source_data: { translations: { es: { question: `Original ${id}` } } }, status: 'active', parent_id: null,
  mode: 'points', created_at: '2026-10-01T12:00:00Z' }));

test('four-contract preview is deterministic, exact identity guarded and Astra uses October 31 CDMX', () => {
  const plan = planOfficialContractUpgrade(inventory(), { now });
  assert.deepEqual(plan.entries.map(r => r.id), OFFICIAL_UPGRADE_IDS);
  assert.equal(plan.planHash, planOfficialContractUpgrade(inventory().reverse(), { now }).planHash);
  const astra = plan.entries.find(r => r.id === 337989);
  assert.equal(astra.after.end_time, '2026-11-01T05:59:59.000Z');
  assert.equal(astra.after.resolver_config.cutoff, astra.after.end_time);
  assert.match(astra.after.question, /31 de octubre/);
  assert.doesNotMatch(astra.after.resolver_config.criteria, /diciembre/);
  for (const patch of [{ source: 'other' }, { source_event_id: 'other' }, { mode: 'onchain' },
    { outcomes: [...GDP_OUTCOMES].reverse() }, { status: 'resolved' }, { parent_id: 123 }]) {
    const rows = inventory(); Object.assign(rows[0], patch);
    assert.throws(() => planOfficialContractUpgrade(rows, { now }), /identity_mismatch/);
  }
  assert.throws(() => planOfficialContractUpgrade(inventory().slice(1), { now }), /inventory/);
  assert.throws(() => planOfficialContractUpgrade(inventory(), { now: new Date('2026-11-02') }), /already_closed/);
});

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE points_markets (id INTEGER PRIMARY KEY, question TEXT, outcomes JSONB, source TEXT, source_event_id TEXT,
    status TEXT, parent_id INTEGER, mode TEXT, created_at TIMESTAMPTZ, end_time TIMESTAMPTZ, resolver_type TEXT, resolver_config JSONB,
    reserves JSONB DEFAULT '[1000,1000]'::jsonb);
    CREATE TABLE points_pending_markets (id SERIAL, approved_market_id INTEGER, question TEXT, end_time TIMESTAMPTZ,
      resolver_type TEXT, resolver_config JSONB, source_data JSONB);
    CREATE TABLE points_resolution_candidates (points_market_id INTEGER, status TEXT, reviewer TEXT, reviewed_at TIMESTAMPTZ, admin_note TEXT);
    CREATE TABLE points_balances (username TEXT, balance NUMERIC);
    CREATE TABLE points_positions (username TEXT, market_id INTEGER, shares NUMERIC);
    INSERT INTO points_balances VALUES ('alice',1234.56);
    INSERT INTO points_positions VALUES ('alice',337989,123.45);`);
  for (const m of inventory()) {
    await db.query(`INSERT INTO points_markets (id,question,outcomes,source,source_event_id,status,parent_id,mode,created_at,end_time,resolver_type,resolver_config)
      VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [m.id, m.question, JSON.stringify(m.outcomes), m.source, m.source_event_id, m.status, m.parent_id,
      m.mode, m.created_at, m.end_time, m.resolver_type, JSON.stringify(m.resolver_config)]);
    await db.query(`INSERT INTO points_pending_markets (approved_market_id,source_data) VALUES ($1,$2::jsonb)`, [m.id, JSON.stringify(m.source_data)]);
    await db.query(`INSERT INTO points_resolution_candidates (points_market_id,status) VALUES ($1,'pending')`, [m.id]);
  }
  for (const id of [317524, 332130, 332178]) await db.query(`INSERT INTO points_markets (id,resolver_type) VALUES ($1,'manual_review')`, [id]);
  return db;
}

test('preview writes nothing; approved activation updates only four rules and not money, shares, reserves or manual markets', async () => {
  const db = await database();
  try {
    const before = (await db.query('SELECT * FROM points_markets ORDER BY id')).rows;
    const preview = await updateOfficialContracts(db, { now });
    assert.equal(preview.applied, false);
    assert.deepEqual((await db.query('SELECT * FROM points_markets ORDER BY id')).rows, before);
    await assert.rejects(db.transaction(tx => updateOfficialContracts(tx, { now, apply: true, actor: 'admin', expectedPlanHash: 'wrong' })), /preview_required/);
    const result = await db.transaction(tx => updateOfficialContracts(tx, { now, apply: true, actor: 'admin', expectedPlanHash: preview.planHash }));
    assert.deepEqual(result.marketIds, OFFICIAL_UPGRADE_IDS);
    const after = (await db.query('SELECT * FROM points_markets ORDER BY id')).rows;
    for (let i = 0; i < before.length; i++) {
      assert.deepEqual(after[i].reserves, before[i].reserves);
      assert.deepEqual(after[i].outcomes, before[i].outcomes);
      if (!OFFICIAL_UPGRADE_IDS.includes(before[i].id)) assert.deepEqual(after[i], before[i]);
    }
    assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '1234.56');
    assert.equal((await db.query('SELECT shares FROM points_positions')).rows[0].shares, '123.45');
    assert.equal((await db.query("SELECT COUNT(*) FROM points_resolution_candidates WHERE status='denied'")).rows[0].count, 4);
    assert.equal((await db.query("SELECT COUNT(*) FROM points_pending_markets WHERE resolver_type='api_chart'")).rows[0].count, 4);
    const repeated = await updateOfficialContracts(db, { now });
    assert.deepEqual(repeated.entries, []);
    const gdp = after.find(m => m.id === 317495);
    assert.equal(gdp.resolver_config.automationUpgrade.before.resolver_type, 'manual_review');
    await db.query(`UPDATE points_markets SET resolver_config=resolver_config || '{"targetPeriod":"2026-Q2"}'::jsonb WHERE id=317495`);
    await assert.rejects(updateOfficialContracts(db, { now }), /modified_contract/);
  } finally { await db.close(); }
});

test('an edited contract invalidates approval and an interrupted activation rolls back all four', async () => {
  const db = await database();
  try {
    const preview = await updateOfficialContracts(db, { now });
    await db.query(`UPDATE points_markets SET question='Edited while previewing' WHERE id=337989`);
    await assert.rejects(db.transaction(tx => updateOfficialContracts(tx, { now, apply: true, actor: 'admin', expectedPlanHash: preview.planHash })), /stale/);
    const updated = await updateOfficialContracts(db, { now });
    await assert.rejects(db.transaction(async tx => {
      await updateOfficialContracts(tx, { now, apply: true, actor: 'admin', expectedPlanHash: updated.planHash });
      throw new Error('simulated_interruption');
    }), /interruption/);
    assert.equal((await db.query("SELECT COUNT(*) FROM points_markets WHERE resolver_type='api_chart'")).rows[0].count, 0);
    assert.equal((await db.query("SELECT COUNT(*) FROM points_resolution_candidates WHERE status='pending'")).rows[0].count, 4);
  } finally { await db.close(); }
});
