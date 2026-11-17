import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { FESTIVAL_JAR_EVENT, RIS26_JAR_EVENT } from '../../shared/jar-events.js';
import handler from '../ris26.js';

test('festival guesses stay readable after the round closes while RIS still accepts votes', async t => {
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
  const festivalVisitor = '96bedb52-8c05-47cf-966d-ddda1ff13e51';
  const salt = process.env.RIS26_HASH_SALT || process.env.POINTS_SESSION_SECRET || 'ris26';
  const key = createHash('sha256').update(`${salt}:${festivalVisitor}`).digest('hex');
  await db.query('INSERT INTO ris26_guesses (event_key, visitor_key, guess) VALUES ($1, $2, $3)', [event, key, 152]);
  const bothCookies = `${original.cookie}; ${FESTIVAL_JAR_EVENT.cookieName}=${festivalVisitor}`;
  const newFestivalVote = await request('POST', { event, guess: 166 });
  assert.equal(newFestivalVote.status, 410);
  assert.equal(newFestivalVote.body.error, 'event_closed');
  assert.equal(newFestivalVote.cookie, undefined);
  assert.equal((await request('POST', { event, cookie: bothCookies, guess: 154 })).status, 410);

  const update = await request('POST', { cookie: bothCookies, guess: 129 });
  assert.equal(update.status, 200);

  const oldRound = await request('GET', { cookie: bothCookies });
  assert.equal(oldRound.body.stats.total, 1);
  assert.equal(oldRound.body.ownGuess.guess, 129);
  const festivalStats = await request('GET', { event, cookie: bothCookies });
  assert.equal(festivalStats.status, 200);
  assert.equal(festivalStats.body.event.key, event);
  assert.equal(festivalStats.body.stats.total, 1);
  assert.equal(festivalStats.body.ownGuess.guess, 152);
  const festivalWithOnlyRisCookie = await request('GET', { event, cookie: original.cookie });
  assert.equal(festivalWithOnlyRisCookie.body.ownGuess, null);
  assert.equal((await request('GET', { event: 'unknown' })).status, 400);
});
