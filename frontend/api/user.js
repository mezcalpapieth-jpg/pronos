import { neon } from '@neondatabase/serverless';

// Separate read-only and read-write connections
const sqlRead  = neon(process.env.DATABASE_READ_URL  || process.env.DATABASE_URL);
const sqlWrite = neon(process.env.DATABASE_WRITE_URL || process.env.DATABASE_URL);

// Admin usernames — server-side only, never sent to client bundle
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'mezcal,frmm,alex')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/user?privyId=xxx — check if user has username + admin status
  if (req.method === 'GET') {
    const { privyId } = req.query;
    if (!privyId) return res.status(400).json({ error: 'privyId required' });
    const rows = await sqlRead`SELECT username FROM users WHERE privy_id = ${privyId}`;
    if (rows.length === 0) return res.status(404).json({ username: null, isAdmin: false });
    const username = rows[0].username;
    const isAdmin = ADMIN_USERNAMES.includes((username || '').toLowerCase());
    return res.status(200).json({ username, isAdmin });
  }

  // POST /api/user — create username
  if (req.method === 'POST') {
    const { privyId, username } = req.body;
    if (!privyId || !username) return res.status(400).json({ error: 'privyId and username required' });

    // Validate: 3-20 chars, alphanumeric + underscore only
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters (letters, numbers, underscore)' });
    }

    try {
      await sqlWrite`INSERT INTO users (privy_id, username) VALUES (${privyId}, ${username.toLowerCase()})`;
      return res.status(201).json({ username: username.toLowerCase() });
    } catch (e) {
      if (e.message?.includes('unique') || e.code === '23505') {
        return res.status(409).json({ error: 'Username already taken' });
      }
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
