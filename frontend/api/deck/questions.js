import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensureDeckSchema } from '../_lib/deck-schema.js';
import { readDeckSession } from '../_lib/deck-session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

function cleanLanguage(value) {
  return value === 'es' ? 'es' : 'en';
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const limited = rateLimit(req, res, {
      key: `deck-question:${clientIp(req)}`,
      limit: 10,
      windowMs: 60_000,
    });
    if (limited) return;

    await ensureDeckSchema(sql);
    const session = await readDeckSession(req, res, sql);
    if (!session) return res.status(401).json({ error: 'not_authenticated' });

    const question = String(req.body?.question || '').trim();
    const slideNumber = Number.parseInt(req.body?.slideNumber, 10);
    const language = cleanLanguage(req.body?.language || session.deck_language);
    if (question.length < 3) return res.status(400).json({ error: 'question_empty' });
    if (question.length > 1200) return res.status(400).json({ error: 'question_too_long' });

    const rows = await sql`
      INSERT INTO deck_questions (
        session_id,
        invite_id,
        viewer_email,
        deck_language,
        slide_number,
        question
      )
      VALUES (
        ${session.id},
        ${session.invite_id},
        ${session.viewer_email},
        ${language},
        ${Number.isInteger(slideNumber) ? slideNumber : null},
        ${question}
      )
      RETURNING id, created_at
    `;

    return res.status(200).json({ ok: true, question: { id: rows[0].id, createdAt: rows[0].created_at } });
  } catch (e) {
    console.error('[deck/questions] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'deck_question_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
