/**
 * POST /api/investors/events
 *
 * Tracks visits to investor-only pages that are protected by the deck gate.
 * This is intentionally separate from slide analytics so the admin dashboard
 * can show deck reading time and dashboard viewing time side by side.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensureDeckSchema } from '../_lib/deck-schema.js';
import { readDeckSession } from '../_lib/deck-session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);
const EVENTS = new Set(['page_view', 'heartbeat', 'hidden', 'exit']);
const PAGES = new Set(['investor_dashboard']);

function cleanPageKey(value) {
  return PAGES.has(value) ? value : 'investor_dashboard';
}

function cleanDurationMs(value) {
  const duration = Number.parseInt(value, 10) || 0;
  return Math.max(0, Math.min(30 * 60_000, duration));
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const ipLimited = rateLimit(req, res, {
      key: `investor-events:${clientIp(req)}`,
      limit: 120,
      windowMs: 60_000,
    });
    if (ipLimited) return;

    await ensureDeckSchema(sql);
    const session = await readDeckSession(req, res, sql);
    if (!session) return res.status(401).json({ error: 'investor_session_required' });

    const sessionLimited = rateLimit(req, res, {
      key: `investor-events-session:${session.id}`,
      limit: 80,
      windowMs: 60_000,
    });
    if (sessionLimited) return;

    const eventType = EVENTS.has(req.body?.eventType) ? req.body.eventType : 'page_view';
    const pageKey = cleanPageKey(req.body?.pageKey);
    const durationMs = cleanDurationMs(req.body?.durationMs);

    await sql`
      INSERT INTO deck_page_events (
        session_id,
        invite_id,
        viewer_email,
        page_key,
        event_type,
        duration_ms
      )
      VALUES (
        ${session.id},
        ${session.invite_id},
        ${session.viewer_email},
        ${pageKey},
        ${eventType},
        ${durationMs}
      )
    `;
    await sql`
      UPDATE deck_sessions
      SET last_seen_at = NOW()
      WHERE id = ${session.id}
    `;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[investors/events] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'investor_event_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
