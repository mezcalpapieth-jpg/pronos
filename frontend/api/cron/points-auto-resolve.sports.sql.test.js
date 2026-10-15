import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('./points-auto-resolve.js', import.meta.url), 'utf8');
const query = source.match(/const candidates = await candidateSql`([\s\S]*?)`;/)?.[1];

test('the minute sports pass finds early finals and rescheduled games without waiting for end_time', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets (
      id INT PRIMARY KEY, question TEXT, category TEXT, start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ DEFAULT NOW() + INTERVAL '5 hours', resolver_type TEXT DEFAULT 'sports_api',
      resolver_config JSONB DEFAULT '{"source":"espn","shape":"binary"}',
      outcomes JSONB, amm_mode TEXT, sport TEXT, league TEXT, source TEXT, source_event_id TEXT,
      status TEXT DEFAULT 'active', parent_id INT
    );
    CREATE TABLE points_pending_markets (id INT, approved_market_id INT, source_data JSONB);
    CREATE TABLE points_resolver_checkpoints (market_id INT, checkpoint_key TEXT, last_checked_at TIMESTAMPTZ);
    INSERT INTO points_markets (id,start_time) VALUES
      (1,NOW()-INTERVAL '30 minutes'),
      (2,NOW()+INTERVAL '5 hours'),
      (3,NOW()+INTERVAL '11 hours'),
      (4,NOW()+INTERVAL '2 days'),
      (5,NOW()-INTERVAL '3 days'),
      (6,NOW()-INTERVAL '2 hours'),
      (7,NOW()-INTERVAL '2 hours'),
      (8,NOW()-INTERVAL '2 hours'),
      (9,NOW()-INTERVAL '2 hours'),
      (10,NOW()-INTERVAL '2 hours'),
      (11,NOW()-INTERVAL '2 hours'),
      (12,NOW()-INTERVAL '2 hours');
    UPDATE points_markets SET resolver_type='manual_review',end_time=NOW()-INTERVAL '1 hour' WHERE id=6;
    UPDATE points_markets SET resolver_type='weather_api',end_time=NOW()-INTERVAL '1 hour' WHERE id=7;
    UPDATE points_markets SET status='resolved' WHERE id=8;
    UPDATE points_markets SET parent_id=1 WHERE id=9;
    UPDATE points_markets SET resolver_config='{"source":"espn","shape":"parallel"}' WHERE id=10;
    UPDATE points_markets SET resolver_config='{"source":"espn","shape":"draw3"}' WHERE id=11;
    UPDATE points_markets SET resolver_config='{"source":"football-data","shape":"total-goals-over"}' WHERE id=12;
  `);
  const sql = async (strings, ...values) => (await db.query(
    strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values,
  )).rows;
  const run = new Function('candidateSql', 'sportsOnly', 'NEXT_OPPONENT_RECHECK_INTERVAL_HOURS', `return candidateSql\`${query}\`;`);
  assert.ok(query);
  const fast = await run(sql, true, 6);
  assert.deepEqual(fast.map(row => row.id).sort((a, b) => a - b), [1, 2, 3, 11]);
  const full = await run(sql, false, 6);
  assert.deepEqual(full.map(row => row.id).sort((a, b) => a - b), [1, 2, 3, 5, 6, 7, 11, 12]);
});
