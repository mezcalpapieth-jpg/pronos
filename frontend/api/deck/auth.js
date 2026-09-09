import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensureDeckSchema } from '../_lib/deck-schema.js';
import {
  hashDeckCode,
  hashDeckIp,
  newDeckSessionId,
  normalizeDeckCode,
  normalizeDeckEmail,
  publicDeckSession,
  setDeckSessionCookie,
} from '../_lib/deck-session.js';
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
      key: `deck-auth:${clientIp(req)}`,
      limit: 12,
      windowMs: 10 * 60_000,
    });
    if (limited) return;

    const email = normalizeDeckEmail(req.body?.email);
    const code = normalizeDeckCode(req.body?.code);
    const language = cleanLanguage(req.body?.language);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (code.length < 4) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const emailLimited = rateLimit(req, res, {
      key: `deck-auth-email:${email}`,
      limit: 12,
      windowMs: 10 * 60_000,
    });
    if (emailLimited) return;

    const codeHash = hashDeckCode(code);
    const codeLimited = rateLimit(req, res, {
      key: `deck-auth-code:${codeHash.slice(0, 24)}`,
      limit: 20,
      windowMs: 10 * 60_000,
    });
    if (codeLimited) return;

    await ensureDeckSchema(sql);

    const inviteRows = await sql`
      SELECT id, label, email_hint
      FROM deck_invites
      WHERE code_hash = ${codeHash}
        AND active = true
        AND revoked_at IS NULL
      LIMIT 1
    `;
    const invite = inviteRows[0];
    if (!invite) return res.status(401).json({ error: 'invalid_invite' });

    const sessionId = newDeckSessionId();
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 500);
    const rows = await sql`
      INSERT INTO deck_sessions (
        id,
        invite_id,
        viewer_email,
        deck_language,
        user_agent,
        ip_hash
      )
      VALUES (
        ${sessionId},
        ${invite.id},
        ${email},
        ${language},
        ${userAgent},
        ${hashDeckIp(req)}
      )
      RETURNING
        id,
        invite_id,
        viewer_email,
        deck_language,
        started_at,
        last_seen_at
    `;

    setDeckSessionCookie(res, sessionId);
    return res.status(200).json({
      ok: true,
      session: publicDeckSession({
        ...rows[0],
        invite_label: invite.label,
        invite_email_hint: invite.email_hint,
      }),
      emailMatchesInvite: !invite.email_hint || invite.email_hint.toLowerCase() === email,
    });
  } catch (e) {
    console.error('[deck/auth] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'deck_auth_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
