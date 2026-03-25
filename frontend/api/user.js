import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/user?privyId=xxx — check if user has username
  if (req.method === 'GET') {
    const { privyId } = req.query;
    if (!privyId) return res.status(400).json({ error: 'privyId required' });
    const rows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
    if (rows.length === 0) return res.status(404).json({ username: null });
    return res.status(200).json({ username: rows[0].username });
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
      await sql`INSERT INTO users (privy_id, username) VALUES (${privyId}, ${username.toLowerCase()})`;
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
