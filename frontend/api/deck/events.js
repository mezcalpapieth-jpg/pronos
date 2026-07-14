import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensureDeckSchema } from '../_lib/deck-schema.js';
import { readDeckSession } from '../_lib/deck-session.js';

const sql = neon(process.env.DATABASE_URL);
const EVENTS = new Set(['slide_view', 'heartbeat', 'hidden', 'exit']);

function cleanLanguage(value) {
  return value === 'es' ? 'es' : 'en';
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    await ensureDeckSchema(sql);

    const session = await readDeckSession(req, res, sql);
    if (!session) return res.status(401).json({ error: 'not_authenticated' });

    const slideNumber = Number.parseInt(req.body?.slideNumber, 10);
    const durationMs = Math.max(0, Math.min(30 * 60_000, Number.parseInt(req.body?.durationMs, 10) || 0));
    const eventType = EVENTS.has(req.body?.eventType) ? req.body.eventType : 'slide_view';
    const language = cleanLanguage(req.body?.language || session.deck_language);

    if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > 200) {
      return res.status(400).json({ error: 'invalid_slide' });
    }

    await sql`
      INSERT INTO deck_slide_events (
        session_id,
        invite_id,
        viewer_email,
        deck_language,
        slide_number,
        event_type,
        duration_ms
      )
      VALUES (
        ${session.id},
        ${session.invite_id},
        ${session.viewer_email},
        ${language},
        ${slideNumber},
        ${eventType},
        ${durationMs}
      )
    `;
    await sql`
      UPDATE deck_sessions
      SET last_seen_at = NOW(),
          deck_language = ${language}
      WHERE id = ${session.id}
    `;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[deck/events] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'deck_event_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
