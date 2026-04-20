/**
 * Points-app auto-resolver.
 *
 * Scans points_markets for active rows whose trading window has closed
 * AND whose resolver_type is one we know how to settle automatically.
 * Today: only 'chainlink_price' (reads the feed via JSON-RPC, compares
 * to resolver_config.threshold, flips status=resolved). Future resolver
 * types (sports_api, polymarket_mirror) plug into the same dispatch.
 *
 * Intentionally a SEPARATE cron from /api/cron/auto-resolve — that one
 * is MVP-only and handles Polymarket-backed on-chain markets, which
 * doesn't apply to the off-chain points app.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (required in production)
 *   CHAINLINK_RPC_URL  (optional — override default public RPC)
 *
 * GET /api/cron/points-auto-resolve              — run the resolver
 * GET /api/cron/points-auto-resolve?dry=1        — log candidates + feed
 *                                                  reads without writing
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { readChainlinkPrice, comparePrice } from '../_lib/chainlink.js';
import { readFinnhubQuote } from '../_lib/stockprice.js';
import { readBanxicoLatest } from '../_lib/banxico.js';
import { readCreAverageFor } from '../_lib/fuel.js';
import { fetchMaxTempC, bucketIndexFor } from '../_lib/weather.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql   = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  // Same cron-guard pattern as every other /api/cron/* endpoint.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev — allow through.
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true';
  const started = Date.now();

  try {
    await ensurePointsSchema(schemaSql);

    // Only parents — parallel legs are resolved via the parent cascade
    // below (weather_api). For price resolvers the market is already
    // unified binary so there's nothing to cascade.
    const candidates = await readSql`
      SELECT id, question, end_time, resolver_type, resolver_config,
             outcomes, amm_mode
      FROM points_markets
      WHERE status = 'active'
        AND resolver_type IN ('chainlink_price', 'api_price', 'weather_api')
        AND end_time IS NOT NULL
        AND end_time < NOW()
        AND parent_id IS NULL
      LIMIT 100
    `;

    const report = {
      checked: candidates.length,
      resolved: [],
      errors: [],
      dryRun: dry,
    };

    for (const m of candidates) {
      const cfg = parseJsonb(m.resolver_config, null);
      if (!cfg) {
        report.errors.push({ id: m.id, error: 'missing_resolver_config' });
        continue;
      }

      // Compute the winning outcome index per resolver type. Price
      // resolvers hit a feed / API and compare; weather_api resolves by
      // fetching the recorded high and picking the bucket index.
      let winningIdx = null;
      let resolverInfo = {};
      try {
        if (m.resolver_type === 'chainlink_price') {
          if (!cfg.feedAddress || !cfg.op || cfg.threshold == null || cfg.yesOutcome == null) {
            throw new Error('invalid chainlink_price config');
          }
          const price = await readChainlinkPrice({
            feedAddress: cfg.feedAddress,
            chainId: cfg.chainId,
          });
          const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
          const yesIdx = Number(cfg.yesOutcome);
          winningIdx = yes ? yesIdx : (1 - yesIdx);
          resolverInfo = { priceAtResolve: price, op: cfg.op, threshold: cfg.threshold };
        } else if (m.resolver_type === 'api_price') {
          // api_price is a family — dispatch on cfg.source to pick the
          // right reader. Each reader returns a scalar price in the
          // same currency as cfg.threshold.
          if (!cfg.source || !cfg.op || cfg.threshold == null || cfg.yesOutcome == null) {
            throw new Error(`invalid api_price config (source=${cfg.source})`);
          }
          let price;
          let readerInfo;
          if (cfg.source === 'finnhub') {
            if (!cfg.symbol) throw new Error('finnhub: missing symbol');
            const quote = await readFinnhubQuote(cfg.symbol);
            price = quote.price;
            readerInfo = { symbol: cfg.symbol };
          } else if (cfg.source === 'banxico-fix') {
            if (!cfg.seriesId) throw new Error('banxico-fix: missing seriesId');
            const r = await readBanxicoLatest(cfg.seriesId);
            price = r.value;
            readerInfo = { seriesId: cfg.seriesId, fecha: r.fecha };
          } else if (cfg.source === 'cre-gasolina') {
            if (!cfg.fuelType) throw new Error('cre-gasolina: missing fuelType');
            const r = await readCreAverageFor(cfg.fuelType);
            price = r.value;
            readerInfo = { fuelType: cfg.fuelType, sampleSize: r.sampleSize };
          } else {
            throw new Error(`unsupported api_price source: ${cfg.source}`);
          }
          const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
          const yesIdx = Number(cfg.yesOutcome);
          winningIdx = yes ? yesIdx : (1 - yesIdx);
          resolverInfo = {
            priceAtResolve: price,
            source: cfg.source,
            op: cfg.op,
            threshold: cfg.threshold,
            ...readerInfo,
          };
        } else if (m.resolver_type === 'weather_api') {
          if (!cfg.lat || !cfg.lng || !cfg.forecastDateYmd || !Array.isArray(cfg.buckets)) {
            throw new Error('invalid weather_api config');
          }
          const tempC = await fetchMaxTempC({
            lat: cfg.lat,
            lng: cfg.lng,
            dateYmd: cfg.forecastDateYmd,
            timezone: cfg.timezone,
          });
          // Bucket match — prefer the config's own ranges over the
          // library's defaults so regenerated buckets don't desync.
          winningIdx = cfg.buckets.findIndex(b =>
            tempC >= Number(b.minC) && tempC < Number(b.maxC),
          );
          if (winningIdx < 0) winningIdx = bucketIndexFor(tempC); // fallback
          if (winningIdx < 0) throw new Error(`temp ${tempC}°C didn't fit any bucket`);
          resolverInfo = { recordedMaxC: tempC, forecastDateYmd: cfg.forecastDateYmd };
        } else {
          throw new Error(`unknown resolver_type: ${m.resolver_type}`);
        }
      } catch (e) {
        report.errors.push({ id: m.id, error: `resolve_failed: ${e.message}` });
        continue;
      }

      if (winningIdx == null || !Number.isInteger(winningIdx) || winningIdx < 0) {
        report.errors.push({ id: m.id, error: `invalid winningIdx ${winningIdx}` });
        continue;
      }

      if (dry) {
        report.resolved.push({ id: m.id, winningIdx, ...resolverInfo, dry: true });
        continue;
      }

      try {
        await withTransaction(async (client) => {
          // Update parent first; guarded against admin races.
          const r = await client.query(
            `UPDATE points_markets
               SET status = 'resolved', outcome = $1,
                   resolved_at = NOW(), resolved_by = $2
             WHERE id = $3 AND status = 'active'
             RETURNING id, amm_mode`,
            [winningIdx, `resolver:${m.resolver_type}`, m.id],
          );
          if (r.rows.length === 0) {
            const err = new Error('not_active_at_write'); err.benign = true; throw err;
          }
          // Cascade to parallel legs (mirrors admin resolve-market.js):
          // winning leg's YES side pays out; losing legs' NO side pays.
          if (m.amm_mode === 'parallel') {
            const legs = await client.query(
              `SELECT id FROM points_markets
                 WHERE parent_id = $1
                 ORDER BY id ASC
                 FOR UPDATE`,
              [m.id],
            );
            for (let i = 0; i < legs.rows.length; i++) {
              const legWinningOutcome = i === winningIdx ? 0 : 1;
              await client.query(
                `UPDATE points_markets
                   SET status = 'resolved', outcome = $1,
                       resolved_at = NOW(), resolved_by = $2
                 WHERE id = $3 AND status = 'active'`,
                [legWinningOutcome, `resolver:${m.resolver_type}`, legs.rows[i].id],
              );
            }
          }
        });
        report.resolved.push({ id: m.id, winningIdx, ...resolverInfo });
      } catch (e) {
        if (e.benign) continue; // already resolved by admin — fine
        report.errors.push({ id: m.id, error: `write_failed: ${e.message}` });
      }
    }

    return res.status(200).json({
      ok: true,
      tookMs: Date.now() - started,
      ...report,
    });
  } catch (e) {
    console.error('[cron/points-auto-resolve] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'resolve_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
