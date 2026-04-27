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
import { readAppleMxTopArtist } from '../_lib/charts.js';
import { readYouTubeTopMxChannel } from '../_lib/youtube.js';
import { readEspnEvent, readFootballDataMatch, readJolpicaF1Result } from '../_lib/sports-results.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql   = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

/**
 * Build the free-form final-score string we store on points_markets.final_score.
 * Rendered under the question on resolved market cards and the detail page.
 *
 * `outcomes` is the market's outcomes array so we can reach for the winning
 * label as a fallback (e.g. price / weather resolvers where there's no
 * meaningful scoreline — we just echo "Subió a $98,421" or the winner label).
 * Cap at 240 chars to match resolve-market.js server validation.
 */
function buildFinalScore({ resolverType, cfg, result, resolverInfo, outcomes, winningIdx }) {
  const winLabel = Array.isArray(outcomes) ? outcomes[winningIdx] : null;
  const clip = (s) => (s == null ? null : String(s).slice(0, 240));

  try {
    if (resolverType === 'sports_api') {
      if (cfg.shape === 'binary' || cfg.shape === 'draw3') {
        const home = Number.isFinite(result.homeScore) ? result.homeScore : null;
        const away = Number.isFinite(result.awayScore) ? result.awayScore : null;
        const score = (home != null && away != null) ? `${home}-${away}` : null;
        const hName = result.homeTeam || null;
        const aName = result.awayTeam || null;
        if (hName && aName && score) return clip(`${hName} ${score} ${aName}`);
        if (score) return clip(score);
        return clip(winLabel);
      }
      if (cfg.shape === 'parallel') {
        const driver = result.winnerDriverLabel || resolverInfo?.winnerDriver;
        if (driver) return clip(`🏁 ${driver}`);
        return clip(winLabel);
      }
    }

    if (resolverType === 'chainlink_price' || resolverType === 'api_price') {
      const price = resolverInfo?.priceAtResolve;
      if (price != null) {
        const sym = cfg.symbol || cfg.feedAddress || resolverInfo?.source || '';
        const short = sym ? (typeof sym === 'string' ? sym.slice(0, 20) : '') : '';
        const priceStr = typeof price === 'number' ? price.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(price);
        return clip(short ? `${short} · ${priceStr}` : priceStr);
      }
      return clip(winLabel);
    }

    if (resolverType === 'weather_api') {
      const temp = resolverInfo?.recordedMaxC;
      if (Number.isFinite(temp)) return clip(`${Number(temp).toFixed(1)}°C máx`);
      return clip(winLabel);
    }

    if (resolverType === 'api_chart') {
      const top = resolverInfo?.topArtist || resolverInfo?.topChannel || resolverInfo?.topTrack || resolverInfo?.topTitle;
      if (top) return clip(`#1 ${top}`);
      return clip(winLabel);
    }
  } catch { /* fall through */ }

  return clip(winLabel);
}

/**
 * Core auto-resolve loop, extracted so the admin "Resolver ahora"
 * endpoint can trigger it without CRON_SECRET. Returns the same
 * `{ ok, tookMs, checked, resolved, errors, dryRun }` shape the
 * cron handler used to build inline.
 *
 * Vercel cron jobs ONLY run on production deployments. On preview
 * URLs the every-15-min schedule never fires, so admins use the
 * admin endpoint to kick this off manually.
 */
export async function runAutoResolve({ dry = false } = {}) {
  const started = Date.now();
  await ensurePointsSchema(schemaSql);

    // Only parents — parallel legs are resolved via the parent cascade
    // below (weather_api). For price resolvers the market is already
    // unified binary so there's nothing to cascade.
    const candidates = await readSql`
      SELECT id, question, end_time, resolver_type, resolver_config,
             outcomes, amm_mode
      FROM points_markets
      WHERE status = 'active'
        AND resolver_type IN ('chainlink_price', 'api_price', 'weather_api', 'api_chart', 'sports_api')
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
      // `result` is hoisted to the iteration scope so buildFinalScore
      // (called below outside this try-block) can read it for sports
      // markets without crashing on non-sports resolvers that never
      // assign it. Non-sports types pass `null` through and
      // buildFinalScore's branch logic falls back to winLabel.
      let winningIdx = null;
      let resolverInfo = {};
      let result = null;
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
        } else if (m.resolver_type === 'api_chart') {
          // Parallel music / trending markets. Each leg has a match
          // rule; the "Otro" leg's rule is all-null and wins when no
          // listed leg matches the current #1.
          if (!Array.isArray(cfg.legs) || cfg.legs.length === 0) {
            throw new Error('invalid api_chart config: missing legs');
          }
          let pickWinnerIdx;
          let readerEcho;

          if (cfg.source === 'apple-mx-songs') {
            const top = await readAppleMxTopArtist();
            const needle = (top.artist || '').toLowerCase().trim();
            pickWinnerIdx = cfg.legs.findIndex(l =>
              l.artist && String(l.artist).toLowerCase().trim() === needle,
            );
            readerEcho = { topArtist: top.artist, topTrack: top.trackName };
          } else if (cfg.source === 'youtube-trending-mx') {
            const top = await readYouTubeTopMxChannel();
            // Prefer channelId match (stable); fall back to display name.
            const idNeedle = (top.channelId || '').trim();
            const nameNeedle = (top.channel || '').toLowerCase().trim();
            pickWinnerIdx = cfg.legs.findIndex(l => {
              if (l.channelId && String(l.channelId).trim() === idNeedle) return true;
              if (l.channel && String(l.channel).toLowerCase().trim() === nameNeedle) return true;
              return false;
            });
            readerEcho = { topChannel: top.channel, topTitle: top.title };
          } else {
            throw new Error(`unsupported api_chart source: ${cfg.source}`);
          }

          if (pickWinnerIdx < 0) {
            // Fall back to "Otro" — the first leg whose match rule is
            // all-null. If no Otro leg exists the market is malformed
            // and we surface that as an error rather than pick arbitrarily.
            pickWinnerIdx = cfg.legs.findIndex(l =>
              !l.artist && !l.channel && !l.channelId,
            );
            if (pickWinnerIdx < 0) {
              throw new Error('no matching leg and no Otro fallback configured');
            }
          }
          winningIdx = pickWinnerIdx;
          resolverInfo = { source: cfg.source, ...readerEcho };
        } else if (m.resolver_type === 'sports_api') {
          // Sports scoreboards (MLB/NBA/F1 via ESPN + Jolpica +
          // football-data). Shape in cfg:
          //   source: 'espn' | 'football-data' | 'jolpica-f1'
          //   shape:  'binary' | 'draw3' | 'parallel'
          //   (+ source-specific fields: eventId/leaguePath/dateYmd,
          //    matchId, season/round, legs[])
          if (!cfg.source || !cfg.shape) {
            throw new Error('invalid sports_api config: missing source/shape');
          }

          // Read result from the configured source. Reuses the
          // iteration-scope `result` declared above so buildFinalScore
          // can see it after the dispatch.
          if (cfg.source === 'espn') {
            result = await readEspnEvent({
              leaguePath: cfg.leaguePath,
              eventId: cfg.eventId,
              dateYmd: cfg.dateYmd,
            });
          } else if (cfg.source === 'football-data') {
            result = await readFootballDataMatch(cfg.matchId);
          } else if (cfg.source === 'jolpica-f1') {
            result = await readJolpicaF1Result({ season: cfg.season, round: cfg.round });
          } else {
            throw new Error(`unsupported sports_api source: ${cfg.source}`);
          }

          // Not completed yet = benign skip. Cron will retry on the
          // next tick; a postponed game just keeps retrying until
          // admin intervenes (no auto-escalation for now).
          if (!result.completed) {
            const err = new Error('not_finished_yet');
            err.benign = true;
            throw err;
          }

          // Map winner → outcome index per shape.
          if (cfg.shape === 'binary') {
            // Outcomes [home, away] — MLB/NBA
            if (result.winner === 'home') winningIdx = 0;
            else if (result.winner === 'away') winningIdx = 1;
            else throw new Error(`binary sport got draw/null winner: ${result.winner}`);
          } else if (cfg.shape === 'draw3') {
            // Outcomes [home, 'Empate', away] — soccer 3-way
            if (result.winner === 'home')      winningIdx = 0;
            else if (result.winner === 'draw') winningIdx = 1;
            else if (result.winner === 'away') winningIdx = 2;
            else throw new Error(`draw3 sport got null winner`);
          } else if (cfg.shape === 'parallel') {
            // F1 / similar — cfg.legs is [{ label, driverId }]. Match
            // the winner driverId against the list; fallback to
            // driver-label case-insensitive; finally fall back to the
            // "Otro" leg if present (driverId === null).
            if (!Array.isArray(cfg.legs) || cfg.legs.length === 0) {
              throw new Error('parallel sport: missing cfg.legs');
            }
            const idNeedle = (result.winnerDriverId || '').trim();
            const nameNeedle = (result.winnerDriverLabel || '').toLowerCase().trim();
            let idx = cfg.legs.findIndex(l =>
              l.driverId && String(l.driverId).trim() === idNeedle,
            );
            if (idx < 0) {
              idx = cfg.legs.findIndex(l =>
                l.label && String(l.label).toLowerCase().trim() === nameNeedle,
              );
            }
            if (idx < 0) {
              idx = cfg.legs.findIndex(l => !l.driverId && l.label?.toLowerCase() === 'otro');
            }
            if (idx < 0) {
              throw new Error(`no leg matched winner "${result.winnerDriverLabel}"`);
            }
            winningIdx = idx;
          } else {
            throw new Error(`unknown sports_api shape: ${cfg.shape}`);
          }

          resolverInfo = {
            source: cfg.source,
            shape: cfg.shape,
            winner: result.winner,
            homeScore: result.homeScore ?? null,
            awayScore: result.awayScore ?? null,
            winnerDriver: result.winnerDriverLabel ?? null,
          };
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

      // Build the human-readable score string (e.g. "México 3-2 Brasil",
      // "🏁 Verstappen", "BTC · 98,421") from the same data we already
      // pulled from the source. Falls back to the winning outcome label
      // when the source doesn't give us a scoreline.
      const marketOutcomes = parseJsonb(m.outcomes, []);
      const finalScore = buildFinalScore({
        resolverType: m.resolver_type,
        cfg,
        result,
        resolverInfo,
        outcomes: marketOutcomes,
        winningIdx,
      });

      if (dry) {
        report.resolved.push({ id: m.id, winningIdx, finalScore, ...resolverInfo, dry: true });
        continue;
      }

      try {
        await withTransaction(async (client) => {
          // Two-step UPDATE: core resolution must always work; the
          // final_score patch is best-effort (column may not exist on
          // older schemas — treat 42703 as benign skip).
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
          // Optional score — never blocks the resolution itself.
          if (finalScore != null && finalScore !== '') {
            try {
              await client.query(
                `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
                [finalScore, m.id],
              );
            } catch (e) {
              if (e?.code !== '42703') throw e;
              // 42703 = column doesn't exist; the resolution itself is
              // already committed above, so we just skip the score.
            }
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

  return {
    ok: true,
    tookMs: Date.now() - started,
    ...report,
  };
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
  try {
    const result = await runAutoResolve({ dry });
    return res.status(200).json(result);
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
