import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { ensureInterestSchema } from './_lib/interest-schema.js';
import { clientIp, rateLimit } from './_lib/rate-limit.js';
import {
  INTEREST_DAILY_SIGNAL_CAP,
  INTEREST_GUARD_ACTION,
  INTEREST_SIGNAL_ACTION,
  buildInterestVisitorKeys,
  hashInterestVisitorKey,
  interestGuardActionForSlot,
  interestSignalActionForSlot,
  normalizeInterestPayload,
} from './_lib/interest.js';

const COOKIE_NAME = 'pronos_interest_id';
const COOKIE_TTL_SECONDS = 60 * 60 * 24 * 365;
const sql = neon(process.env.DATABASE_URL);
const INTEREST_POST_RATE_LIMIT = 120;
const INTEREST_POST_RATE_WINDOW_MS = 60_000;

function parseCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function setInterestCookie(req, res, value) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.VERCEL_ENV;
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${COOKIE_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');

  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing) ? [...existing, parts.join('; ')] : existing ? [existing, parts.join('; ')] : parts.join('; ');
  res.setHeader('Set-Cookie', next);
}

function visitorKeys(req, res, body = {}) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const keys = buildInterestVisitorKeys({
    bodyClientId: body.clientId,
    cookieClientId: cookies[COOKIE_NAME],
    generatedClientId: crypto.randomUUID(),
    ip: clientIp(req),
    userAgent: req.headers?.['user-agent'],
  });
  if (cookies[COOKIE_NAME] !== keys.cookieClientId) setInterestCookie(req, res, keys.cookieClientId);
  return {
    primary: hashInterestVisitorKey(keys.primaryKey),
    guard: hashInterestVisitorKey(keys.guardKey),
  };
}

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ip = clientIp(req);
  const limited = rateLimit(req, res, {
    key: `interest:${ip}`,
    limit: INTEREST_POST_RATE_LIMIT,
    windowMs: INTEREST_POST_RATE_WINDOW_MS,
  });
  if (limited) return;

  const body = requestBody(req);
  let payload;
  try {
    payload = normalizeInterestPayload(body);
  } catch (e) {
    return res.status(400).json({ error: e?.message || 'invalid_payload' });
  }

  try {
    await ensureInterestSchema(sql);
    const vKeys = visitorKeys(req, res, body);
    const existingSignalRows = await sql`
      SELECT
        COUNT(*) FILTER (
          WHERE visitor_key = ${vKeys.primary}
            AND action LIKE ${`${INTEREST_SIGNAL_ACTION}%`}
        )::int AS primary_c,
        COUNT(*) FILTER (
          WHERE visitor_key = ${vKeys.guard}
            AND action LIKE ${`${INTEREST_GUARD_ACTION}%`}
        )::int AS guard_c
      FROM interest_daily_visitors
      WHERE surface = ${payload.surface}
        AND object_type = ${payload.objectType}
        AND object_id = ${payload.objectId}
        AND day = CURRENT_DATE
        AND (
          (visitor_key = ${vKeys.primary} AND action LIKE ${`${INTEREST_SIGNAL_ACTION}%`})
          OR
          (visitor_key = ${vKeys.guard} AND action LIKE ${`${INTEREST_GUARD_ACTION}%`})
        )
    `;
    const existingPrimarySignals = Number(existingSignalRows?.[0]?.primary_c || 0);
    const existingGuardSignals = Number(existingSignalRows?.[0]?.guard_c || 0);
    if (Math.max(existingPrimarySignals, existingGuardSignals) >= INTEREST_DAILY_SIGNAL_CAP) {
      return res.status(200).json({ ok: true, unique: false, capped: true });
    }

    const signalRows = await sql`
      INSERT INTO interest_daily_visitors (
        visitor_key, surface, object_type, object_id, action, day
      ) VALUES (
        ${vKeys.primary}, ${payload.surface}, ${payload.objectType}, ${payload.objectId}, ${interestSignalActionForSlot(existingPrimarySignals + 1)}, CURRENT_DATE
      )
      ON CONFLICT DO NOTHING
      RETURNING 1
    `;
    await sql`
      INSERT INTO interest_daily_visitors (
        visitor_key, surface, object_type, object_id, action, day
      ) VALUES (
        ${vKeys.guard}, ${payload.surface}, ${payload.objectType}, ${payload.objectId}, ${interestGuardActionForSlot(existingGuardSignals + 1)}, CURRENT_DATE
      )
      ON CONFLICT DO NOTHING
    `;
    const signalInc = signalRows.length > 0 ? 1 : 0;
    if (!signalInc) return res.status(200).json({ ok: true, unique: false });

    await sql`
      INSERT INTO interest_daily_counts (
        surface, object_type, object_id, action, day, count, unique_count, metadata, first_seen_at, last_seen_at
      ) VALUES (
        ${payload.surface}, ${payload.objectType}, ${payload.objectId}, ${payload.action}, CURRENT_DATE,
        1, ${signalInc}, ${JSON.stringify(payload.metadata)}::jsonb, NOW(), NOW()
      )
      ON CONFLICT (surface, object_type, object_id, action, day)
      DO UPDATE SET
        count = interest_daily_counts.count + 1,
        unique_count = interest_daily_counts.unique_count + 1,
        metadata = interest_daily_counts.metadata || EXCLUDED.metadata,
        last_seen_at = NOW()
    `;

    return res.status(200).json({ ok: true, unique: signalInc > 0, capped: false });
  } catch (e) {
    console.error('[interest] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'interest_failed' });
  }
}
