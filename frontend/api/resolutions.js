import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requireAdmin } from './_lib/admin.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (cors) return cors;

  // GET — return all resolutions (public)
  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM market_resolutions ORDER BY resolved_at DESC`;
      return res.status(200).json({ resolutions: rows });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST — resolve a market (admin only)
  if (req.method === 'POST') {
    const { privyId, marketId, outcome, winner, winnerShort, resolvedBy, description } = req.body || {};

    if (!privyId || !marketId || !outcome || !winner) {
      return res.status(400).json({ error: 'Campos requeridos: privyId, marketId, outcome, winner' });
    }

    const admin = await requireAdmin(req, res, sql, privyId);
    if (!admin.ok) return;

    // Insert resolution
    try {
      const rows = await sql`
        INSERT INTO market_resolutions (market_id, outcome, winner, winner_short, resolved_by, description)
        VALUES (${marketId}, ${outcome}, ${winner}, ${winnerShort || null}, ${resolvedBy || admin.username}, ${description || null})
        ON CONFLICT (market_id) DO UPDATE SET
          outcome = EXCLUDED.outcome,
          winner = EXCLUDED.winner,
          winner_short = EXCLUDED.winner_short,
          resolved_by = EXCLUDED.resolved_by,
          description = EXCLUDED.description,
          resolved_at = NOW()
        RETURNING *
      `;
      return res.status(200).json({ ok: true, resolution: rows[0] });
    } catch (e) {
      return res.status(500).json({ error: 'Error guardando resolución: ' + e.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
}
