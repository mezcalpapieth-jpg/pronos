import { neon } from '@neondatabase/serverless';

/**
 * Bulk Spanish translation for live Polymarket markets.
 *
 * The admin page calls this on load with every Polymarket market it just
 * fetched. For any slug that doesn't already exist in `polymarket_approved`
 * (any status — approved / rejected / pending), we translate it via
 * Anthropic Haiku and INSERT a row with status='pending'. This means:
 *   - The admin sees both EN (Polymarket original) and ES (cached) for
 *     every market without having to click anything.
 *   - When the admin later clicks Aprobar, the server already has the
 *     translation cached so the approve call is essentially free.
 *   - Pending rows are NOT visible on the public site (the public GET
 *     filters by status='approved' only).
 *
 * POST /api/polymarket-translate
 *   body: { privyId, markets: [{ slug, title, options }] }
 *
 * Returns: { ok, translated, cached, remaining, rows }
 *
 * The endpoint caps each call at 20 translations to fit inside the Vercel
 * serverless timeout. The frontend drains the queue by calling repeatedly
 * until `remaining` reaches 0 (or until a safety cap is hit).
 */

const sql = neon(process.env.DATABASE_URL);

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'mezcal,frmm,alex')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

async function isAdmin(privyId) {
  if (!privyId) return false;
  try {
    const rows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
    if (rows.length === 0) return false;
    const u = rows[0].username?.toLowerCase();
    return ADMIN_USERNAMES.includes(u);
  } catch (_) {
    return false;
  }
}

// Single-market translation. Returns { titleEs, optionsEs } or null.
async function translateOne({ title, options }) {
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

    const optionsEs = safeOptions.map((opt, i) => ({
      ...opt,
      label: parsed.options[i] || opt.label,
    }));
    return { titleEs: parsed.title, optionsEs };
  } catch (_) {
    return null;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowed = origin === 'https://pronos.io' || origin === 'http://localhost:3333';
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://pronos.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { privyId, markets } = req.body || {};
  if (!(await isAdmin(privyId))) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  if (!Array.isArray(markets)) {
    return res.status(400).json({ error: 'markets array requerido' });
  }

  try {
    // Find every slug we already have a decision row for (any status). We
    // skip those entirely so we never re-translate something that's already
    // cached, approved, or rejected.
    const existing = await sql`SELECT slug FROM polymarket_approved`;
    const have = new Set(existing.map(r => r.slug));

    const todo = markets.filter(m => m && m.slug && m.title && !have.has(m.slug));

    // Per-call cap so we don't blow the 10s Vercel function timeout.
    const CAP = 20;
    const batch = todo.slice(0, CAP);

    // Run translations in parallel — Haiku is fast and Anthropic handles
    // 20 concurrent calls comfortably.
    const translations = await Promise.all(
      batch.map(m => translateOne({ title: m.title, options: m.options }))
    );

    const newRows = [];
    for (let i = 0; i < batch.length; i++) {
      const m = batch[i];
      const tr = translations[i];
      if (!tr) continue;
      try {
        const rows = await sql`
          INSERT INTO polymarket_approved (slug, title_es, options_es, approved_by, status)
          VALUES (${m.slug}, ${tr.titleEs}, ${JSON.stringify(tr.optionsEs)}, 'auto', 'pending')
          ON CONFLICT (slug) DO NOTHING
          RETURNING slug, title_es, options_es, approved_at, approved_by, status
        `;
        if (rows[0]) newRows.push(rows[0]);
      } catch (_) {
        // Race condition with another concurrent admin: ignore and move on.
      }
    }

    return res.status(200).json({
      ok: true,
      translated: newRows.length,
      cached: have.size,
      remaining: Math.max(0, todo.length - batch.length),
      rows: newRows,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
