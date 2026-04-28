/**
 * Per-market comments endpoint.
 *
 * GET  /api/points/comments?marketId=X&limit=50  — list live comments
 * POST /api/points/comments                      — create (auth)
 *     body: { marketId, body }
 * POST /api/points/comments/delete               — soft-delete own comment
 *     body: { commentId }
 *
 * Soft-deletes set `deleted_at`; GET filters them out. Authors can hide
 * their own comments; no edit endpoint (deleting + reposting is fine for
 * the MVP). Rate-limited per IP to keep the spam floor reasonable.
 *
 * ────────────────────────────────────────────────────────────────────
 * XSS / output-safety contract:
 *
 * Comment bodies are stored exactly as the user submitted them, with no
 * server-side HTML escape. The XSS contract is: every consumer of this
 * endpoint MUST render bodies as text, never as HTML. The current React
 * components (`MarketComments.jsx`) do this correctly via JSX text nodes.
 *
 * If you ever add a new consumer (notifications email, RSS feed, OG
 * preview card, server-rendered HTML page, etc.) — escape on the way
 * out. Do NOT bake escaping into this endpoint, because then every
 * client would need to un-escape, and one client missing the un-escape
 * would render `&lt;` literally for users.
 * ────────────────────────────────────────────────────────────────────
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

const MAX_BODY = 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;

    if (req.method === 'GET')  return listComments(req, res);
    if (req.method === 'POST') return createComment(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[points/comments] unhandled', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'server_error', detail: e?.message?.slice(0, 240) || null });
  }
}

async function listComments(req, res) {
  const mid = parseInt(req.query.marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

  const sql = getSql();
  await ensurePointsSchema(getSchemaSql());

  const rows = await sql`
    SELECT id, market_id, username, body, created_at
    FROM points_comments
    WHERE market_id = ${mid} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;

  return res.status(200).json({
    comments: rows.map(r => ({
      id: r.id,
      marketId: r.market_id,
      username: r.username,
      body: r.body,
      createdAt: r.created_at,
    })),
  });
}

async function createComment(req, res) {
  const limited = rateLimit(req, res, {
    key: `comments:${clientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, body } = req.body || {};
  const mid = parseInt(marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }

  const trimmed = typeof body === 'string' ? body.trim() : '';
  if (trimmed.length === 0) return res.status(400).json({ error: 'body_empty' });
  if (trimmed.length > MAX_BODY) return res.status(400).json({ error: 'body_too_long' });

  const sql = getSql();
  const schemaSql = getSchemaSql();
  await ensurePointsSchema(schemaSql);

  // Ensure the market exists. Cheap check — catches typos and deleted
  // markets before we drop a comment into a hanging reference.
  const mRows = await sql`SELECT id FROM points_markets WHERE id = ${mid} LIMIT 1`;
  if (mRows.length === 0) return res.status(404).json({ error: 'market_not_found' });

  const rows = await schemaSql`
    INSERT INTO points_comments (market_id, username, body)
    VALUES (${mid}, ${session.username}, ${trimmed})
    RETURNING id, market_id, username, body, created_at
  `;
  const r = rows[0];
  return res.status(200).json({
    ok: true,
    comment: {
      id: r.id,
      marketId: r.market_id,
      username: r.username,
      body: r.body,
      createdAt: r.created_at,
    },
  });
}
