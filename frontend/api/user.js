import { neon } from '@neondatabase/serverless';
import { applyCors } from './_lib/cors.js';
import { requirePrivyUser } from './_lib/auth.js';
import { ensureUserSchema } from './_lib/user-schema.js';

// Separate read-only and read-write connections
const sqlRead  = neon(process.env.DATABASE_READ_URL  || process.env.DATABASE_URL);
const sqlWrite = neon(process.env.DATABASE_WRITE_URL || process.env.DATABASE_URL);

// Admin usernames — server-side only, never sent to client bundle
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'mezcal,frmm,alex')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS' });
  if (cors) return cors;

  // GET /api/user?privyId=xxx — check if user has username + admin status
  if (req.method === 'GET') {
    const { privyId } = req.query;
    if (!privyId) return res.status(400).json({ error: 'privyId required' });
    const auth = await requirePrivyUser(req, res, privyId);
    if (!auth.ok) return;
    try {
      await ensureUserSchema(sqlWrite);
      const rows = await sqlRead`SELECT username FROM users WHERE privy_id = ${privyId}`;
      if (rows.length === 0) return res.status(404).json({ username: null, isAdmin: false });
      const username = rows[0].username;
      if (!username) return res.status(404).json({ username: null, isAdmin: false });
      const isAdmin = ADMIN_USERNAMES.includes((username || '').toLowerCase());
      return res.status(200).json({ username, isAdmin });
    } catch (e) {
      console.error('GET /api/user failed', {
        message: e?.message,
        code: e?.code,
        detail: e?.detail,
      });
      return res.status(500).json({ error: 'Server error' });
    }
  }

  // POST /api/user — create username
  if (req.method === 'POST') {
    const { privyId, username } = req.body;
    if (!privyId || !username) return res.status(400).json({ error: 'privyId and username required' });
    const auth = await requirePrivyUser(req, res, privyId);
    if (!auth.ok) return;

    // Validate: 3-20 chars, alphanumeric + underscore only
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters (letters, numbers, underscore)' });
    }

    // Always normalize to lowercase — usernames are case-insensitive
    const normalized = username.toLowerCase();

    try {
      await ensureUserSchema(sqlWrite);

      // Case-insensitive duplicate check
      const existing = await sqlRead`
        SELECT privy_id FROM users WHERE LOWER(username) = ${normalized} LIMIT 1
      `;
      if (existing.length > 0 && existing[0].privy_id !== privyId) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      const rows = await sqlWrite`
        INSERT INTO users (privy_id, username)
        VALUES (${privyId}, ${normalized})
        ON CONFLICT (privy_id) DO UPDATE
        SET username = EXCLUDED.username
        RETURNING username
      `;
      return res.status(201).json({ username: rows[0]?.username || normalized });
    } catch (e) {
      console.error('POST /api/user failed', {
        message: e?.message,
        code: e?.code,
        detail: e?.detail,
      });
      if (e.message?.includes('unique') || e.code === '23505') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
