/**
 * POST /api/points/profile
 *
 * Authenticated profile personalization for the points app. This keeps
 * identity lightweight for now: users can set a public display name and
 * a public image URL without adding file storage or upload moderation.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

const MAX_DISPLAY_NAME_LENGTH = 60;
const MAX_PROFILE_IMAGE_URL_LENGTH = 800;

function cleanOptionalText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length > maxLength) return { error: 'too_long' };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { error: 'control_chars' };
  return text;
}

function cleanProfileImageUrl(value) {
  const text = cleanOptionalText(value, MAX_PROFILE_IMAGE_URL_LENGTH);
  if (text == null || typeof text === 'string') {
    if (text == null) return null;
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid_url' };
      return url.href;
    } catch {
      return { error: 'invalid_url' };
    }
  }
  return text;
}

function serializeProfile(row) {
  return {
    username: row.username,
    email: row.email || null,
    displayName: row.display_name || null,
    profileImageUrl: row.profile_image_url || null,
    profileUpdatedAt: row.profile_updated_at || null,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;

  const displayName = cleanOptionalText(req.body?.displayName, MAX_DISPLAY_NAME_LENGTH);
  if (displayName && typeof displayName === 'object') {
    return res.status(400).json({ error: 'invalid_display_name' });
  }

  const profileImageUrl = cleanProfileImageUrl(req.body?.profileImageUrl);
  if (profileImageUrl && typeof profileImageUrl === 'object') {
    return res.status(400).json({ error: 'invalid_profile_image_url' });
  }

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      UPDATE points_users
         SET display_name = ${displayName},
             profile_image_url = ${profileImageUrl},
             profile_updated_at = NOW()
       WHERE turnkey_sub_org_id = ${session.sub}
       RETURNING username, email, display_name, profile_image_url, profile_updated_at
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'user_not_found' });
    return res.status(200).json({ ok: true, profile: serializeProfile(rows[0]) });
  } catch (e) {
    console.error('[points/profile] update failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'profile_update_failed' });
  }
}
