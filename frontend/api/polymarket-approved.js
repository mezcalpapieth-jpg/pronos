import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';

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
 *          body: { privyId, slug, title, options, status?, autoTranslate? }
 *          status defaults to 'approved'. When status='rejected' translation
 *          is skipped (we don't need a Spanish title for hidden markets).
 * DELETE /api/polymarket-approved?slug=...     → admin: drop the row
 *
 * If `autoTranslate` is true (or omitted) and ANTHROPIC_API_KEY is set, the
 * endpoint translates `title` and `options[].label` to Spanish before storing.
 * If translation fails, we still insert the row with the originals so the
 * approval succeeds — translation can be retried later via re-approval.
 */

const sql = neon(process.env.DATABASE_URL);

// ── Anthropic translation ──────────────────────────────────────────────────
// Translates a market title + option labels in a single API call. Returns
// `{ titleEs, optionsEs }` or null if the API key isn't set / call fails.
async function translateToSpanish({ title, options }) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const safeOptions = Array.isArray(options) ? options : [];
  const labels = safeOptions.map(o => o?.label || '').filter(Boolean);

  const prompt = `Translate this Polymarket prediction market question and its outcome labels to natural, conversational Spanish (Mexican Spanish preferred). Preserve names of people, teams, and places — only translate the surrounding text. Keep the question concise.

Question: ${title}
Options: ${JSON.stringify(labels)}

Respond with ONLY valid JSON in this exact format (no markdown, no commentary):
{"title": "<spanish question>", "options": ["<opt1>", "<opt2>", ...]}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!parsed.title || !Array.isArray(parsed.options)) return null;

    // Re-attach pct/etc. by zipping translated labels back over original options.
    const optionsEs = safeOptions.map((opt, i) => ({
      ...opt,
      label: parsed.options[i] || opt.label,
    }));
    return { titleEs: parsed.title, optionsEs };
  } catch (e) {
    return null;
  }
}

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
    const { privyId, slug, title, options, autoTranslate, status } = req.body || {};
    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;
    if (!slug) return res.status(400).json({ error: 'slug requerido' });
    const decisionStatus = status === 'rejected' ? 'rejected' : 'approved';

    try {
      const reviewer = admin.username || 'admin';

      let titleEs = null;
      let optionsEs = null;
      // Translate only when approving — rejected rows never render publicly,
      // so spending an Anthropic call on them is wasted.
      if (decisionStatus === 'approved' && autoTranslate !== false && title) {
        const tr = await translateToSpanish({ title, options });
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
