import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// Admin usernames — must match /api/user
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'mezcal,frmm,alex')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

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

    // Verify admin
    try {
      const userRows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
      if (userRows.length === 0) return res.status(403).json({ error: 'Usuario no encontrado' });
      const username = userRows[0].username?.toLowerCase();
      if (!ADMIN_USERNAMES.includes(username)) {
        return res.status(403).json({ error: 'No autorizado' });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Error verificando admin: ' + e.message });
    }

    // Insert resolution
    try {
      const rows = await sql`
        INSERT INTO market_resolutions (market_id, outcome, winner, winner_short, resolved_by, description)
        VALUES (${marketId}, ${outcome}, ${winner}, ${winnerShort || null}, ${resolvedBy || username}, ${description || null})
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
