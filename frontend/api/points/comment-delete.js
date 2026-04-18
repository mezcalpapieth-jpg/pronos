/**
 * POST /api/points/comment-delete
 * Body: { commentId }
 *
 * Soft-delete one of your own comments (sets deleted_at). Kept on a
 * flat path instead of /comments/delete because Vercel's filesystem
 * routing treats `comments/` as a directory that would shadow the
 * sibling `comments.js` file (same pattern reason as price-history).
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const limited = rateLimit(req, res, {
      key: `comment-delete:${clientIp(req)}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (limited) return;

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.username) return res.status(400).json({ error: 'username_required' });

    const { commentId } = req.body || {};
    const cid = parseInt(commentId, 10);
    if (!Number.isInteger(cid) || cid <= 0) {
      return res.status(400).json({ error: 'invalid_comment_id' });
    }

    await ensurePointsSchema(schemaSql);

    const rows = await schemaSql`
      UPDATE points_comments
      SET deleted_at = NOW()
      WHERE id = ${cid}
        AND username = ${session.username}
        AND deleted_at IS NULL
      RETURNING id
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'comment_not_found_or_not_owner' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[points/comment-delete] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'delete_failed' });
  }
}
