/**
 * GET /api/points/crypto-history?marketId=<id>
 *
 * Returns the server-recorded price-tick series for a 5-min crypto
 * market's [openedAt, closesAt] window. Source: crypto_ticks table,
 * populated by /api/cron/crypto-ticker every minute.
 *
 * Why this endpoint exists: the chart used to backfill by hitting
 * Coinbase's public trades endpoint directly from the browser. That
 * worked while a market was active (Coinbase keeps ~50 min of trades
 * on hand) but degraded for resolved markets older than that — the
 * client couldn't paginate far enough back. Now we serve our own
 * persisted snapshots so every fresh page open shows the same dense
 * curve, regardless of when the user visits.
 *
 * Response shape — pair-of-arrays so the frontend can map straight
 * into the LivePriceChart's {t,price}[] without a transform:
 *   {
 *     marketId, asset, openedAt, closesAt,
 *     points: [{ t: <ms>, price: <number> }, …],   // ascending
 *   }
 *
 * Public — no auth. Same trust model as /api/points/markets.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const idRaw = req.query.marketId ?? req.query.id;
    const marketId = parseInt(idRaw, 10);
    if (!Number.isInteger(marketId) || marketId <= 0) {
      return res.status(400).json({ error: 'invalid_marketId' });
    }

    await ensurePointsSchema(schemaSql);

    // Look up window + asset for this market. We don't trust any
    // window passed by the client — keying off `marketId` keeps the
    // endpoint shape minimal and prevents a caller from pulling
    // arbitrary ranges of crypto_ticks via custom from/to params.
    const rows = await sql`
      SELECT id, start_time, end_time, resolver_config
      FROM points_markets
      WHERE id = ${marketId}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const r = rows[0];
    const cfg = parseJsonb(r.resolver_config, null);
    if (cfg?.shape !== 'binary-direction') {
      // Not a crypto-5min market — nothing to serve here.
      return res.status(400).json({ error: 'not_crypto_market' });
    }
    const asset = (cfg.asset || '').toLowerCase();
    const openedAt = cfg.openedAt || r.start_time;
    const closesAt = cfg.closesAt || r.end_time;
    if (!asset || !openedAt || !closesAt) {
      return res.status(409).json({ error: 'incomplete_market_window' });
    }

    const points = await sql`
      SELECT captured_at, price
      FROM crypto_ticks
      WHERE asset = ${asset}
        AND captured_at >= ${openedAt}::timestamptz
        AND captured_at <= ${closesAt}::timestamptz
      ORDER BY captured_at ASC
    `;

    return res.status(200).json({
      marketId,
      asset,
      openedAt,
      closesAt,
      points: points.map(p => ({
        t: new Date(p.captured_at).getTime(),
        price: Number(p.price),
      })),
    });
  } catch (e) {
    console.error('[points/crypto-history] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'history_failed', detail: e?.message });
  }
}
