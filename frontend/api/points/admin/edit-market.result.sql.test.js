import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const source = await readFile(new URL('./edit-market.js', import.meta.url), 'utf8');

test('admins can add, update, and remove a public result without changing settlement', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE points_markets (
    id INT PRIMARY KEY, question TEXT, category TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ,
    sport TEXT, league TEXT, outcomes JSONB, image_url TEXT, outcome_images JSONB,
    resolver_type TEXT, resolver_config JSONB, category_tags JSONB, geo_tags JSONB, topic_tags JSONB,
    status TEXT, amm_mode TEXT, parent_id INT, seed_liquidity NUMERIC, final_score TEXT, outcome INT
  );
  INSERT INTO points_markets (id, question, category, outcomes, status, outcome, amm_mode, resolver_config, start_time, end_time)
    VALUES (1, 'Legacy market', 'general', '["Yes","No"]', 'resolved', 1, 'unified', '{"original":true}', '2026-10-02', '2026-10-01');`);
  const sql = async (strings, ...values) => (await db.query(
    strings.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, ''), values,
  )).rows;
  const dependencies = {
    neon: () => sql,
    applyCors: () => false,
    requirePointsAdmin: () => ({ username: 'admin' }),
    ensurePointsSchema: async () => {},
    // Simulate a resolver whose current sync rules differ from its stored
    // legacy config. A display-only edit must leave that config untouched.
    syncMananeraPhraseFromQuestion: () => ({ resolverConfig: { changed: true } }),
    syncApiPriceFromQuestion: input => input,
    syncWeatherDateFromMarket: input => input,
    validateBeforeMonthDeadline: () => assert.fail('result-only edits must not revalidate old deadlines'),
    deriveMarketTags: () => assert.fail('result-only edits must not rewrite tags'),
    withTransaction: () => assert.fail('result-only edits must not touch reserves'),
  };
  const handler = new Function(...Object.keys(dependencies), source
    .replace(/^import .*;\n/gm, '')
    .replace('export default async function handler', 'return async function handler'))(...Object.values(dependencies));
  const request = async body => {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ method: 'POST', body }, response);
    return response;
  };

  for (const [input, expected] of [['  Final value: 3.8%  ', 'Final value: 3.8%'], ['Corrected display', 'Corrected display'], ['', null], [null, null]]) {
    const response = await request({ marketId: 1, finalScore: input });
    assert.equal(response.code, 200);
    assert.equal(response.data.market.finalScore, expected);
    const row = (await db.query('SELECT status, outcome, resolver_config, final_score FROM points_markets WHERE id = 1')).rows[0];
    assert.deepEqual(row, { status: 'resolved', outcome: 1, resolver_config: { original: true }, final_score: expected });
  }
  for (const [value, error] of [[42, 'invalid_final_score'], ['x'.repeat(241), 'final_score_too_long']]) {
    const response = await request({ marketId: 1, finalScore: value });
    assert.equal(response.code, 400);
    assert.equal(response.data.error, error);
  }
});
