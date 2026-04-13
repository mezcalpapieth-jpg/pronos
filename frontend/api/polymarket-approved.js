import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';
import { translateMarketToSpanish } from './_lib/polymarket-translation.js';

/**
 * Polymarket approval / rejection list with on-the-fly Spanish translation.
 *
 * Live Polymarket markets do NOT appear on the public site unless their slug
 * has an `approved` row in this table. Admins can also explicitly `reject` a
 * market so it disappears from the admin queue and never re-surfaces on the
 * next refresh of the live Gamma feed.
 *
 * GET    /api/polymarket-approved              → only approved (default)
 * GET    /api/polymarket-approved?status=all   → both approved + rejected
 * POST   /api/polymarket-approved              → admin: approve or reject
 *          body: { privyId, slug, eventSlug?, title, options, status?, autoTranslate? }
 *          status defaults to 'approved'. When status='rejected' translation
 *          is skipped (we don't need a Spanish title for hidden markets).
 * DELETE /api/polymarket-approved?slug=...     → admin: drop the row
 *
 * If `autoTranslate` is true (or omitted), the endpoint first tries to reuse
 * Polymarket's Spanish page copy, then falls back to Anthropic when configured.
 * If translation fails, we still insert the row so approval succeeds —
 * translation can be retried later via the admin backfill.
 */

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS' });
  if (cors) return cors;

  // ── GET ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const statusFilter = req.query.status || 'approved';
      if (statusFilter !== 'approved') {
        const admin = await requireAdmin(req, res, sql, req.query.privyId);
        if (!admin.ok) return;
      }
      const rows = statusFilter === 'all'
        ? await sql`
            SELECT slug, title_es, options_es, approved_at, approved_by, status
              FROM polymarket_approved
             ORDER BY approved_at DESC
          `
        : await sql`
            SELECT slug, title_es, options_es, approved_at, approved_by, status
              FROM polymarket_approved
             WHERE status = ${statusFilter}
             ORDER BY approved_at DESC
          `;
      return res.status(200).json({ approved: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { privyId, slug, eventSlug, title, options, autoTranslate, status } = req.body || {};
    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;
    if (!slug) return res.status(400).json({ error: 'slug requerido' });
    const decisionStatus = status === 'rejected' ? 'rejected' : 'approved';

    try {
      const reviewer = admin.username || 'admin';

      let titleEs = null;
      let optionsEs = null;
      // Translate only when approving — rejected rows never render publicly,
      // so spending external calls on them is wasted.
      if (decisionStatus === 'approved' && autoTranslate !== false && title) {
        const tr = await translateMarketToSpanish({ slug, eventSlug, title, options });
        if (tr) {
          titleEs = tr.titleEs;
          optionsEs = tr.optionsEs;
        }
      }

      const rows = await sql`
        INSERT INTO polymarket_approved (slug, title_es, options_es, approved_by, status)
        VALUES (${slug}, ${titleEs}, ${optionsEs ? JSON.stringify(optionsEs) : null}, ${reviewer}, ${decisionStatus})
        ON CONFLICT (slug) DO UPDATE
          SET title_es     = COALESCE(EXCLUDED.title_es, polymarket_approved.title_es),
              options_es   = COALESCE(EXCLUDED.options_es, polymarket_approved.options_es),
              approved_at  = NOW(),
              approved_by  = EXCLUDED.approved_by,
              status       = EXCLUDED.status
        RETURNING *
      `;
      return res.status(200).json({ ok: true, approved: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── DELETE ────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const slug = req.query.slug || (req.body && req.body.slug);
    const privyId = req.query.privyId || (req.body && req.body.privyId);
    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;
    if (!slug) return res.status(400).json({ error: 'slug requerido' });
    try {
      await sql`DELETE FROM polymarket_approved WHERE slug = ${slug}`;
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'GET, POST, or DELETE only' });
}
