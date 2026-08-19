/**
 * GET /api/points/crypto-history?marketId=<id>
 *
 * Returns the server-recorded price-tick series for a 5-min crypto
 * market's [openedAt, closesAt] window. Source: crypto_ticks table,
 * or the frozen per-market snapshot captured at resolve-time.
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
import { readCoinbaseBoundaryPrice } from '../_lib/crypto-price-source.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

const PRODUCT_ID_BY_ASSET = {
  btc: 'BTC-USD',
  eth: 'ETH-USD',
};

function parseJsonb(value, fallback) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function dateMs(value) {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function normalizePoints(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const out = [];
  for (const p of points) {
    const t = Number(p?.t);
    const price = Number(p?.price);
    if (!Number.isFinite(t) || !Number.isFinite(price)) continue;
    out.push({ t, price });
  }
  out.sort((a, b) => a.t - b.t);
  const deduped = [];
  for (const p of out) {
    if (deduped.length > 0 && deduped[deduped.length - 1].t === p.t) {
      deduped[deduped.length - 1] = p;
    } else {
      deduped.push(p);
    }
  }
  return deduped;
}

function isTrustedClosePriceSource(source) {
  const value = String(source || '').toLowerCase();
  return value === 'coinbase-candle' || value === 'coinbase-candle-correction';
}

function configCloseAnchor(cfg, closesAt) {
  if (!isTrustedClosePriceSource(cfg?.closePriceSource)) return null;
  const price = Number(cfg?.closePrice);
  if (!Number.isFinite(price)) return null;
  const closesAtMs = dateMs(closesAt);
  const closeAtMs = dateMs(cfg?.closePriceAt || cfg?.closesAt || closesAt);
  const t = closesAtMs && closeAtMs && Math.abs(closeAtMs - closesAtMs) <= 90_000
    ? closesAtMs
    : closeAtMs;
  if (!Number.isFinite(t)) return null;
  return { t, price, source: cfg.closePriceSource };
}

async function readBoundaryCloseForHistory({ cfg, asset, closesAt }) {
  const fromConfig = configCloseAnchor(cfg, closesAt);
  if (fromConfig) return fromConfig;

  const productId = cfg?.coinbaseProductId || PRODUCT_ID_BY_ASSET[asset];
  if (!productId || !closesAt) return null;

  try {
    const boundary = await readCoinbaseBoundaryPrice({ productId, timestamp: closesAt });
    const t = dateMs(boundary.capturedAt || closesAt);
    const price = Number(boundary.price);
    if (!Number.isFinite(t) || !Number.isFinite(price)) return null;
    return {
      t,
      price,
      source: boundary.source,
      priceAt: boundary.capturedAt,
    };
  } catch (e) {
    console.warn('[points/crypto-history] boundary close unavailable', {
      asset,
      productId,
      closesAt,
      message: e?.message,
    });
    return null;
  }
}

function removeUntrustedCloseAnchor(points, { cfg, closesAt }) {
  if (isTrustedClosePriceSource(cfg?.closePriceSource)) return points;
  const closePrice = Number(cfg?.closePrice);
  const closesAtMs = dateMs(closesAt);
  if (!Number.isFinite(closePrice) || !Number.isFinite(closesAtMs) || points.length === 0) {
    return points;
  }
  return points.filter((p, idx) => {
    const isLast = idx === points.length - 1;
    const isCloseTime = Math.abs(Number(p.t) - closesAtMs) <= 30_000;
    const isClosePrice = Math.abs(Number(p.price) - closePrice) < 0.000001;
    return !(isLast && isCloseTime && isClosePrice);
  });
}

function snapFinalPoint(points, finalAnchor, { cfg, closesAt }) {
  const base = removeUntrustedCloseAnchor(normalizePoints(points), { cfg, closesAt });
  if (!finalAnchor) return base;

  const t = Number(finalAnchor.t);
  const price = Number(finalAnchor.price);
  if (!Number.isFinite(t) || !Number.isFinite(price)) return base;

  const nextClose = { t, price };
  const lastT = base.length > 0 ? base[base.length - 1].t : -Infinity;
  if (lastT >= t - 30_000) {
    if (base.length === 0) base.push(nextClose);
    else base[base.length - 1] = nextClose;
  } else {
    base.push(nextClose);
  }
  return normalizePoints(base);
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

    // Look up window + asset for this market. We don't trust any
    // window passed by the client — keying off `marketId` keeps the
    // endpoint shape minimal and prevents a caller from pulling
    // arbitrary ranges of crypto_ticks via custom from/to params.
    const rows = await sql`
      SELECT id, status, start_time, end_time, resolver_config
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
    const finalAnchor = r.status === 'resolved'
      ? await readBoundaryCloseForHistory({ cfg, asset, closesAt })
      : null;

    const snapshotRows = await sql`
      SELECT opened_at, closes_at, points
      FROM points_crypto_market_snapshots
      WHERE market_id = ${marketId}
      LIMIT 1
    `;
    if (snapshotRows.length > 0) {
      const snap = snapshotRows[0];
      const rawPoints = parseJsonb(snap.points, []);
      const points = Array.isArray(rawPoints)
        ? snapFinalPoint(rawPoints, finalAnchor, { cfg, closesAt })
        : [];
      if (points.length > 0) {
        return res.status(200).json({
          marketId,
          asset,
          openedAt: snap.opened_at || openedAt,
          closesAt: snap.closes_at || closesAt,
          points,
          source: finalAnchor ? 'final_snapshot_corrected' : 'final_snapshot',
        });
      }
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
      source: finalAnchor ? 'ticks_corrected' : 'ticks',
      points: snapFinalPoint(points.map(p => ({
        t: new Date(p.captured_at).getTime(),
        price: Number(p.price),
      })), finalAnchor, { cfg, closesAt }),
    });
  } catch (e) {
    console.error('[points/crypto-history] error', { message: e?.message, code: e?.code });
    if (e?.code === '42P01') {
      return res.status(503).json({ error: 'schema_not_ready' });
    }
    return res.status(500).json({ error: 'history_failed', detail: e?.message });
  }
}
