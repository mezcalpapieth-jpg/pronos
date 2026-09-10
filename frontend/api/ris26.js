import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { clientIp, rateLimit } from './_lib/rate-limit.js';

const EVENT_KEY = 'ris26';
const COOKIE_NAME = 'pronos_ris26_player';
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_GUESS = 1;
const MAX_GUESS = 10000;

let readSqlClient = null;
let writeSqlClient = null;
let schemaPromise = null;

function getReadSql() {
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  if (!readSqlClient) readSqlClient = neon(cs);
  return readSqlClient;
}

function getWriteSql() {
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  if (!writeSqlClient) writeSqlClient = neon(cs);
  return writeSqlClient;
}

function parseCookieHeader(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  if (!existing) return res.setHeader('Set-Cookie', cookie);
  if (Array.isArray(existing)) return res.setHeader('Set-Cookie', [...existing, cookie]);
  return res.setHeader('Set-Cookie', [existing, cookie]);
}

function setVisitorCookie(req, res, visitorId) {
  const secure = req.headers['x-forwarded-proto'] === 'https'
    || process.env.VERCEL === '1'
    || process.env.VERCEL_ENV;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(visitorId)}`,
    'Path=/',
    `Max-Age=${COOKIE_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  appendSetCookie(res, parts.join('; '));
}

function visitorIdForRequest(req, res) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const existing = String(cookies[COOKIE_NAME] || '').trim();
  if (/^[a-f0-9-]{20,80}$/i.test(existing)) return existing;
  const generated = crypto.randomUUID();
  setVisitorCookie(req, res, generated);
  return generated;
}

function hashValue(value) {
  const salt = process.env.RIS26_HASH_SALT || process.env.POINTS_SESSION_SECRET || 'ris26';
  return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

function cleanDisplayName(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!value) return null;
  return value.slice(0, 40);
}

function normalizeGuess(raw) {
  const guess = Number(raw);
  if (!Number.isInteger(guess) || guess < MIN_GUESS || guess > MAX_GUESS) {
    const err = new Error('invalid_guess');
    err.status = 400;
    throw err;
  }
  return guess;
}

async function ensureRis26Schema() {
  if (schemaPromise) return schemaPromise;
  const sql = getWriteSql();
  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS ris26_guesses (
        id BIGSERIAL PRIMARY KEY,
        event_key TEXT NOT NULL DEFAULT 'ris26',
        visitor_key TEXT NOT NULL,
        display_name TEXT,
        guess INTEGER NOT NULL CHECK (guess BETWEEN 1 AND 10000),
        ip_hash TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ris26_guesses_event_visitor_idx
      ON ris26_guesses (event_key, visitor_key)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS ris26_guesses_event_updated_idx
      ON ris26_guesses (event_key, updated_at DESC)
    `;
  })();
  return schemaPromise;
}

async function readStats(req, res) {
  await ensureRis26Schema();
  const sql = getReadSql();
  const cookies = parseCookieHeader(req.headers?.cookie);
  const visitorId = String(cookies[COOKIE_NAME] || '').trim();
  const visitorKey = visitorId ? hashValue(visitorId) : null;

  const [summaryRows, distributionRows, recentRows, ownRows] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS total,
        ROUND(AVG(guess)::numeric, 1)::float AS mean,
        MIN(guess)::int AS min,
        MAX(guess)::int AS max,
        MAX(updated_at) AS updated_at
      FROM ris26_guesses
      WHERE event_key = ${EVENT_KEY}
    `,
    sql`
      SELECT guess AS value, COUNT(*)::int AS count
      FROM ris26_guesses
      WHERE event_key = ${EVENT_KEY}
      GROUP BY guess
      ORDER BY guess ASC
      LIMIT 300
    `,
    sql`
      SELECT display_name, guess, updated_at
      FROM ris26_guesses
      WHERE event_key = ${EVENT_KEY}
      ORDER BY updated_at DESC
      LIMIT 8
    `,
    visitorKey
      ? sql`
          SELECT guess, display_name, updated_at
          FROM ris26_guesses
          WHERE event_key = ${EVENT_KEY}
            AND visitor_key = ${visitorKey}
          LIMIT 1
        `
      : Promise.resolve([]),
  ]);

  const summary = summaryRows?.[0] || {};
  const total = Number(summary.total || 0);
  const distribution = (distributionRows || []).map(row => ({
    value: Number(row.value),
    count: Number(row.count || 0),
    pct: total > 0 ? Number(((Number(row.count || 0) / total) * 100).toFixed(1)) : 0,
  }));

  return res.status(200).json({
    ok: true,
    event: {
      key: EVENT_KEY,
      title: 'RIS 26',
      question: '¿Cuántas pelotas hay en el frasco?',
    },
    stats: {
      total,
      mean: total > 0 && Number.isFinite(Number(summary.mean)) ? Number(summary.mean) : null,
      min: total > 0 ? Number(summary.min) : null,
      max: total > 0 ? Number(summary.max) : null,
      updatedAt: summary.updated_at || null,
    },
    distribution,
    recent: (recentRows || []).map(row => ({
      displayName: row.display_name || null,
      guess: Number(row.guess),
      updatedAt: row.updated_at || null,
    })),
    ownGuess: ownRows?.[0]
      ? {
          guess: Number(ownRows[0].guess),
          displayName: ownRows[0].display_name || null,
          updatedAt: ownRows[0].updated_at || null,
        }
      : null,
  });
}

async function submitGuess(req, res) {
  const limited = rateLimit(req, res, {
    key: `ris26:post:${clientIp(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return;

  const body = requestBody(req);
  let guess;
  try {
    guess = normalizeGuess(body.guess);
  } catch (e) {
    return res.status(e.status || 400).json({ error: 'invalid_guess' });
  }

  await ensureRis26Schema();
  const sql = getWriteSql();
  const visitorId = visitorIdForRequest(req, res);
  const visitorKey = hashValue(visitorId);
  const ipHash = hashValue(clientIp(req));
  const displayName = cleanDisplayName(body.displayName);
  const userAgent = String(req.headers?.['user-agent'] || '').slice(0, 240);

  const rows = await sql`
    INSERT INTO ris26_guesses (
      event_key, visitor_key, display_name, guess, ip_hash, user_agent
    ) VALUES (
      ${EVENT_KEY}, ${visitorKey}, ${displayName}, ${guess}, ${ipHash}, ${userAgent}
    )
    ON CONFLICT (event_key, visitor_key)
    DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, ris26_guesses.display_name),
      guess = EXCLUDED.guess,
      ip_hash = EXCLUDED.ip_hash,
      user_agent = EXCLUDED.user_agent,
      updated_at = NOW()
    RETURNING guess, display_name, updated_at
  `;

  return res.status(200).json({
    ok: true,
    guess: {
      guess: Number(rows?.[0]?.guess ?? guess),
      displayName: rows?.[0]?.display_name || null,
      updatedAt: rows?.[0]?.updated_at || null,
    },
  });
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  if (req.method === 'GET') {
    const limited = rateLimit(req, res, {
      key: `ris26:get:${clientIp(req)}`,
      limit: 240,
      windowMs: 60_000,
    });
    if (limited) return;
  }

  try {
    if (req.method === 'GET') return await readStats(req, res);
    if (req.method === 'POST') return await submitGuess(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[ris26] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'ris26_failed' });
  }
}
