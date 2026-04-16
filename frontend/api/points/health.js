/**
 * GET /api/points/health
 *
 * Public diagnostic endpoint. Reports which env vars are present (NOT
 * their values) and the result of a simple database + schema probe.
 * Helps triage 500s on preview deploys without needing Vercel log
 * access — hit this URL in the browser to see which dependency is
 * misconfigured.
 *
 * Response is always 200 JSON (so the client never sees an unparseable
 * body). A non-empty `errors` array indicates a dependency problem.
 */
import { applyCors } from '../_lib/cors.js';

function has(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const env = {
      DATABASE_URL:                has('DATABASE_URL'),
      DATABASE_READ_URL:           has('DATABASE_READ_URL'),
      POINTS_SESSION_SECRET:       has('POINTS_SESSION_SECRET'),
      TURNKEY_ORGANIZATION_ID:     has('TURNKEY_ORGANIZATION_ID'),
      TURNKEY_API_PUBLIC_KEY:      has('TURNKEY_API_PUBLIC_KEY'),
      TURNKEY_API_PRIVATE_KEY:     has('TURNKEY_API_PRIVATE_KEY'),
      POINTS_ADMIN_USERNAMES:      has('POINTS_ADMIN_USERNAMES'),
      CRON_SECRET:                 has('CRON_SECRET'),
      VERCEL_ENV:                  process.env.VERCEL_ENV || null,
      VERCEL_GIT_COMMIT_SHA:       (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
    };

    const errors = [];
    const tests = {};

    // ── DB probe ─────────────────────────────────────────────────
    try {
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL);
      const r = await sql`SELECT 1 AS ok`;
      tests.db = r?.[0]?.ok === 1 ? 'ok' : 'unexpected';
    } catch (e) {
      tests.db = 'fail';
      errors.push({ step: 'db', message: e?.message?.slice(0, 200) || 'db_probe_failed' });
    }

    // ── Schema probe ─────────────────────────────────────────────
    try {
      const { neon } = await import('@neondatabase/serverless');
      const { ensurePointsSchema } = await import('../_lib/points-schema.js');
      const sql = neon(process.env.DATABASE_URL);
      await ensurePointsSchema(sql);
      tests.schema = 'ok';
    } catch (e) {
      tests.schema = 'fail';
      errors.push({ step: 'schema', message: e?.message?.slice(0, 200) || 'schema_failed' });
    }

    // ── Session-token probe ──────────────────────────────────────
    try {
      const { createSessionToken } = await import('../_lib/session.js');
      createSessionToken({ suborgId: 'probe', email: null, username: null });
      tests.sessionToken = 'ok';
    } catch (e) {
      tests.sessionToken = 'fail';
      errors.push({ step: 'sessionToken', message: e?.message?.slice(0, 200) || 'session_failed' });
    }

    // ── Turnkey config probe (no network call) ───────────────────
    try {
      const { isTurnkeyConfigured } = await import('../_lib/turnkey.js');
      tests.turnkey = isTurnkeyConfigured() ? 'ok' : 'missing_env';
      if (tests.turnkey === 'missing_env') {
        errors.push({ step: 'turnkey', message: 'TURNKEY_* env vars not fully set' });
      }
    } catch (e) {
      tests.turnkey = 'fail';
      errors.push({ step: 'turnkey', message: e?.message?.slice(0, 200) || 'turnkey_failed' });
    }

    return res.status(200).json({
      ok: errors.length === 0,
      env,
      tests,
      errors,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      fatal: e?.message?.slice(0, 200) || 'health_failed',
    });
  }
}
