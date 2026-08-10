/**
 * GET /api/points/social-links
 * POST /api/points/social-links
 *
 * Returns and updates the authenticated user's social links. OAuth
 * rows stay verified; manual rows let users add Instagram/TikTok
 * handles for public profile display while those providers wait for
 * production approval.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const writeSql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);
const PROVIDERS = new Set(['x', 'instagram', 'tiktok']);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);
    if (req.method === 'GET') return listLinks(req, res, session);
    if (req.method === 'POST') return saveLink(req, res, session);
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[points/social-links] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'social_links_failed' });
  }
}

function normalizeProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (provider === 'twitter') return 'x';
  return PROVIDERS.has(provider) ? provider : null;
}

function cleanHandle(value) {
  const handle = String(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com|instagram\.com|tiktok\.com)\/@?/i, '')
    .replace(/[/?#].*$/, '')
    .trim();
  if (!handle || handle.length > 80) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(handle)) return null;
  return handle;
}

function profileUrlFor(provider, handle) {
  const h = cleanHandle(handle);
  if (!h) return null;
  if (provider === 'instagram') return `https://www.instagram.com/${h}/`;
  if (provider === 'tiktok') return `https://www.tiktok.com/@${h}`;
  return `https://x.com/${h}`;
}

function serializeLink(row) {
  const source = String(row.source || 'oauth').trim().toLowerCase();
  return {
    provider: row.provider,
    providerUserId: row.provider_user_id,
    handle: row.handle,
    profileUrl: row.profile_url,
    rewardCredited: row.reward_credited,
    isPublic: Boolean(row.is_public),
    source,
    verified: source === 'oauth',
    linkedAt: row.linked_at,
    updatedAt: row.updated_at || row.linked_at,
  };
}

async function listLinks(req, res, session) {
  // OAuth callbacks and schema migrations write through DATABASE_URL. Keep
  // social-link reads on that same connection so new columns and fresh links
  // are visible immediately even if DATABASE_READ_URL points at a lagging
  // replica or older branch.
  const rows = await writeSql`
      SELECT provider, provider_user_id, handle, profile_url, reward_credited, linked_at
           , is_public, source, updated_at
      FROM points_social_links
      WHERE LOWER(username) = LOWER(${session.username})
      ORDER BY linked_at DESC
    `;
  return res.status(200).json({
    links: rows.map(serializeLink),
  });
}

async function saveLink(req, res, session) {
  const provider = normalizeProvider(req.body?.provider);
  if (!provider) return res.status(400).json({ error: 'invalid_provider' });

  const wantsPublic = Boolean(req.body?.isPublic ?? req.body?.public);
  const requestedHandle = cleanHandle(req.body?.handle);
  const existingRows = await writeSql`
    SELECT *
    FROM points_social_links
    WHERE LOWER(username) = LOWER(${session.username})
      AND provider = ${provider}
    LIMIT 1
  `;
  const existing = existingRows[0] || null;
  const existingSource = String(existing?.source || 'oauth').trim().toLowerCase();
  const canEditHandle = !existing || existingSource === 'manual';
  const nextHandle = canEditHandle ? requestedHandle : cleanHandle(existing.handle);
  if (!nextHandle) return res.status(400).json({ error: 'invalid_handle' });

  if (existing) {
    const updated = await writeSql`
      UPDATE points_social_links
         SET handle = ${canEditHandle ? nextHandle : existing.handle},
             profile_url = ${canEditHandle ? profileUrlFor(provider, nextHandle) : existing.profile_url},
             is_public = ${wantsPublic},
             updated_at = NOW()
       WHERE id = ${existing.id}
       RETURNING provider, provider_user_id, handle, profile_url, reward_credited, linked_at,
                 is_public, source, updated_at
    `;
    return res.status(200).json({ link: serializeLink(updated[0]) });
  }

  const username = String(session.username || '').trim().toLowerCase();
  const inserted = await writeSql`
    INSERT INTO points_social_links
      (username, provider, provider_user_id, handle, profile_url, is_public, source, linked_at, updated_at)
    VALUES
      (${username}, ${provider}, ${`manual:${username}:${provider}`}, ${nextHandle},
       ${profileUrlFor(provider, nextHandle)}, ${wantsPublic}, 'manual', NOW(), NOW())
    RETURNING provider, provider_user_id, handle, profile_url, reward_credited, linked_at,
              is_public, source, updated_at
  `;
  return res.status(200).json({ link: serializeLink(inserted[0]) });
}
