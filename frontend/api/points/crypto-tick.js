/**
 * POST /api/points/crypto-tick
 *
 * Records a single browser-observed price tick for a BTC/ETH chart.
 * The cron also writes a sparse one-minute baseline so charts have
 * history even when nobody is viewing the page. Browser tabs add
 * denser points while someone is watching, but at a lower cadence than
 * the live WebSocket UI.
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
 *     on UNIQUE(asset, captured_at) + ON CONFLICT DO NOTHING so
 *     concurrent tabs collapse into the same row.
 *
 * Response: 200 with { stored: true } when accepted, { stored: false,
 * reason } when rejected (rate-limited, plausibility, etc.). Either
 * way the client never needs to act on this — it's fire-and-forget.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import {
  CRYPTO_TICK_RETENTION_HOURS,
  insertCryptoTick,
  maybePruneCryptoTicks,
} from '../_lib/crypto-ticks.js';

const sql = neon(process.env.DATABASE_URL);

const ALLOWED_ASSETS = new Set(['btc', 'eth']);
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

    const tick = await insertCryptoTick(sql, { asset, price });
    const cleanup = await maybePruneCryptoTicks(sql, {
      asset,
      stored: tick.stored,
      bucketIso: tick.bucket,
    });

    return res.status(200).json({
      stored: tick.stored,
      bucket: tick.bucket,
      retentionHours: CRYPTO_TICK_RETENTION_HOURS,
      pruned: cleanup.pruned,
      deleted: cleanup.deleted,
    });
  } catch (e) {
    console.error('[points/crypto-tick] error', { message: e?.message, code: e?.code });
    if (e?.code === '42P01') {
      return res.status(503).json({ error: 'schema_not_ready' });
    }
    return res.status(500).json({ error: 'tick_failed' });
  }
}
