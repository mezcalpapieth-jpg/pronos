/**
 * POST /api/points/parlays/quote
 * Body: { legs: [{ marketId, outcomeIndex }], stake }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readParlayQuote } from '../../_lib/points-parlays.js';

const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await ensurePointsSchema(schemaSql);
    const quote = await readParlayQuote(readSql, {
      legs: req.body?.legs,
      stake: req.body?.stake,
      now: new Date(),
    });
    return res.status(200).json(quote);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/parlays/quote] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'parlay_quote_failed' });
  }
}
