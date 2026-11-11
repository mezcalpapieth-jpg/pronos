import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { FESTIVAL_JAR_EVENT, RIS26_JAR_EVENT } from '../../shared/jar-events.js';
import handler from '../ris26.js';

test('festival guesses and visitor state are isolated from the RIS round', async t => {
  const db = new PGlite();
  const originalFetch = neonConfig.fetchFunction;
  const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_READ_URL: process.env.DATABASE_READ_URL };
  const connection = 'postgresql://test:test@localhost/test';
  process.env.DATABASE_URL = connection;
  process.env.DATABASE_READ_URL = connection;
  neonConfig.fetchFunction = async (_url, { body }) => {
    const { query, params } = JSON.parse(body);
    const result = await db.query(query, params, { rowMode: 'array' });
    const rows = result.rows.map(row => row.map(value => {
      if (value === null) return null;
      return value instanceof Date ? value.toISOString() : String(value);
    }));
    return Response.json({ ...result, rows });
  };
  t.after(async () => {
    neonConfig.fetchFunction = originalFetch;
    for (const key of ['DATABASE_URL', 'DATABASE_READ_URL']) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await db.close();
  });

  async function request(method, { event, cookie, guess } = {}) {
    const req = { method, query: event === undefined ? {} : { event }, headers: { cookie }, body: { guess } };
    const headers = new Map();
    const res = {
      setHeader: (key, value) => headers.set(key, value),
      getHeader: key => headers.get(key),
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await handler(req, res);
    return { status: res.statusCode, body: res.payload, cookie: headers.get('Set-Cookie')?.split(';')[0] };
  }

  const original = await request('POST', { guess: 127 });
  assert.equal(original.status, 200);
  assert.ok(original.cookie.startsWith(RIS26_JAR_EVENT.cookieName + '='));

  const event = FESTIVAL_JAR_EVENT.key;
  const emptyFestival = await request('GET', { event, cookie: original.cookie });
  assert.equal(emptyFestival.status, 200);
  assert.equal(emptyFestival.body.event.key, event);
  assert.equal(emptyFestival.body.stats.total, 0);
  assert.equal(emptyFestival.body.ownGuess, null);

  const festival = await request('POST', { event, cookie: original.cookie, guess: 152 });
  assert.equal(festival.status, 200);
  assert.ok(festival.cookie.startsWith(FESTIVAL_JAR_EVENT.cookieName + '='));

  const bothCookies = [original.cookie, festival.cookie].join('; ');
  const update = await request('POST', { event, cookie: bothCookies, guess: 154 });
  assert.equal(update.status, 200);

  const oldRound = await request('GET', { cookie: bothCookies });
  assert.equal(oldRound.body.stats.total, 1);
  assert.equal(oldRound.body.ownGuess.guess, 127);
  const newRound = await request('GET', { event, cookie: bothCookies });
  assert.equal(newRound.body.stats.total, 1);
  assert.equal(newRound.body.ownGuess.guess, 154);
  assert.equal((await request('GET', { event: 'unknown' })).status, 400);
});
