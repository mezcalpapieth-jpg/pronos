/**
 * GET /api/points/social-links
 *
 * Returns the authenticated user's verified social links. Used by the
 * /earn page to render the "Conectar cuentas" section — each entry
 * shows as linked (with handle + Desconectar button) or unlinked
 * (with the appropriate Conectar button).
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT provider, provider_user_id, handle, profile_url, reward_credited, linked_at
      FROM points_social_links
      WHERE username = ${session.username}
      ORDER BY linked_at DESC
    `;
    return res.status(200).json({
      links: rows.map(r => ({
        provider: r.provider,
        providerUserId: r.provider_user_id,
        handle: r.handle,
        profileUrl: r.profile_url,
        rewardCredited: r.reward_credited,
        linkedAt: r.linked_at,
      })),
    });
  } catch (e) {
    console.error('[points/social-links] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'social_links_failed' });
  }
}
