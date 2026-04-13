import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';
import { translateMarketToSpanish } from './_lib/polymarket-translation.js';

/**
 * Bulk Spanish translation for live Polymarket markets.
 *
 * The admin page calls this on load with every relevant Polymarket market it
 * just fetched. New slugs are translated using Polymarket's Spanish page
 * copy first, then Anthropic as fallback when configured. Approved/pending
 * rows that already exist but are missing Spanish text are backfilled. This means:
 *   - The admin sees both EN (Polymarket original) and ES (cached) for
 *     every market without having to click anything.
 *   - When the admin later clicks Aprobar, the server already has the
 *     translation cached so the approve call is essentially free.
 *   - Pending rows are NOT visible on the public site (the public GET
 *     filters by status='approved' only).
 *
 * POST /api/polymarket-translate
 *   body: { privyId, markets: [{ slug, eventSlug?, title, options }] }
 *
 * Returns: { ok, translated, cached, remaining, rows }
 *
 * The endpoint caps each call at 20 translations to fit inside the Vercel
 * serverless timeout. The frontend drains the queue by calling repeatedly
 * until `remaining` reaches 0 (or until a safety cap is hit).
 */

const sql = neon(process.env.DATABASE_URL);

function hasSpanishOptions(row) {
  if (Array.isArray(row?.options_es)) return row.options_es.length > 0;
  if (typeof row?.options_es === 'string') return row.options_es.trim() && row.options_es !== 'null';
  return !!row?.options_es;
}

function needsTranslation(row) {
  if (!row) return true;
  if (row.status === 'rejected') return false;
  return !row.title_es || !hasSpanishOptions(row);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { privyId, markets } = req.body || {};
  const admin = await requireAdmin(req, res, sql, privyId);
  if (!admin.ok) return;
  if (!Array.isArray(markets)) {
    return res.status(400).json({ error: 'markets array requerido' });
  }

  try {
    // Find every slug we already have a decision row for (any status). We
    // skip cached/rejected rows, but backfill approved/pending rows that were
    // created while translation was misconfigured and still have no Spanish.
    const existing = await sql`
      SELECT slug, title_es, options_es, approved_by, status
        FROM polymarket_approved
    `;
    const existingBySlug = new Map(existing.map(r => [r.slug, r]));

    const todo = markets.filter(m =>
      m && m.slug && m.title && needsTranslation(existingBySlug.get(m.slug))
    );

    // Fetching Polymarket pages is heavier than calling Gamma, so keep the
    // per-call cap modest and let the frontend drain the queue over loops.
    const configuredCap = Number(process.env.POLYMARKET_TRANSLATION_BATCH_SIZE);
    const CAP = Math.min(Math.max(Number.isFinite(configuredCap) && configuredCap > 0 ? configuredCap : 8, 1), 20);
    const batch = todo.slice(0, CAP);

    const translations = await Promise.all(
      batch.map(m => translateMarketToSpanish({ slug: m.slug, eventSlug: m.eventSlug, title: m.title, options: m.options }))
    );

    const newRows = [];
    for (let i = 0; i < batch.length; i++) {
      const m = batch[i];
      const tr = translations[i];
      if (!tr) continue;
      try {
        const existingRow = existingBySlug.get(m.slug);
        const rows = await sql`
          INSERT INTO polymarket_approved (slug, title_es, options_es, approved_by, status)
          VALUES (${m.slug}, ${tr.titleEs}, ${JSON.stringify(tr.optionsEs)}, ${existingRow?.approved_by || 'auto'}, ${existingRow?.status || 'pending'})
          ON CONFLICT (slug) DO UPDATE
            SET title_es = EXCLUDED.title_es,
                options_es = EXCLUDED.options_es
          RETURNING slug, title_es, options_es, approved_at, approved_by, status
        `;
        if (rows[0]) newRows.push(rows[0]);
      } catch (_) {
        // Race condition with another concurrent admin: ignore and move on.
      }
    }

    const failed = Math.max(0, batch.length - newRows.length);
    const error = failed > 0 && newRows.length === 0
      ? 'No se pudo obtener traduccion de Polymarket en espanol' + (process.env.ANTHROPIC_API_KEY ? ' ni de Anthropic.' : ' y ANTHROPIC_API_KEY no esta configurada.')
      : null;

    return res.status(200).json({
      ok: !error,
      translated: newRows.length,
      failed,
      cached: Math.max(0, markets.length - todo.length),
      remaining: newRows.length > 0 ? Math.max(0, todo.length - batch.length) : 0,
      error,
      rows: newRows,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
