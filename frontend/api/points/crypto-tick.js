/**
 * POST /api/points/crypto-tick
 *
 * Records a single price tick for a BTC/ETH 5-min chart. Replaces the
 * old server-side cron worker: instead of having Vercel cron poll
 * Coinbase every minute (which costs compute even when nobody's on a
 * crypto page), browsers already running a Coinbase WebSocket via
 * useCryptoTicker submit one tick per 5 seconds as a side-effect. The
 * chart's read endpoint (/api/points/crypto-history) is unchanged —
 * it serves whatever's in crypto_ticks regardless of who wrote it.
 *
 * Body: { asset: 'btc'|'eth', price: number }
 *
 * Trust model:
 *   - No auth — keep the surface flat. Settlement is Chainlink, so
 *     poisoning the cosmetic chart is the worst a bad actor can do.
 *   - Plausibility filter: reject any price more than ±2% off the
 *     median of the last 5 ticks within the last 30 s. Catches spam
 *     and obvious client bugs while still allowing genuine market
 *     moves (every honest tick over the noisy one accelerates the
 *     median back to truth).
 *   - Bucket dedup: floor captured_at to 5-second boundaries and rely
 *     on UNIQUE(asset, captured_at) + ON CONFLICT DO NOTHING so 12
 *     ticks/min/asset is the hard ceiling regardless of how many
 *     tabs are open.
 *
 * Response: 200 with { stored: true } when accepted, { stored: false,
 * reason } when rejected (rate-limited, plausibility, etc.). Either
 * way the client never needs to act on this — it's fire-and-forget.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

const ALLOWED_ASSETS = new Set(['btc', 'eth']);
const BUCKET_MS = 5_000;
const RETENTION_DAYS = 7;
const PLAUSIBILITY_PCT = 0.02; // ±2%
const PLAUSIBILITY_WINDOW_MS = 30_000;
// Absolute sanity bounds — if the client sends $0.42 or $42M we drop
// it before even checking the plausibility window. Catches typos and
// units-mistakes before they can pollute the median.
const ABSOLUTE_BOUNDS = {
  btc: { min: 1_000,  max: 1_000_000 },
  eth: { min: 50,     max: 100_000   },
};

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const asset = String(body.asset || '').toLowerCase();
    const price = Number(body.price);

    if (!ALLOWED_ASSETS.has(asset)) {
      return res.status(400).json({ error: 'invalid_asset' });
    }
    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'invalid_price' });
    }
    const bounds = ABSOLUTE_BOUNDS[asset];
    if (price < bounds.min || price > bounds.max) {
      return res.status(200).json({ stored: false, reason: 'absurd_price' });
    }

    await ensurePointsSchema(schemaSql);

    // Plausibility check against the most recent few ticks. Cold
    // start (no ticks) accepts unconditionally — first writer wins.
    const recent = await sql`
      SELECT price
      FROM crypto_ticks
      WHERE asset = ${asset}
        AND captured_at > NOW() - INTERVAL '30 seconds'
      ORDER BY captured_at DESC
      LIMIT 5
    `;
    if (recent.length > 0) {
      const med = median(recent.map(r => Number(r.price)));
      if (Number.isFinite(med) && med > 0) {
        const delta = Math.abs(price - med) / med;
        if (delta > PLAUSIBILITY_PCT) {
          return res.status(200).json({
            stored: false,
            reason: 'implausible',
            median: med,
            delta,
          });
        }
      }
    }

    // Floor to a 5-second bucket so concurrent submissions collapse
    // into one row via the UNIQUE constraint. Postgres handles this
    // with date_bin in 14+ but we compute it client-side for
    // portability across the various Neon branches.
    const bucketIso = new Date(
      Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS,
    ).toISOString();

    await sql`
      INSERT INTO crypto_ticks (asset, captured_at, price)
      VALUES (${asset}, ${bucketIso}::timestamptz, ${price})
      ON CONFLICT (asset, captured_at) DO NOTHING
    `;

    await sql`
      DELETE FROM crypto_ticks
      WHERE captured_at < NOW() - INTERVAL '7 days'
    `;

    return res.status(200).json({ stored: true, bucket: bucketIso, retentionDays: RETENTION_DAYS });
  } catch (e) {
    console.error('[points/crypto-tick] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'tick_failed' });
  }
}
