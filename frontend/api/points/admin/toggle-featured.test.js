import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused';
const { updatePendingTournamentFeature } = await import('./toggle-featured.js');
if (previousUrl === undefined) delete process.env.DATABASE_URL;

test('adding a pending trophy raises uniform defaults visibly without repricing custom or approved rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE points_pending_markets (
      id INTEGER PRIMARY KEY, status TEXT DEFAULT 'pending', featured BOOLEAN DEFAULT FALSE,
      tournament_featured BOOLEAN DEFAULT FALSE, category TEXT DEFAULT 'deportes',
      outcomes JSONB DEFAULT '["A","B","C"]', amm_mode TEXT DEFAULT 'unified',
      end_time TIMESTAMPTZ DEFAULT '2026-10-25T18:00:00Z', resolver_config JSONB,
      source_data JSONB, seed_liquidity NUMERIC DEFAULT 1000, seed_liquidities JSONB DEFAULT '[1000,1000,1000]'
    );
    INSERT INTO points_pending_markets (id) VALUES (1);
    INSERT INTO points_pending_markets (id,category) VALUES (2,'finanzas');
    INSERT INTO points_pending_markets (id,seed_liquidities) VALUES (3,'[1000,2000,3000]');
    INSERT INTO points_pending_markets (id,status) VALUES (4,'approved');
    INSERT INTO points_pending_markets (id,end_time) VALUES (5,'2026-12-01');`);
    const update = (id, flag = true) => db.transaction(client => updatePendingTournamentFeature(client, id, flag));
    const [sports] = await update(1);
    assert.equal(Number(sports.seed_liquidity), 7500);
    assert.deepEqual(sports.seed_liquidities, [7500,7500,7500]);
    assert.deepEqual((await update(1))[0], sports);
    assert.deepEqual((await update(1,false))[0].seed_liquidities, sports.seed_liquidities);
    assert.deepEqual((await update(2))[0].seed_liquidities, [3750,3750,3750]);
    assert.deepEqual((await update(3))[0].seed_liquidities, [1000,2000,3000]);
    assert.deepEqual((await update(4))[0].seed_liquidities, [1000,1000,1000]);
    assert.deepEqual((await update(5))[0].seed_liquidities, [7500,7500,7500]);
    assert.deepEqual(await update(999), []);
  } finally { await db.close(); }
});
