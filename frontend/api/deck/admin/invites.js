import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureDeckSchema } from '../../_lib/deck-schema.js';
import { generateDeckCode, hashDeckCode, normalizeDeckCode, normalizeDeckEmail } from '../../_lib/deck-session.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

function cleanLabel(value) {
  return String(value || '').trim().slice(0, 120);
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;
    const admin = requirePointsAdmin(req, res);
    if (!admin) return;
    await ensureDeckSchema(sql);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, label, email_hint, active, created_by, created_at, revoked_at
        FROM deck_invites
        ORDER BY created_at DESC
        LIMIT 100
      `;
      return res.status(200).json({
        invites: rows.map(r => ({
          id: r.id,
          label: r.label,
          emailHint: r.email_hint,
          active: r.active && !r.revoked_at,
          createdBy: r.created_by,
          createdAt: r.created_at,
          revokedAt: r.revoked_at,
        })),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const action = req.body?.action || 'create';

    if (action === 'revoke') {
      const id = Number.parseInt(req.body?.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_invite_id' });
      const rows = await sql`
        UPDATE deck_invites
        SET active = false,
            revoked_at = COALESCE(revoked_at, NOW())
        WHERE id = ${id}
        RETURNING id, label, active, revoked_at
      `;
      if (!rows[0]) return res.status(404).json({ error: 'invite_not_found' });
      return res.status(200).json({ ok: true, invite: rows[0] });
    }

    const label = cleanLabel(req.body?.label);
    const emailHintRaw = normalizeDeckEmail(req.body?.emailHint);
    const emailHint = emailHintRaw || null;
    const suppliedCode = normalizeDeckCode(req.body?.code);
    const code = suppliedCode || generateDeckCode();
    if (!label) return res.status(400).json({ error: 'label_required' });
    if (emailHint && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailHint)) {
      return res.status(400).json({ error: 'invalid_email_hint' });
    }
    if (code.length < 6) return res.status(400).json({ error: 'code_too_short' });

    const rows = await sql`
      INSERT INTO deck_invites (code_hash, label, email_hint, created_by)
      VALUES (${hashDeckCode(code)}, ${label}, ${emailHint}, ${admin.username})
      RETURNING id, label, email_hint, active, created_by, created_at
    `;
    return res.status(200).json({
      ok: true,
      code,
      invite: {
        id: rows[0].id,
        label: rows[0].label,
        emailHint: rows[0].email_hint,
        active: rows[0].active,
        createdBy: rows[0].created_by,
        createdAt: rows[0].created_at,
      },
    });
  } catch (e) {
    const duplicate = e?.code === '23505';
    console.error('[deck/admin/invites] error', { message: e?.message, code: e?.code });
    return res.status(duplicate ? 409 : 500).json({
      error: duplicate ? 'invite_code_exists' : 'deck_invite_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
