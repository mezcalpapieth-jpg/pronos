import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';

/**
 * Generated markets CRUD.
 *
 * GET  /api/generated-markets           → public: all status='approved' or 'live'
 * GET  /api/generated-markets?status=pending&privyId=<id>  → admin: pending for review
 * POST /api/generated-markets           → admin: update status (approve/reject/live)
 *        body: { privyId, id, action: 'approve'|'reject'|'live', patch?: {...} }
 */

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (cors) return cors;

  // ── GET ───────────────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const statusFilter = req.query.status || 'approved';

      // Admin viewing pending/rejected
      if (statusFilter !== 'approved' && statusFilter !== 'live') {
        const privyId = req.query.privyId;
        const admin = await requireAdmin(req, res, sql, privyId);
        if (!admin.ok) return;
      }

      const rows = await sql`
        SELECT id, slug, title, category, category_label, icon, deadline, deadline_date,
               options, volume, region, reasoning, source_headlines, status,
               generated_at, reviewed_at, reviewed_by
          FROM generated_markets
         WHERE status = ${statusFilter}
         ORDER BY generated_at DESC
         LIMIT 100
      `;

      return res.status(200).json({ markets: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST ──────────────────────────────────────────────
  if (req.method === 'POST') {
    const { privyId, id, action, patch } = req.body || {};

    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;

    // ── CREATE — insert a brand-new market ──────────────
    if (action === 'create') {
      const { title, title_en, category, icon, deadline, options, options_en } = req.body;
      if (!title || !category || !deadline || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ error: 'Campos requeridos: title, category, deadline, options (min 2)' });
      }
      try {
        const reviewer = admin.username || 'admin';

        // Generate a URL-safe slug from the title
        const slug = title
          .toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
          .slice(0, 80)
          + '-' + Date.now().toString(36);

        const CATEGORY_LABELS = {
          deportes: 'DEPORTES', politica: 'POLÍTICA INTERNACIONAL',
          crypto: 'CRYPTO', mexico: 'MÉXICO & CDMX',
          musica: 'MÚSICA & FARÁNDULA', general: 'GENERAL',
        };

        const rows = await sql`
          INSERT INTO generated_markets
            (slug, title, category, category_label, icon, deadline, options, volume, status, reviewed_at, reviewed_by)
          VALUES
            (${slug}, ${title}, ${category}, ${CATEGORY_LABELS[category] || category.toUpperCase()},
             ${icon || '📰'}, ${deadline}, ${JSON.stringify(options)}, '0', 'approved', NOW(), ${reviewer})
          RETURNING *
        `;
        return res.status(201).json({ ok: true, market: rows[0] });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // ── STATUS CHANGE — approve / reject / live ──────────
    if (!id || !action) {
      return res.status(400).json({ error: 'Campos requeridos: id, action' });
    }

    const allowedActions = { approve: 'approved', reject: 'rejected', live: 'live', pending: 'pending' };
    const newStatus = allowedActions[action];
    if (!newStatus) {
      return res.status(400).json({ error: 'action inválida' });
    }

    try {
      // Get admin username for audit
      const reviewer = admin.username || 'admin';

      // Optional edits before approval
      if (patch && typeof patch === 'object') {
        await sql`
          UPDATE generated_markets
             SET title = COALESCE(${patch.title || null}, title),
                 icon = COALESCE(${patch.icon || null}, icon),
                 category = COALESCE(${patch.category || null}, category),
                 category_label = COALESCE(${patch.category_label || null}, category_label),
                 deadline = COALESCE(${patch.deadline || null}, deadline),
                 options = COALESCE(${patch.options ? JSON.stringify(patch.options) : null}, options)
           WHERE id = ${id}
        `;
      }

      const rows = await sql`
        UPDATE generated_markets
           SET status = ${newStatus},
               reviewed_at = NOW(),
               reviewed_by = ${reviewer}
         WHERE id = ${id}
         RETURNING *
      `;
      if (rows.length === 0) return res.status(404).json({ error: 'Mercado no encontrado' });

      return res.status(200).json({ ok: true, market: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
}
