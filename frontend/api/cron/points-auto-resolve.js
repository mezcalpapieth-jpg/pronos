/**
 * Points-app auto-resolver.
 *
 * Scans points_markets for active rows whose trading window has closed
 * AND whose resolver_type is one we know how to settle automatically.
 * Active resolver types: chainlink_price, api_price, weather_api,
 * api_chart, sports_api (espn / espn-pga / espn-liv / etc.).
 * manual_review/manual markets are not auto-settled; they are queued
 * into points_resolution_candidates when their close time passes.
 *
 * NOTE: this is now the ONLY auto-resolver. The older
 * /api/cron/auto-resolve was a Polymarket-Gamma mirror for the
 * legacy MVP path; it's been deprecated (returns 410 Gone) since
 * Pronos no longer integrates Polymarket. See lib/protocol.js for
 * the architecture decision.
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
import { readChainlinkPrice, readChainlinkRoundAtOrBefore, comparePrice } from '../_lib/chainlink.js';
import { formatDirectionFinalScore, resolveDirectionOutcome } from '../_lib/crypto-5min.js';
import { readCoinbaseBoundaryPrice } from '../_lib/crypto-price-source.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from '../_lib/crypto-chart-snapshot.js';
import { readFinnhubQuote } from '../_lib/stockprice.js';
import { readBanxicoLatest } from '../_lib/banxico.js';
import { readCreAverageFor } from '../_lib/fuel.js';
import { fetchMaxTempC, bucketIndexFor } from '../_lib/weather.js';
import { readAppleMxTopArtist } from '../_lib/charts.js';
import { readYouTubeTopMxChannel } from '../_lib/youtube.js';
import { readEspnEvent, readFootballDataMatch, readJolpicaF1Result, readJolpicaF1Standings, readEspnPgaWinner, readEspnLivWinner, readLivTeamWinner, readEspnAtpTournamentWinner, readEspnMmaWinner, readOddsApiBoxingWinner, readNextOpponent } from '../_lib/sports-results.js';
import { buildEspnLiveScoreConfig } from '../_lib/espn-live-score.js';
import { buildFootballDataEspnFallbackConfig } from '../_lib/sports-resolver-fallback.js';
import { NEXT_OPPONENT_RECHECK_INTERVAL_HOURS, findParallelWinnerIndex } from '../_lib/sports-resolver-policy.js';
import { buildPointsResolutionCandidateInsert } from '../_lib/points-resolution-candidates.js';
import { releaseOpenLimitOrdersForMarkets } from '../_lib/points-limit-orders.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql   = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const MAX_BINARY_DIRECTION_CATCHUP_PER_RUN = 12;
const AUTO_RESOLVABLE_API_CHART_SOURCES = new Set([
  'apple-mx-songs',
  'youtube-trending-mx',
]);

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
      if (cfg.shape === 'binary' || cfg.shape === 'draw3' || cfg.shape === 'total-goals-over') {
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
      if (cfg.shape === 'binary-direction' && price != null && cfg.threshold != null) {
        return clip(formatDirectionFinalScore(cfg.threshold, price));
      }
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

function normalizeEvidenceItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const text = item.trim();
    if (!text) return null;
    return /^https?:\/\//i.test(text)
      ? { title: text.slice(0, 160), url: text.slice(0, 500) }
      : { title: text.slice(0, 160), url: null };
  }
  if (typeof item === 'object') {
    const title = String(item.title || item.label || item.source || item.url || '').trim();
    const url = String(item.url || item.href || '').trim();
    if (!title && !url) return null;
    return {
      title: (title || url).slice(0, 160),
      url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
    };
  }
  return null;
}

function compactEvidenceItems(...sources) {
  const items = [];
  const visit = (value) => {
    const parsed = parseJsonb(value, value);
    if (Array.isArray(parsed)) {
      for (const item of parsed) visit(item);
      return;
    }
    const normalized = normalizeEvidenceItem(parsed);
    if (normalized) items.push(normalized);
  };
  sources.forEach(visit);

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.url || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function firstEvidenceUrl(evidence) {
  const hit = (Array.isArray(evidence) ? evidence : [])
    .find(item => item?.url && /^https?:\/\//i.test(item.url));
  return hit?.url || null;
}

function isAutoResolvableApiChart({ resolverType, source }) {
  const rt = String(resolverType || '').trim().toLowerCase();
  const src = String(source || '').trim().toLowerCase();
  return rt === 'api_chart' && AUTO_RESOLVABLE_API_CHART_SOURCES.has(src);
}

function isManualReviewMarket({ resolverType, cfg, row, sourceData }) {
  const rt = String(resolverType || '').trim().toLowerCase();
  if (rt === 'manual' || rt === 'manual_review') return true;

  const source = String(row?.source || cfg?.source || '').trim().toLowerCase();
  if (isAutoResolvableApiChart({ resolverType: rt, source })) return false;

  if (['entertainment', 'codex-entertainment', 'codex-premios-juventud-2026'].includes(source)) {
    return true;
  }
  if (String(row?.category || '').trim().toLowerCase() === 'musica') return true;

  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  return ['award', 'reality_week', 'reality_winner', 'concert'].includes(kind);
}

function buildManualReviewCandidate({ market, cfg, sourceData, outcomes }) {
  const evidence = compactEvidenceItems(
    cfg?.evidence,
    cfg?.sources,
    cfg?.sourceUrls,
    sourceData?.evidence,
    sourceData?.sources,
    sourceData?.sourceUrls,
    sourceData?.url,
  );
  const suggestedOutcome = Number(cfg?.suggestedOutcomeIndex ?? cfg?.outcomeIndex);
  const source = cfg?.source || market.source || sourceData?.kind || 'manual-review';
  const sourceEventId = cfg?.sourceEventId
    || market.source_event_id
    || sourceData?.awardKey
    || sourceData?.showLabel
    || sourceData?.artist
    || String(market.id);
  const finalScoreText = cfg?.finalScore
    || cfg?.finalScoreText
    || sourceData?.finalScore
    || null;

  return {
    pointsMarketId: market.id,
    resolverType: 'manual_review',
    source,
    sourceEventId,
    outcomeIndex: Number.isInteger(suggestedOutcome) ? suggestedOutcome : null,
    outcomeCount: Array.isArray(outcomes) && outcomes.length > 0 ? outcomes.length : 2,
    confidenceBps: Number(cfg?.confidenceBps) || 0,
    observedAt: new Date().toISOString(),
    finalScoreText,
    evidenceUrl: cfg?.evidenceUrl || sourceData?.evidenceUrl || firstEvidenceUrl(evidence),
    evidence,
    rationale: cfg?.rationale
      || cfg?.criteria
      || 'El mercado cerró y requiere revisión manual antes de pagar MXNP.',
    rawReport: {
      resolverConfig: cfg || null,
      sourceData: sourceData || null,
    },
  };
}

async function queueManualReviewCandidate({ market, cfg, sourceData, outcomes, dry, report }) {
  const candidate = buildPointsResolutionCandidateInsert(
    buildManualReviewCandidate({ market, cfg, sourceData, outcomes }),
  );

  if (dry) {
    report.deferred.push({
      id: market.id,
      reason: 'manual_review_candidate',
      outcomeIndex: candidate.outcome_index,
      source: candidate.source,
      dry: true,
    });
    return;
  }

  const result = await schemaSql.query(
    `INSERT INTO points_resolution_candidates
       (points_market_id, resolver_type, source, source_event_id,
        outcome_index, outcome_count, confidence_bps, observed_at,
        final_score, evidence_url, evidence, rationale, raw_report, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()),
             $9, $10, $11::jsonb, $12, $13::jsonb, 'pending')
     ON CONFLICT (points_market_id) WHERE status = 'pending'
     DO UPDATE SET
       resolver_type = EXCLUDED.resolver_type,
       source = EXCLUDED.source,
       source_event_id = EXCLUDED.source_event_id,
       outcome_index = EXCLUDED.outcome_index,
       outcome_count = EXCLUDED.outcome_count,
       confidence_bps = EXCLUDED.confidence_bps,
       observed_at = EXCLUDED.observed_at,
       final_score = EXCLUDED.final_score,
       evidence_url = EXCLUDED.evidence_url,
       evidence = EXCLUDED.evidence,
       rationale = EXCLUDED.rationale,
       raw_report = EXCLUDED.raw_report
     RETURNING id`,
    [
      candidate.points_market_id,
      candidate.resolver_type,
      candidate.source,
      candidate.source_event_id,
      candidate.outcome_index,
      candidate.outcome_count,
      candidate.confidence_bps,
      candidate.observed_at,
      candidate.final_score,
      candidate.evidence_url,
      JSON.stringify(candidate.evidence),
      candidate.rationale,
      JSON.stringify(candidate.raw_report || {}),
    ],
  );

  const returnedRows = Array.isArray(result) ? result : (result.rows || []);
  report.deferred.push({
    id: market.id,
    reason: 'manual_review_queued',
    candidateId: returnedRows[0]?.id || null,
    source: candidate.source,
  });
}

async function queueApiChartFallbackReview({ market, cfg, sourceData, outcomes, dry, report, error }) {
  const message = error?.message || 'No se pudo leer la fuente automática.';
  const reviewCfg = {
    ...(cfg || {}),
    confidenceBps: 0,
    suggestedOutcomeIndex: null,
    rationale: `El lector automático de charts no pudo confirmar el resultado: ${message}. Requiere revisión manual antes de pagar MXNP.`,
  };
  await queueManualReviewCandidate({
    market,
    cfg: reviewCfg,
    sourceData,
    outcomes,
    dry,
    report,
  });
}

/**
 * Core auto-resolve loop, extracted so the admin "Resolver ahora"
 * endpoint can trigger it without CRON_SECRET. Returns the same
 * `{ ok, tookMs, checked, resolved, errors, dryRun }` shape the
 * cron handler used to build inline.
 *
 * Also acts as a catch-up pass for BTC/ETH 5-minute markets. Their
 * preferred path is the exact boundary tick in _lib/crypto-5min.js,
 * but if that tick is missed, this loop resolves them later using the
 * Chainlink round at the market's close timestamp.
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
      SELECT m.id, m.question, m.category, m.start_time, m.end_time, m.resolver_type,
             m.resolver_config, m.outcomes, m.amm_mode, m.sport, m.league,
             m.source, m.source_event_id,
             pm.source_data AS pending_source_data
      FROM points_markets m
      LEFT JOIN LATERAL (
        SELECT source_data
          FROM points_pending_markets
         WHERE approved_market_id = m.id
         ORDER BY id DESC
         LIMIT 1
      ) pm ON true
      WHERE m.status = 'active'
        AND m.end_time IS NOT NULL
        AND m.parent_id IS NULL
        AND (
          (
            m.resolver_type IN ('chainlink_price', 'api_price', 'weather_api', 'api_chart', 'sports_api')
            AND (
              m.end_time < NOW()
              OR (
                m.resolver_type = 'sports_api'
                AND m.resolver_config->>'source' IN ('espn', 'football-data')
                AND m.resolver_config->>'shape' IN ('binary', 'draw3')
                AND m.start_time IS NOT NULL
                AND m.start_time < NOW() - INTERVAL '90 minutes'
              )
              OR (
                m.resolver_type = 'sports_api'
                AND m.resolver_config->>'source' = 'next-opponent'
                AND m.end_time > NOW()
                AND (
                  m.resolver_config->>'nextOpponentLastCheckedAt' IS NULL
                  OR NULLIF(m.resolver_config->>'nextOpponentLastCheckedAt', '')::timestamptz
                       < NOW() - (${NEXT_OPPONENT_RECHECK_INTERVAL_HOURS}::int * INTERVAL '1 hour')
                )
              )
            )
          )
          OR (
            m.end_time < NOW()
            AND (
              m.resolver_type IN ('manual', 'manual_review')
              OR (
                m.resolver_type IS NULL
                AND (
                  m.source IN ('entertainment', 'codex-entertainment', 'codex-premios-juventud-2026')
                  OR m.category = 'musica'
                  OR pm.source_data->>'kind' IN ('award', 'reality_week', 'reality_winner', 'concert')
                )
              )
            )
          )
          OR (
            m.resolver_type IS NULL
            AND m.sport = 'soccer'
            AND (
              m.end_time < NOW()
              OR (
                m.start_time IS NOT NULL
                AND m.start_time < NOW() - INTERVAL '90 minutes'
              )
            )
            AND pm.source_data->>'manualResolution' = 'true'
            AND pm.source_data->>'competitionCode' IN ('CL', 'EL', 'UCL', 'CLI')
          )
        )
      ORDER BY
        CASE WHEN m.resolver_config->>'shape' = 'binary-direction' THEN 1 ELSE 0 END,
        m.end_time ASC
      LIMIT 100
    `;

    const report = {
      checked: candidates.length,
      resolved: [],
      errors: [],
      deferred: [],
      dryRun: dry,
    };

    let binaryDirectionCatchups = 0;

    for (const m of candidates) {
      const marketOutcomes = parseJsonb(m.outcomes, []);
      const sourceData = parseJsonb(m.pending_source_data, {});
      let cfg = parseJsonb(m.resolver_config, null);
      let resolverType = m.resolver_type;
      if (!cfg) {
        const fallbackCfg = buildEspnLiveScoreConfig({
          resolverType: null,
          resolverConfig: null,
          sourceData,
          sport: m.sport,
          league: m.league,
          startTime: m.start_time,
        });
        if (fallbackCfg) {
          cfg = {
            ...fallbackCfg,
            shape: marketOutcomes.length === 2 ? 'binary' : 'draw3',
          };
          resolverType = 'sports_api';
        }
      }
      if (isManualReviewMarket({ resolverType, cfg, row: m, sourceData })) {
        try {
          await queueManualReviewCandidate({
            market: m,
            cfg,
            sourceData,
            outcomes: marketOutcomes,
            dry,
            report,
          });
        } catch (e) {
          report.errors.push({ id: m.id, error: `manual_review_queue_failed: ${e.message}` });
        }
        continue;
      }
      if (!cfg) {
        report.errors.push({ id: m.id, error: 'missing_resolver_config' });
        continue;
      }
      const isBinaryDirectionCatchup = resolverType === 'chainlink_price'
        && cfg.shape === 'binary-direction';
      if (isBinaryDirectionCatchup && binaryDirectionCatchups >= MAX_BINARY_DIRECTION_CATCHUP_PER_RUN) {
        report.deferred.push({ id: m.id, reason: 'binary_direction_catchup_limit' });
        continue;
      }
      if (isBinaryDirectionCatchup) binaryDirectionCatchups += 1;

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
      let resolverConfigPatch = null;
      let result = null;
      try {
        if (resolverType === 'chainlink_price') {
          if (cfg.shape === 'binary-direction') {
            if (!cfg.feedAddress || cfg.threshold == null) {
              throw new Error('invalid chainlink_price binary-direction config');
            }
            const closesAt = cfg.closesAt || m.end_time;
            if (!closesAt) throw new Error('binary-direction: missing closesAt');

            if (cfg.coinbaseProductId) {
              const boundary = await readCoinbaseBoundaryPrice({
                productId: cfg.coinbaseProductId,
                timestamp: closesAt,
              });
              winningIdx = resolveDirectionOutcome(boundary.price, cfg.threshold);
              if (winningIdx == null) {
                throw new Error(`binary-direction tie at ${boundary.price}`);
              }
              resolverInfo = {
                priceAtResolve: boundary.price,
                threshold: cfg.threshold,
                source: boundary.source,
                priceAt: boundary.capturedAt,
                productId: boundary.productId,
              };
              resolverConfigPatch = {
                closePrice: boundary.price,
                closePriceSource: boundary.source,
                closePriceAt: boundary.capturedAt,
              };
            } else {
              const round = await readChainlinkRoundAtOrBefore({
                feedAddress: cfg.feedAddress,
                chainId: cfg.chainId,
                timestamp: closesAt,
              });
              winningIdx = resolveDirectionOutcome(round.price, cfg.threshold);
              if (winningIdx == null) {
                throw new Error(`binary-direction tie at ${round.price}`);
              }
              const roundUpdatedAt = Number.isFinite(Number(round.updatedAt))
                ? new Date(Number(round.updatedAt) * 1000).toISOString()
                : null;
              resolverInfo = {
                priceAtResolve: round.price,
                threshold: cfg.threshold,
                source: cfg.symbol || 'chainlink',
                roundUpdatedAt,
              };
              resolverConfigPatch = {
                closePrice: round.price,
                resolvedRoundId: round.roundId?.toString?.() || String(round.roundId),
                resolvedRoundUpdatedAt: roundUpdatedAt,
              };
            }
          } else {
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
          }
        } else if (resolverType === 'api_price') {
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
        } else if (resolverType === 'weather_api') {
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
        } else if (resolverType === 'api_chart') {
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
        } else if (resolverType === 'sports_api') {
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
              homeName: cfg.homeName,
              awayName: cfg.awayName,
            });
          } else if (cfg.source === 'football-data') {
            const footballDataEspnFallback = buildFootballDataEspnFallbackConfig({
              resolverConfig: cfg,
              sourceData: m.pending_source_data,
              sport: m.sport,
              league: m.league,
              startTime: m.start_time,
            });
            const useFootballDataEspnFallback = async () => {
              cfg = {
                ...cfg,
                ...footballDataEspnFallback,
                originalSource: 'football-data',
                originalMatchId: cfg.matchId == null ? null : String(cfg.matchId),
              };
              return readEspnEvent({
                leaguePath: cfg.leaguePath,
                eventId: cfg.eventId,
                dateYmd: cfg.dateYmd,
                homeName: cfg.homeName,
                awayName: cfg.awayName,
              });
            };

            if (!process.env.FOOTBALL_DATA_API_KEY && footballDataEspnFallback) {
              result = await useFootballDataEspnFallback();
            } else {
              try {
                result = await readFootballDataMatch(cfg.matchId);
                if (!result?.completed && footballDataEspnFallback) {
                  const espnResult = await useFootballDataEspnFallback();
                  if (espnResult?.completed) result = espnResult;
                }
              } catch (err) {
                if (!footballDataEspnFallback) throw err;
                result = await useFootballDataEspnFallback();
              }
            }
          } else if (cfg.source === 'jolpica-f1') {
            result = await readJolpicaF1Result({ season: cfg.season, round: cfg.round });
          } else if (cfg.source === 'jolpica-f1-standings') {
            // F1 season-long markets — Drivers' / Constructors'
            // Championship. Cron only auto-resolves markets whose
            // end_time has passed; for these we set end_time to a
            // few days after the season finale, so by then the
            // standings are mathematically locked.
            result = await readJolpicaF1Standings({
              season: cfg.season,
              kind: cfg.kind, // 'drivers' | 'constructors'
            });
          } else if (cfg.source === 'espn-pga') {
            // PGA Tour: ESPN PGA scoreboard. Returns the order=1
            // player using the same winnerDriverId/Label shape as F1
            // so the parallel-shape branch below picks it up
            // unchanged (id-match → label-match → 'Otro' fallback).
            // Team events (Zurich Classic) fall through to 'Otro'.
            result = await readEspnPgaWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'espn-liv') {
            // LIV Golf — same scoreboard shape as PGA, just a
            // different leaguePath under ESPN's golf API. Same
            // winnerDriverId/Label envelope, same parallel-shape
            // matcher. LIV uses team scores too (4-man teams) but
            // the individual leaderboard always has order=1; we
            // resolve on the individual winner.
            result = await readEspnLivWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'odds-api-boxing') {
            // Boxing — the-odds-api scores endpoint. Returns the
            // winner by name (no id-system in their API), which
            // matches what we wrote into legs[].driverId at
            // generation time. Draws/no-contests come back as
            // completed=false; admin voids via /admin/void-market.
            result = await readOddsApiBoxingWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'next-opponent') {
            // "Next opponent" markets for marquee fighters. Hits
            // either ESPN MMA scoreboard or the-odds-api boxing
            // depending on cfg.resolverSource. Returns the opponent
            // name as winnerDriverLabel; cron's parallel-shape
            // matcher does loose name match against legs[].label
            // (case-insensitive substring either direction).
            result = await readNextOpponent({
              fighterLabel: cfg.fighterLabel,
              resolverSource: cfg.resolverSource,
            });
          } else if (cfg.source === 'espn-mma') {
            // UFC — per-fight winner from the MMA scoreboard.
            // Passes both eventId (the card) and fightId (the bout).
            // Draws return completed=false; admin handles those via
            // /api/points/admin/void-market.
            result = await readEspnMmaWinner({
              eventId: cfg.eventId,
              fightId: cfg.fightId,
            });
          } else if (cfg.source === 'espn-liv-teams' || cfg.source === 'livgolf-teams') {
            // LIV team-leaderboard — ESPN's API explicitly does NOT
            // expose team data ("Teams are not currently supported
            // for golf/liv"). We scrape livgolf.com/leaderboard
            // instead. Matched against the displayed event via
            // tournamentName + startDateIso; returns the same
            // winnerDriverId/Label envelope as the individual
            // readers so the parallel-shape matcher handles it
            // unchanged. See _lib/sports-results.js for the parser.
            result = await readLivTeamWinner({
              tournamentName: cfg.tournamentName,
              startDateIso: cfg.startDateIso,
            });
          } else if (cfg.source === 'espn-atp-tournament') {
            // ATP tournament-winner markets (Slams + Masters 1000
            // + ATP 500). Pulls /atp/scoreboard for the tournament
            // event, walks groupings → mens-singles → Final
            // (round.id='7'), and returns the competitor with
            // winner=true. Same envelope as the other parallel-
            // shape readers.
            result = await readEspnAtpTournamentWinner({ eventId: cfg.eventId });
          } else {
            throw new Error(`unsupported sports_api source: ${cfg.source}`);
          }

          // Not completed yet = benign skip. Cron will retry on the
          // next tick; a postponed game just keeps retrying until
          // admin intervenes (no auto-escalation for now).
          if (!result.completed) {
            const err = new Error('not_finished_yet');
            err.benign = true;
            err.info = {
              source: cfg.source,
              state: result.state || null,
              notFound: result.notFound === true,
            };
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
          } else if (cfg.shape === 'total-goals-over') {
            const home = Number(result.homeScore);
            const away = Number(result.awayScore);
            const threshold = Number(cfg.threshold ?? 2.5);
            if (!Number.isFinite(home) || !Number.isFinite(away) || !Number.isFinite(threshold)) {
              throw new Error('total-goals-over sport got missing score/threshold');
            }
            winningIdx = home + away > threshold ? 0 : 1;
          } else if (cfg.shape === 'parallel') {
            // F1 / similar — cfg.legs is [{ label, driverId }]. Match
            // the winner driverId against the list; fallback to exact
            // and loose driver-label matching; finally fall back to the
            // "Otro" leg if present (driverId === null).
            if (!Array.isArray(cfg.legs) || cfg.legs.length === 0) {
              throw new Error('parallel sport: missing cfg.legs');
            }
            const idx = findParallelWinnerIndex(cfg.legs, result);
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
            totalGoals: cfg.shape === 'total-goals-over'
              ? (Number(result.homeScore) + Number(result.awayScore))
              : null,
            threshold: cfg.shape === 'total-goals-over' ? Number(cfg.threshold ?? 2.5) : null,
            winnerDriver: result.winnerDriverLabel ?? null,
          };
        } else {
          throw new Error(`unknown resolver_type: ${resolverType}`);
        }
      } catch (e) {
        if (e?.benign) {
          const deferred = {
            id: m.id,
            reason: e.message || 'deferred',
            ...(e.info || {}),
          };
          if (!dry && resolverType === 'sports_api' && cfg.source === 'next-opponent') {
            const checkedAt = new Date().toISOString();
            try {
              await schemaSql`
                UPDATE points_markets
                   SET resolver_config = COALESCE(resolver_config, '{}'::jsonb)
                     || ${JSON.stringify({ nextOpponentLastCheckedAt: checkedAt })}::jsonb
                 WHERE id = ${m.id}
                   AND status = 'active'
              `;
              deferred.nextOpponentLastCheckedAt = checkedAt;
            } catch (patchErr) {
              deferred.checkPatchError = patchErr?.message?.slice(0, 160) || 'patch_failed';
            }
          }
          report.deferred.push(deferred);
          continue;
        }
        if (isAutoResolvableApiChart({ resolverType, source: cfg?.source })) {
          try {
            await queueApiChartFallbackReview({
              market: m,
              cfg,
              sourceData,
              outcomes: marketOutcomes,
              dry,
              report,
              error: e,
            });
            continue;
          } catch (queueErr) {
            report.errors.push({
              id: m.id,
              error: `resolve_failed: ${e.message}; api_chart_manual_review_queue_failed: ${queueErr.message}`,
            });
          }
          continue;
        }
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
      const finalScore = buildFinalScore({
        resolverType,
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
          await releaseOpenLimitOrdersForMarkets(client, [m.id], {
            reason: 'market_resolved',
          });
          // Two-step UPDATE: core resolution must always work; the
          // final_score patch is best-effort (column may not exist on
          // older schemas — treat 42703 as benign skip).
          const r = await client.query(
            `UPDATE points_markets
               SET status = 'resolved', outcome = $1,
                   resolved_at = NOW(), resolved_by = $2,
                   resolver_type = COALESCE(resolver_type, $4),
                   resolver_config = COALESCE(resolver_config, $5::jsonb)
             WHERE id = $3 AND status = 'active'
             RETURNING id, amm_mode`,
            [winningIdx, `resolver:${resolverType}`, m.id, resolverType, JSON.stringify(cfg)],
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
          if (resolverConfigPatch && Object.keys(resolverConfigPatch).length > 0) {
            await client.query(
              `UPDATE points_markets
                  SET resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $1::jsonb
                WHERE id = $2`,
              [JSON.stringify(resolverConfigPatch), m.id],
            );
          }
          // Cascade to parallel legs (mirrors admin resolve-market.js):
          // winning leg's YES side pays out; losing legs' NO side pays.
          if (m.amm_mode === 'parallel') {
            const legs = await client.query(
              `SELECT id FROM points_markets
                 WHERE parent_id = $1
                   AND status <> 'canceled'
                 ORDER BY id ASC
                 FOR UPDATE`,
              [m.id],
            );
            await releaseOpenLimitOrdersForMarkets(client, legs.rows.map(row => Number(row.id)), {
              reason: 'market_resolved',
            });
            for (let i = 0; i < legs.rows.length; i++) {
              const legWinningOutcome = i === winningIdx ? 0 : 1;
              await client.query(
                `UPDATE points_markets
                   SET status = 'resolved', outcome = $1,
                       resolved_at = NOW(), resolved_by = $2
                 WHERE id = $3 AND status = 'active'`,
                [legWinningOutcome, `resolver:${resolverType}`, legs.rows[i].id],
              );
            }
          }

          await bestEffortPersistResolvedCryptoMarketSnapshot(
            client,
            m.id,
            'cron/points-auto-resolve',
          );
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
