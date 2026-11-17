/**
 * Public, plaintext comments and replies. Any API consumer must render bodies
 * as text. Responses with viewer-specific like state are never cached.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { readSession, requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import {
  commentId,
  insertMarketComment,
  listMarketComments,
  setMarketCommentLike,
} from '../_lib/points-comments.js';

let schemaSql;
function writeSql() {
  schemaSql ??= neon(process.env.DATABASE_URL);
  return schemaSql;
}

const MAX_BODY = 1000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export default async function handler(req, res) {
  try {
    if (applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true })) return;
    res.setHeader('Cache-Control', 'private, no-store');

    if (req.method === 'GET') return await listComments(req, res);
    if (req.method === 'POST') return await writeComment(req, res);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (error) {
    console.error('[points/comments] unhandled', { message: error?.message, code: error?.code });
    return res.status(500).json({ error: 'server_error' });
  }
}

async function listComments(req, res) {
  const marketId = commentId(req.query.marketId);
  const parentId = commentId(req.query.parentId);
  const afterId = commentId(req.query.afterId);
  if (!marketId) return res.status(400).json({ error: 'invalid_market_id' });
  if (req.query.parentId != null && !parentId) return res.status(400).json({ error: 'invalid_parent_id' });
  if (req.query.afterId != null && (!afterId || !parentId)) return res.status(400).json({ error: 'invalid_after_id' });
  if (rateLimit(req, res, { key: `comments-read:${clientIp(req)}`, limit: 180, windowMs: 60_000 })) return;

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  const session = readSession(req, res);
  const sql = writeSql();
  await ensurePointsSchema(sql);
  const data = await listMarketComments(sql, { marketId, parentId, afterId, limit, viewerSub: session?.sub ?? null });
  return res.status(200).json(data);
}

async function writeComment(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const payload = req.body || {};
  const isLike = payload.action === 'like';
  const key = isLike ? 'comment-likes' : 'comments';
  if (rateLimit(req, res, { key: `${key}:${clientIp(req)}`, limit: isLike ? 60 : 10, windowMs: 60_000 })) return;

  if (isLike) {
    const id = commentId(payload.commentId);
    if (!id || typeof payload.liked !== 'boolean') return res.status(400).json({ error: 'invalid_comment_like' });
    const sql = writeSql();
    await ensurePointsSchema(sql);
    const liked = await setMarketCommentLike(sql, { id, viewerSub: session.sub, liked: payload.liked });
    if (liked === null) return res.status(404).json({ error: 'comment_not_found' });
    return res.status(200).json({ ok: true, liked });
  }

  const marketId = commentId(payload.marketId);
  const parentId = commentId(payload.parentId);
  if (!marketId) return res.status(400).json({ error: 'invalid_market_id' });
  if (payload.parentId != null && !parentId) return res.status(400).json({ error: 'invalid_parent_id' });
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) return res.status(400).json({ error: 'body_empty' });
  if (body.length > MAX_BODY) return res.status(400).json({ error: 'body_too_long' });

  const sql = writeSql();
  await ensurePointsSchema(sql);
  const comment = await insertMarketComment(sql, { marketId, parentId, username: session.username, body });
  if (!comment) return res.status(404).json({ error: parentId ? 'comment_not_found' : 'market_not_found' });
  return res.status(200).json({ ok: true, comment });
}
