import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { findRelatedMarketIds } from './related-points-markets.js';
import { PRONOS_TREASURY_USERNAME } from './points-limit-orders.js';
import { FESTIVAL_SOURCE } from '../../shared/trading-festival.js';

test('related Points markets prioritize an event or series, then teams and category volume within public active discovery', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE points_markets (
        id int PRIMARY KEY,
        parent_id int,
        archived_at timestamptz,
        category text DEFAULT 'sports',
        outcomes jsonb DEFAULT '["Sí","No"]',
        mode text,
        source text DEFAULT 'espn',
        source_event_id text,
        resolver_config jsonb,
        start_time timestamptz,
        end_time timestamptz DEFAULT now() + interval '1 day',
        sport text DEFAULT 'basketball',
        league text,
        status text DEFAULT 'active',
        hidden_from_home boolean,
        tournament_featured boolean
      );
      CREATE TABLE points_pending_markets (id serial PRIMARY KEY, approved_market_id int, source_data jsonb);
      CREATE TABLE points_trades (market_id int, collateral numeric, username text);
      INSERT INTO points_markets (id, category, status, source_event_id, resolver_config) VALUES
        (1, 'sports', 'resolved', 'game-1', '{"source":"espn","leaguePath":"basketball/nba","series":{"key":"NBA-1","gameNumber":1,"homeTeam":{"name":"Lakers"},"awayTeam":{"name":"Spurs"}}}'),
        (2, 'special', 'active', 'game-1', null),
        (3, 'special', 'active', 'game-2', '{"source":"espn","leaguePath":"basketball/nba","series":{"key":"NBA-1","gameNumber":2}}'),
        (4, 'special', 'active', 'game-3', '{"homeName":"Lakers","awayName":"Raptors"}'),
        (5, 'sports', 'active', null, null),
        (6, 'sports', 'active', null, null),
        (7, 'other', 'active', null, null),
        (8, 'sports', 'resolved', 'game-1', null),
        (9, 'sports', 'active', 'game-1', null),
        (10, 'sports', 'active', 'game-1', null),
        (11, 'sports', 'active', 'game-1', null),
        (12, 'sports', 'active', 'game-1', null),
        (13, 'sports', 'active', 'game-1', null),
        (14, 'sports', 'active', null, null),
        (15, 'sports', 'active', 'game-7', '{"source":"espn","leaguePath":"basketball/nba","series":{"key":"NBA-1","gameNumber":7}}');
      UPDATE points_markets SET hidden_from_home = true WHERE id = 9;
      UPDATE points_markets SET archived_at = now() WHERE id = 10;
      UPDATE points_markets SET end_time = now() - interval '1 day' WHERE id = 11;
      UPDATE points_markets SET mode = 'onchain' WHERE id = 12;
      UPDATE points_markets SET parent_id = 6 WHERE id = 14;
      INSERT INTO points_trades VALUES
        (5, 10, 'user'), (6, 7, 'user'), (14, -7, 'user'), (7, 50000, 'user');
      INSERT INTO points_pending_markets(approved_market_id, source_data)
        VALUES (4, '{"home":{"name":"Lakers"}}');
    `);
    await db.query('UPDATE points_markets SET source = $1 WHERE id = 13', [FESTIVAL_SOURCE]);
    await db.query('INSERT INTO points_trades VALUES (5, 50000, $1)', [PRONOS_TREASURY_USERNAME]);
    const sql = async (strings, ...values) => {
      const query = strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, '');
      return (await db.query(query, values)).rows;
    };

    assert.deepEqual(await findRelatedMarketIds(sql, 1, 5), [2, 3, 4, 6, 5]);
    assert.deepEqual(await findRelatedMarketIds(sql, 1, 2), [2, 3]);
    assert.deepEqual(await findRelatedMarketIds(sql, 13, 5), []);
    assert.deepEqual(await findRelatedMarketIds(sql, 999, 5), []);
  } finally {
    await db.close();
  }
});
