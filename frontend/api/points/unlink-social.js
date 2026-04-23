/**
 * POST /api/points/unlink-social
 *   body: { provider }
 *
 * Remove the user's verified social link. The MXNP reward already
 * credited is NOT clawed back — acknowledgement that the user did
 * link at one point. But re-linking later won't re-credit either,
 * because the original `points_social_links` row is deleted and a
 * fresh INSERT reset `reward_credited=false` → crediting would fire.
 *
 * To prevent that farming loop, we track "has this user ever been
 * rewarded for provider P" in points_distributions. On re-link the
 * callback checks that ledger and skips the credit if there's
 * already a matching distribution row.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_URL);

const ALLOWED_PROVIDERS = new Set(['x', 'instagram', 'tiktok']);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { provider } = req.body || {};
  if (!ALLOWED_PROVIDERS.has(provider)) {
    return res.status(400).json({ error: 'invalid_provider' });
  }

  try {
    await ensurePointsSchema(sql);
    const rows = await sql`
      DELETE FROM points_social_links
      WHERE username = ${session.username} AND provider = ${provider}
      RETURNING id
    `;
    return res.status(200).json({ ok: true, removed: rows.length });
  } catch (e) {
    console.error('[points/unlink-social] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'unlink_failed' });
  }
}
