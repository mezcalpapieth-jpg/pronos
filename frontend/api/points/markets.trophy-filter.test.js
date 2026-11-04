import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('public tournament and home filters honor only the saved trophy, regardless of approval date', async () => {
  const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');
  const start = source.indexOf('AND (\n            ${tournamentOnly}');
  assert.ok(start > 0, 'public visibility filters must exist');
  const filters = source.slice(start, source.indexOf('ORDER BY', start))
    .replaceAll('${tournamentOnly}', '$1')
    .replaceAll('${featuredOnly}', '$2')
    .replaceAll('${status}', '$3');
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE points_markets (
      id int PRIMARY KEY, tournament_featured boolean, featured boolean, hidden_from_home boolean,
      created_at timestamptz, reviewed_at timestamptz);
      INSERT INTO points_markets VALUES
        (1,false,true,false,'2026-11-04','2026-11-04'),
        (2,true,false,true,'2026-09-01','2026-09-01'),
        (3,false,true,true,'2026-11-04','2026-11-04'),
        (4,false,false,false,'2026-09-01','2026-09-01'),
        (5,true,false,false,'2026-11-04','2026-11-04'),
        (6,NULL,false,false,'2026-11-04','2026-11-04');`);
    const ids = async (tournamentOnly, featuredOnly) => (await db.query(
      `SELECT m.id FROM points_markets m WHERE true ${filters} ORDER BY m.id`,
      [tournamentOnly, featuredOnly, 'active'],
    )).rows.map(row => row.id);
    assert.deepEqual(await ids(true, false), [2,5]);
    assert.deepEqual(await ids(false, true), [1,2,5]);
    assert.deepEqual(await ids(false, false), [1,2,4,5,6]);
    // Turning the actual trophy off immediately removes tournament membership
    // and its hidden-market override, even for a market approved in November.
    await db.query('UPDATE points_markets SET tournament_featured=false, hidden_from_home=true WHERE id=5');
    assert.deepEqual(await ids(true, false), [2]);
    assert.deepEqual(await ids(false, true), [1,2]);
    assert.deepEqual(await ids(false, false), [1,2,4,6]);
  } finally { await db.close(); }
});
