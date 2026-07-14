import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensureDeckSchema } from '../_lib/deck-schema.js';
import {
  clearDeckSessionCookie,
  publicDeckSession,
  readDeckSession,
} from '../_lib/deck-session.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, DELETE, OPTIONS', credentials: true });
    if (cors) return cors;
    await ensureDeckSchema(sql);

    if (req.method === 'DELETE') {
      clearDeckSessionCookie(res);
      return res.status(200).json({ ok: true });
    }

    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
    const session = await readDeckSession(req, res, sql);
    if (!session) return res.status(401).json({ error: 'not_authenticated' });
    return res.status(200).json({ session: publicDeckSession(session) });
  } catch (e) {
    console.error('[deck/session] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'deck_session_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
