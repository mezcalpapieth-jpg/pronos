import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import { publicMarketTranslationFields } from '../_lib/market-translations.js';

let sql;
const methods = ['GET', 'POST', 'DELETE'];

export function watchlistMarketId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value);
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return id <= 2_147_483_647 ? id : null;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, DELETE, OPTIONS', credentials: true });
  if (cors) return cors;
  res.setHeader('Cache-Control', 'private, no-store');
  if (!methods.includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  const limited = rateLimit(req, res, {
    key: `points-watchlist:${clientIp(req)}:${session.sub}`,
    limit: 180,
    windowMs: 60_000,
  });
  if (limited) return;

  const marketId = watchlistMarketId(req.body?.marketId);
  if (req.method !== 'GET' && marketId == null) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }

  try {
    sql ||= neon(process.env.DATABASE_URL);
    await ensurePointsSchema(sql);
    const [user] = await sql`SELECT id FROM points_users WHERE turnkey_sub_org_id = ${session.sub}`;
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT m.id, m.question, m.outcomes, m.status, m.end_time, p.source_data
        FROM points_watchlist w
        JOIN points_markets m ON m.id = w.market_id
        LEFT JOIN LATERAL (
          SELECT source_data FROM points_pending_markets
          WHERE approved_market_id = m.id ORDER BY id DESC LIMIT 1
        ) p ON TRUE
        WHERE w.user_id = ${user.id}
        ORDER BY w.created_at DESC, w.market_id DESC
      `;
      return res.status(200).json({
        markets: rows.map(({ id, question, outcomes, status, end_time, source_data }) => ({
          id, question, status, endTime: end_time,
          ...publicMarketTranslationFields({ question, outcomes, sourceData: source_data }),
        })),
      });
    }

    if (req.method === 'POST') {
      const [market] = await sql`SELECT id FROM points_markets WHERE id = ${marketId}`;
      if (!market) return res.status(404).json({ error: 'market_not_found' });
      await sql`
        INSERT INTO points_watchlist (user_id, market_id)
        VALUES (${user.id}, ${marketId})
        ON CONFLICT (user_id, market_id) DO NOTHING
      `;
    } else {
      await sql`DELETE FROM points_watchlist WHERE user_id = ${user.id} AND market_id = ${marketId}`;
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[points/watchlist]', { code: error?.code, message: error?.message });
    return res.status(500).json({ error: 'server_error' });
  }
}
