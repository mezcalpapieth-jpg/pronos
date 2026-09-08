/**
 * Points-app auto-resolver.
 *
 * Scans points_markets for active rows whose trading window has closed
 * AND whose resolver_type is one we know how to settle automatically.
 * Active resolver types: chainlink_price, api_price, weather_api, aicm_delay_count,
 * aicm_delay_minutes_live,
 * api_chart, api_transcript, api_lcdlf, sports_api (espn / espn-pga / espn-liv / etc.).
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
import {
  catchUpCurrentPendingCryptoMarkets,
  catchUpExpiredActiveCryptoMarkets,
  catchUpMissedPendingCryptoMarkets,
  formatDirectionFinalScore,
  readGeneratedCryptoHiddenFromHome,
  resolveDirectionOutcome,
} from '../_lib/crypto-5min.js';
import { readCoinbaseBoundaryPrice } from '../_lib/crypto-price-source.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from '../_lib/crypto-chart-snapshot.js';
import { readFinnhubQuote } from '../_lib/stockprice.js';
import { banxicoFechaToYmd, banxicoFixTargetDateYmd, readBanxicoLatest } from '../_lib/banxico.js';
import { FRANKFURTER_SOURCE, frankfurterTargetDateYmd, readFrankfurterRate } from '../_lib/frankfurter.js';
import { readCreAverageFor } from '../_lib/fuel.js';
import {
  COINGECKO_TOKEN_MCAP_SOURCE,
  resolveSolanaTokenMcapOutcome,
} from '../_lib/solana-token-mcap.js';
import { MANANERA_TRANSCRIPT_SOURCE, readMananeraPhraseResult } from '../_lib/mananera.js';
import { readStoredMananeraTranscript } from '../_lib/mananera-ingest.js';
import { generateMananeraMarkets } from '../_lib/market-gen/mananera.js';
import {
  fetchMaxTempC,
  bucketIndexFor,
  weatherBucketIndexFor,
  resolveObservedWeatherMaxTempC,
  WEATHER_MODEL_AUDIT_THRESHOLD_C,
} from '../_lib/weather.js';
import { aicmDelayBucketIndexFor, readAicmDelayCount } from '../_lib/aicm-board.js';
import { aicmAeBucketIndexFor, countAicmAeDaysInclusive } from '../_lib/aicm-aviation-edge.js';
import { readAicmTimetableDelayCount } from '../_lib/aicm-timetable.js';
import { readAppleMxTopArtist } from '../_lib/charts.js';
import { readYouTubeTopMxChannel } from '../_lib/youtube.js';
import { readEspnEvent, readFootballDataMatch, readJolpicaF1Result, readJolpicaF1Standings, readEspnPgaWinner, readEspnLivWinner, readLivTeamWinner, readEspnAtpTournamentWinner, readEspnAtpMatchWinner, readEspnMmaWinner, readOddsApiBoxingWinner, readNextOpponent } from '../_lib/sports-results.js';
import { buildEspnLiveScoreConfig } from '../_lib/espn-live-score.js';
import { buildFootballDataEspnFallbackConfig } from '../_lib/sports-resolver-fallback.js';
import { NEXT_OPPONENT_RECHECK_INTERVAL_HOURS, findParallelWinnerIndex, resolverLabelsOverlap } from '../_lib/sports-resolver-policy.js';
import { buildPointsResolutionCandidateInsert } from '../_lib/points-resolution-candidates.js';
import { releaseOpenLimitOrdersForMarkets } from '../_lib/points-limit-orders.js';
import { bestEffortPersistTopHolderSnapshot } from '../_lib/points-top-holders.js';
import {
  buildLcdlfResolutionReview,
  isLcdlfMarket,
  LCDLF_SOURCE,
  normalizeLcdlfName,
  readLcdlfOfficialSnapshot,
} from '../_lib/lcdlf-official.js';
import {
  buildNetflixTop10ResolutionReview,
  isNetflixTop10Market,
  NETFLIX_TOP10_PAGE,
  NETFLIX_TOP10_SOURCE,
} from '../_lib/netflix-top10.js';
import { prepareGeneratedSpecs, upsertPending } from '../_lib/run-generators.js';

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
  const timestampLabels = (items) => (Array.isArray(items) ? items : [])
    .map(item => (typeof item === 'string' ? item : item?.label))
    .filter(Boolean);

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
      if (cfg.shape === 'combo-win-count') {
        const wins = Number(resolverInfo?.comboWins ?? result?.wins);
        const total = Number(resolverInfo?.comboTotal ?? result?.total);
        if (Number.isFinite(wins) && Number.isFinite(total) && total > 0) {
          return clip(`${wins}/${total} ganaron`);
        }
        return clip(winLabel);
      }
      if (cfg.shape === 'parallel') {
        const driver = result.winnerDriverLabel || resolverInfo?.winnerDriver;
        if (driver) return clip(`🏁 ${driver}`);
        return clip(winLabel);
      }
    }

    if (resolverType === 'api_lcdlf') {
      const resident = resolverInfo?.residentName || cfg?.residentName;
      const status = resolverInfo?.statusLabel || resolverInfo?.statusKey;
      if (resident && status) return clip(`${resident} · ${status}`);
      if (resident) return clip(resident);
      return clip(winLabel);
    }

    if (resolverType === 'chainlink_price' || resolverType === 'api_price') {
      const price = resolverInfo?.priceAtResolve;
      if (cfg.shape === 'binary-direction' && price != null && cfg.threshold != null) {
        return clip(formatDirectionFinalScore(cfg.threshold, price));
      }
      if (price != null) {
        const sym = cfg.symbol || cfg.pair || cfg.feedAddress || resolverInfo?.pair || resolverInfo?.source || '';
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

    if (resolverType === 'aicm_delay_count') {
      const count = Number(resolverInfo?.count);
      if (Number.isFinite(count)) return clip(`${count} salidas demoradas`);
      return clip(winLabel);
    }

    if (resolverType === 'aicm_delay_minutes_live') {
      const count = Number(resolverInfo?.count);
      const mins = Number(resolverInfo?.thresholdMinutes);
      if (Number.isFinite(count) && Number.isFinite(mins)) {
        return clip(`${count} salidas con más de ${mins} min de retraso`);
      }
      if (Number.isFinite(count)) return clip(`${count} salidas demoradas`);
      return clip(winLabel);
    }

    if (resolverType === 'api_chart') {
      const top = resolverInfo?.topArtist || resolverInfo?.topChannel || resolverInfo?.topTrack || resolverInfo?.topTitle;
      if (top) return clip(`#1 ${top}`);
      return clip(winLabel);
    }

    if (resolverType === 'api_transcript') {
      const count = resolverInfo?.matchCount;
      const phrase = cfg?.phrase;
      if (Number.isFinite(Number(count)) && phrase) {
        const labels = timestampLabels(
          resolverInfo?.requiredMatchTimestamps?.length
            ? resolverInfo.requiredMatchTimestamps
            : resolverInfo?.matchTimestamps,
        );
        const suffix = labels.length ? ` · ${labels.join(', ')}` : '';
        return clip(`${Number(count)} menciones de "${phrase}"${suffix}`);
      }
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

function openMeteoEvidenceUrl(base, params = {}) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.toString();
}

function weatherReviewEvidence({ cfg, resolverInfo } = {}) {
  const lat = cfg?.lat;
  const lng = cfg?.lng;
  const dateYmd = cfg?.forecastDateYmd;
  const timezone = cfg?.timezone || 'America/Mexico_City';
  const evidence = [
    {
      title: 'Open-Meteo Archive hourly temperature',
      url: openMeteoEvidenceUrl('https://archive-api.open-meteo.com/v1/archive', {
        latitude: lat,
        longitude: lng,
        hourly: 'temperature_2m',
        daily: 'temperature_2m_max',
        timezone,
        start_date: dateYmd,
        end_date: dateYmd,
        models: 'best_match',
      }),
    },
    {
      title: 'Open-Meteo forecast model audit',
      url: openMeteoEvidenceUrl('https://api.open-meteo.com/v1/forecast', {
        latitude: lat,
        longitude: lng,
        daily: 'temperature_2m_max',
        timezone,
        start_date: dateYmd,
        end_date: dateYmd,
        models: ['best_match', 'gfs_seamless', 'ecmwf_ifs025', 'icon_seamless'],
      }),
    },
  ];
  const peakHours = Array.isArray(resolverInfo?.peakHours) ? resolverInfo.peakHours : [];
  if (peakHours.length) {
    evidence.push({ title: `Pico observado: ${peakHours.join(', ')}`, url: null });
  }
  return evidence;
}

function buildWeatherManualReviewCandidate({ market, cfg, resolverInfo, outcomes, winningIdx }) {
  const audit = resolverInfo?.weatherAudit || {};
  const winLabel = Array.isArray(outcomes) ? outcomes[winningIdx] : null;
  const mismatched = Array.isArray(audit?.mismatchedBucketModels)
    ? audit.mismatchedBucketModels.join(', ')
    : '';
  const temp = Number(resolverInfo?.observedMaxC ?? resolverInfo?.recordedMaxC);
  const tempLabel = Number.isFinite(temp) ? `${temp.toFixed(1)}°C` : 'temperatura observada';
  const label = winLabel ? `"${winLabel}"` : `opción ${Number(winningIdx) + 1}`;

  return {
    ...(cfg || {}),
    source: 'open-meteo-archive',
    sourceEventId: cfg?.sourceEventId || market?.source_event_id || `weather:${cfg?.forecastDateYmd || market?.id}`,
    suggestedOutcomeIndex: winningIdx,
    confidenceBps: 6500,
    finalScore: resolverInfo?.finalScore || `${tempLabel} máx`,
    evidence: weatherReviewEvidence({ cfg, resolverInfo }),
    rationale: `Open-Meteo Archive sugiere ${label} con ${tempLabel} máximo, pero la auditoría de modelos${mismatched ? ` (${mismatched})` : ''} cae en otra opción o difiere demasiado. Requiere revisión manual antes de pagar MXNP.`,
  };
}

function isAutoResolvableApiChart({ resolverType, source }) {
  const rt = String(resolverType || '').trim().toLowerCase();
  const src = String(source || '').trim().toLowerCase();
  return rt === 'api_chart' && AUTO_RESOLVABLE_API_CHART_SOURCES.has(src);
}

function isManualReviewMarket({ resolverType, cfg, row, sourceData }) {
  const rt = String(resolverType || '').trim().toLowerCase();
  if (rt === 'manual' || rt === 'manual_review') return true;
  if (rt === 'api_lcdlf') return false;

  const resolverSource = String(cfg?.source || '').trim().toLowerCase();
  const source = String(row?.source || resolverSource || '').trim().toLowerCase();
  if (isAutoResolvableApiChart({ resolverType: rt, source: resolverSource || source })) return false;

  if (['entertainment', 'codex-entertainment', 'codex-premios-juventud-2026', 'manual-international-politics'].includes(source)) {
    return true;
  }
  if (String(row?.category || '').trim().toLowerCase() === 'musica') return true;

  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  return ['award', 'reality_week', 'reality_winner', 'lcdlf_week', 'concert', 'netflix_top10', 'granja_vip_week'].includes(kind);
}

function isMananeraMarket({ cfg, row, sourceData } = {}) {
  const source = String(row?.source || cfg?.source || sourceData?.source || '').trim().toLowerCase();
  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  return source === 'mananera'
    || source === MANANERA_TRANSCRIPT_SOURCE
    || source === 'gob-mx-mananera'
    || source === 'mananera-transcript'
    || kind === 'mananera_phrase';
}

function findLcdlfStatusRow(snapshot, cfg = {}) {
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const slugNeedle = String(cfg?.residentSlug || '').trim().toLowerCase();
  const nameNeedle = normalizeLcdlfName(cfg?.residentName || '');
  if (!slugNeedle && !nameNeedle) return null;
  return rows.find(row => (
    (slugNeedle && String(row?.slug || '').trim().toLowerCase() === slugNeedle)
    || (nameNeedle && normalizeLcdlfName(row?.name || '') === nameNeedle)
  )) || null;
}

function lcdlfRowsWithStatus(snapshot, statusKey) {
  const needle = String(statusKey || '').trim().toLowerCase();
  if (!needle) return [];
  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  return rows.filter(row => String(row?.statusKey || '').trim().toLowerCase() === needle);
}

function lcdlfMarketStatusTargets(cfg = {}, marketOutcomes = []) {
  const legs = Array.isArray(cfg?.legs) && cfg.legs.length > 0
    ? cfg.legs
    : marketOutcomes.map(label => ({
        label,
        residentName: label,
        residentSlug: null,
      }));

  return legs
    .map(leg => ({
      slug: String(leg?.residentSlug || '').trim().toLowerCase(),
      name: normalizeLcdlfName(leg?.residentName || leg?.label || ''),
    }))
    .filter(target => target.slug || target.name);
}

function lcdlfStatusRowsForMarket({ snapshot, statusKey, cfg, marketOutcomes }) {
  const rows = lcdlfRowsWithStatus(snapshot, statusKey);
  const targetStatus = String(statusKey || '').trim().toLowerCase();
  if (targetStatus !== 'eliminado') return rows;

  const targets = lcdlfMarketStatusTargets(cfg, marketOutcomes);
  if (targets.length === 0) return rows;

  return rows.filter(row => targets.some(target => (
    (target.slug && String(row?.slug || '').trim().toLowerCase() === target.slug)
    || (target.name && normalizeLcdlfName(row?.name || '') === target.name)
  )));
}

function lcdlfStatusRoundPosted({ snapshot, targetStatus, cfg, marketOutcomes, minStatusCount }) {
  const minCount = Math.max(1, Number.isFinite(Number(minStatusCount)) ? Number(minStatusCount) : 1);
  const statusKey = String(targetStatus || '').trim().toLowerCase();
  if (statusKey === 'nominado' && Array.isArray(snapshot?.nominated)) {
    return snapshot.nominated.length >= minCount;
  }
  return lcdlfStatusRowsForMarket({
    snapshot,
    statusKey,
    cfg,
    marketOutcomes,
  }).length >= minCount;
}

function lcdlfStatusResolutionOpen(m, cfg = {}) {
  if (cfg?.closeOnStatus === true) return true;
  const endMs = new Date(m?.end_time).getTime();
  return Number.isFinite(endMs) && endMs <= Date.now();
}

function buildLcdlfStatusPatch({ cfg, row, snapshot, winningIdx }) {
  return {
    lcdlfStatusAtResolve: {
      residentName: row?.name || cfg?.residentName || null,
      residentSlug: row?.slug || cfg?.residentSlug || null,
      statusKey: row?.statusKey || null,
      statusLabel: row?.statusLabel || null,
      rawStatus: row?.rawStatus || null,
      url: row?.url || null,
      observedAt: snapshot?.observedAt || new Date().toISOString(),
      outcomeIndex: winningIdx,
    },
    evidenceUrl: row?.url || snapshot?.sourceUrl || cfg?.evidenceUrl || null,
  };
}

function finalScoreForLcdlfParallelStatus(legResolutions = [], statusKey = 'nominado') {
  const yesRows = legResolutions.filter(row => Number(row.outcomeIndex) === 0);
  const targetStatus = String(statusKey || '').trim().toLowerCase();
  if (yesRows.length === 0) {
    if (targetStatus === 'eliminado') return 'Sin eliminado oficial';
    return 'Sin nominados oficiales';
  }
  const names = yesRows.map(row => row.residentName || row.label).filter(Boolean);
  if (targetStatus === 'eliminado') return `Eliminado/a: ${names.join(', ')}`;
  return `Nominados: ${names.join(', ')}`;
}

function buildLcdlfParallelStatusPatch({ cfg, snapshot, legResolutions }) {
  const statusKey = cfg?.statusKey || 'nominado';
  const finalScore = finalScoreForLcdlfParallelStatus(legResolutions, statusKey);
  return {
    lcdlfParallelStatusAtResolve: {
      source: LCDLF_SOURCE,
      sourceEventId: cfg?.sourceEventId || null,
      statusKey,
      observedAt: snapshot?.observedAt || new Date().toISOString(),
      nominatedCount: Array.isArray(snapshot?.nominated) ? snapshot.nominated.length : null,
      statusCount: lcdlfRowsWithStatus(snapshot, statusKey).length,
      finalScore,
      legs: legResolutions.map(row => ({
        index: row.index,
        label: row.label || null,
        residentName: row.residentName || null,
        residentSlug: row.residentSlug || null,
        statusKey: row.statusKey || null,
        statusLabel: row.statusLabel || null,
        rawStatus: row.rawStatus || null,
        url: row.url || null,
        outcomeIndex: row.outcomeIndex,
      })),
    },
    evidenceUrl: snapshot?.sourceUrl || cfg?.evidenceUrl || null,
    finalScore,
  };
}

function buildLegacyLcdlfWeekStatusConfig({ cfg, sourceData, market, outcomes }) {
  const kind = String(sourceData?.kind || '').trim().toLowerCase();
  const sourceEventId = String(cfg?.sourceEventId || market?.source_event_id || '').trim();
  const isEliminationEvent = sourceEventId.startsWith('lcdlf-mx-elimination:')
    || kind === 'lcdlf_week'
    || /sale de la casa de los famosos/i.test(String(market?.question || ''));
  if (!isEliminationEvent) return null;
  if (!isLcdlfMarket({ cfg, row: market, sourceData })) return null;
  if (!Array.isArray(outcomes) || outcomes.length < 2) return null;

  const evidenceUrl = cfg?.evidenceUrl || sourceData?.snapshot?.sourceUrl || null;
  return {
    ...(cfg || {}),
    source: LCDLF_SOURCE,
    sourceEventId: sourceEventId || cfg?.sourceEventId || null,
    shape: 'parallel-status',
    statusKey: 'eliminado',
    yesOutcome: 0,
    noOutcome: 1,
    closeOnStatus: false,
    statusMinStatusCount: 1,
    legs: outcomes.map(label => ({
      label,
      residentName: label,
      residentSlug: null,
      statusKey: 'eliminado',
      evidenceUrl,
    })),
    evidenceUrl,
  };
}

async function queueNextMananeraPendingMarkets({ candidates, dry, report, now = new Date() }) {
  if (!Array.isArray(candidates) || !candidates.some(row => (
    isMananeraMarket({
      cfg: parseJsonb(row?.resolver_config, {}),
      row,
      sourceData: parseJsonb(row?.pending_source_data, {}),
    })
  ))) {
    return null;
  }

  const rawSpecs = await generateMananeraMarkets({ now });
  const specs = await prepareGeneratedSpecs(rawSpecs);
  const summary = {
    dryRun: dry,
    totalSpecs: specs.length,
    sourceEventIds: specs.map(spec => spec.source_event_id),
  };

  if (dry) {
    report.mananeraNextPending = summary;
    return summary;
  }

  const result = await upsertPending(schemaSql, specs);
  report.mananeraNextPending = {
    ...summary,
    ...result,
  };
  return report.mananeraNextPending;
}

function isEarlyTournamentLegSource(cfg = {}) {
  return cfg?.shape === 'parallel'
    && ['espn-atp-tournament', 'espn-pga'].includes(String(cfg?.source || ''));
}

function isComboWinCountConfig(cfg = {}) {
  return cfg?.source === 'espn'
    && cfg?.shape === 'combo-win-count'
    && Array.isArray(cfg?.legs)
    && cfg.legs.length > 0;
}

function comboRangeFromLabel(label) {
  const nums = String(label || '')
    .match(/\d+/g)
    ?.map(n => Number(n))
    .filter(Number.isFinite) || [];
  if (nums.length >= 2) return { minWins: Math.min(nums[0], nums[1]), maxWins: Math.max(nums[0], nums[1]) };
  if (nums.length === 1) return { minWins: nums[0], maxWins: nums[0] };
  return null;
}

function normalizeComboWinRange(range, label) {
  const minWins = Number(range?.minWins);
  const maxWins = Number(range?.maxWins);
  if (Number.isInteger(minWins) && Number.isInteger(maxWins) && minWins >= 0 && maxWins >= minWins) {
    return { minWins, maxWins };
  }
  return comboRangeFromLabel(range?.label || label);
}

function comboOutcomeRangeAt({ cfg, outcomes = [], index }) {
  const label = outcomes[index];
  const ranges = Array.isArray(cfg?.outcomeRanges) ? cfg.outcomeRanges : [];
  const byIndex = ranges[index] ? normalizeComboWinRange(ranges[index], label) : null;
  if (byIndex) return byIndex;
  const byLabel = ranges
    .map(range => (String(range?.label || '') === String(label || '') ? normalizeComboWinRange(range, label) : null))
    .find(Boolean);
  return byLabel || normalizeComboWinRange(null, label);
}

function comboRangeOverlaps(range, possibleMin, possibleMax) {
  return range && range.minWins <= possibleMax && range.maxWins >= possibleMin;
}

function comboRangeContains(range, possibleMin, possibleMax) {
  return range && range.minWins <= possibleMin && range.maxWins >= possibleMax;
}

function comboChildOutcomeForRange(range, progress) {
  if (!range || !progress) return null;
  if (!comboRangeOverlaps(range, progress.possibleMin, progress.possibleMax)) return 1;
  if (progress.allComplete) {
    return comboRangeContains(range, progress.wins, progress.wins) ? 0 : 1;
  }
  if (comboRangeContains(range, progress.possibleMin, progress.possibleMax)) return 0;
  return null;
}

function comboWinningOutcomeIndex({ cfg, outcomes = [], wins }) {
  const n = Number(wins);
  if (!Number.isInteger(n) || n < 0) return -1;
  for (let i = 0; i < outcomes.length; i++) {
    const range = comboOutcomeRangeAt({ cfg, outcomes, index: i });
    if (range && range.minWins <= n && n <= range.maxWins) return i;
  }
  return -1;
}

function inferComboTargetSide(leg = {}) {
  const explicit = String(leg.targetSide || '').trim().toLowerCase();
  if (explicit === 'home' || explicit === 'away') return explicit;
  if (leg.targetTeam && leg.homeName && resolverLabelsOverlap(leg.targetTeam, leg.homeName)) return 'home';
  if (leg.targetTeam && leg.awayName && resolverLabelsOverlap(leg.targetTeam, leg.awayName)) return 'away';
  return null;
}

async function readComboWinCountProgress(cfg = {}) {
  if (!isComboWinCountConfig(cfg)) {
    throw new Error('combo-win-count: missing cfg.legs');
  }

  const legs = [];
  for (let i = 0; i < cfg.legs.length; i++) {
    const leg = cfg.legs[i] || {};
    const targetSide = inferComboTargetSide(leg);
    const result = await readEspnEvent({
      leaguePath: leg.leaguePath || cfg.leaguePath,
      eventId: leg.eventId,
      dateYmd: leg.dateYmd || cfg.dateYmd,
      homeName: leg.homeName,
      awayName: leg.awayName,
    });
    if (result?.completed && !targetSide) {
      throw new Error(`combo-win-count missing targetSide for leg ${i}`);
    }
    const targetWon = result?.completed ? result.winner === targetSide : null;
    legs.push({
      index: i,
      label: leg.displayLabel || leg.label || leg.targetTeam || null,
      targetTeam: leg.targetTeam || null,
      targetSide,
      eventId: leg.eventId || null,
      completed: result?.completed === true,
      winner: result?.winner || null,
      targetWon,
      homeScore: result?.homeScore ?? null,
      awayScore: result?.awayScore ?? null,
      state: result?.state || null,
      notFound: result?.notFound === true,
    });
  }

  const wins = legs.filter(leg => leg.targetWon === true).length;
  const completedCount = legs.filter(leg => leg.completed).length;
  const pendingCount = legs.length - completedCount;
  const allComplete = pendingCount === 0;
  return {
    completed: allComplete,
    allComplete,
    wins,
    total: legs.length,
    completedCount,
    pendingCount,
    possibleMin: wins,
    possibleMax: wins + pendingCount,
    legs,
    state: allComplete ? 'post' : 'in',
  };
}

async function resolveComboWinCountChildLegs({ market, cfg, outcomes = [], progress, dry, report }) {
  if (!isComboWinCountConfig(cfg) || !progress) return 0;
  const decisions = outcomes
    .map((label, index) => ({
      index,
      label,
      range: comboOutcomeRangeAt({ cfg, outcomes, index }),
    }))
    .map(item => ({
      ...item,
      outcomeIndex: comboChildOutcomeForRange(item.range, progress),
    }))
    .filter(item => item.outcomeIndex === 0 || item.outcomeIndex === 1);

  if (decisions.length === 0) return 0;

  if (dry) {
    for (const decision of decisions) {
      report.resolved.push({
        id: market.id,
        parentId: market.id,
        legIndex: decision.index,
        legLabel: decision.label || null,
        winningIdx: decision.outcomeIndex,
        source: cfg.source,
        shape: cfg.shape,
        reason: decision.outcomeIndex === 0 ? 'combo_range_guaranteed' : 'combo_range_impossible',
        comboWins: progress.wins,
        comboPossibleMin: progress.possibleMin,
        comboPossibleMax: progress.possibleMax,
        dry: true,
      });
    }
    return decisions.length;
  }

  let resolvedCount = 0;
  await withTransaction(async (client) => {
    const legs = await client.query(
      `SELECT id, leg_label, status, outcome
         FROM points_markets
        WHERE parent_id = $1
          AND status <> 'canceled'
        ORDER BY id ASC
        FOR UPDATE`,
      [market.id],
    );
    if (legs.rows.length !== outcomes.length) {
      throw new Error(`combo_win_count_leg_count_mismatch: db=${legs.rows.length} cfg=${outcomes.length}`);
    }

    const targetIds = decisions
      .map(decision => legs.rows[decision.index])
      .filter(row => row && row.status === 'active')
      .map(row => Number(row.id))
      .filter(Number.isFinite);
    if (targetIds.length > 0) {
      await releaseOpenLimitOrdersForMarkets(client, targetIds, {
        reason: 'market_resolved',
      });
    }

    for (const decision of decisions) {
      const row = legs.rows[decision.index];
      if (!row?.id || row.status !== 'active') continue;
      const finalScore = decision.outcomeIndex === 0
        ? `${decision.label || row.leg_label || 'Rango'} confirmado: ${progress.wins}/${progress.total} ganaron`
        : `${decision.label || row.leg_label || 'Rango'} imposible: ${progress.possibleMin}-${progress.possibleMax} posibles`;
      const updated = await client.query(
        `UPDATE points_markets
            SET status = 'resolved',
                outcome = $1,
                resolved_at = NOW(),
                resolved_by = $2
          WHERE id = $3
            AND status = 'active'
          RETURNING id`,
        [decision.outcomeIndex, 'resolver:espn:combo-win-count', row.id],
      );
      if (updated.rows.length === 0) continue;
      resolvedCount += 1;
      try {
        await client.query(
          `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
          [finalScore.slice(0, 240), row.id],
        );
      } catch (e) {
        if (e?.code !== '42703') throw e;
      }
      report.resolved.push({
        id: row.id,
        parentId: market.id,
        legIndex: decision.index,
        legLabel: decision.label || row.leg_label || null,
        winningIdx: decision.outcomeIndex,
        source: cfg.source,
        shape: cfg.shape,
        reason: decision.outcomeIndex === 0 ? 'combo_range_guaranteed' : 'combo_range_impossible',
        comboWins: progress.wins,
        comboPossibleMin: progress.possibleMin,
        comboPossibleMax: progress.possibleMax,
      });
    }
  });

  return resolvedCount;
}

function labelIsOther(label) {
  return ['otro', 'otra', 'other', 'field'].includes(
    String(label || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim(),
  );
}

function competitorMatchesLeg(leg, competitor) {
  if (!leg || labelIsOther(leg?.label)) return false;
  const idNeedle = String(competitor?.driverId || '').trim();
  const labelNeedle = String(competitor?.label || '').trim();
  if (idNeedle && leg?.driverId && String(leg.driverId).trim() === idNeedle) return true;
  return Boolean(labelNeedle && resolverLabelsOverlap(leg?.label, labelNeedle));
}

function otherLegCoveredByNamedRemaining(legs = [], remaining = []) {
  const otherLeg = legs.find(leg => labelIsOther(leg?.label));
  if (!otherLeg || remaining.length < 2) return null;
  const namedLegs = legs.filter(leg => leg && !labelIsOther(leg.label));
  if (namedLegs.length === 0) return null;
  const hasUnmatchedRemaining = remaining.some(competitor => (
    !namedLegs.some(leg => competitorMatchesLeg(leg, competitor))
  ));
  if (hasUnmatchedRemaining) return null;
  return {
    driverId: null,
    label: otherLeg.label || 'Otro',
    reason: 'field_fully_covered',
  };
}

function eliminatedCompetitorsForLegs(legs = [], result = {}) {
  const explicit = Array.isArray(result?.eliminatedCompetitors)
    ? result.eliminatedCompetitors
    : [];
  const remaining = Array.isArray(result?.remainingCompetitors)
    ? result.remainingCompetitors
    : [];
  if (!Array.isArray(legs) || remaining.length < 2) return explicit;

  const out = [...explicit];
  for (const leg of legs) {
    if (!leg || labelIsOther(leg?.label)) continue;
    if (out.some(eliminated => competitorMatchesLeg(leg, eliminated))) continue;
    if (remaining.some(alive => competitorMatchesLeg(leg, alive))) continue;
    out.push({
      driverId: leg.driverId || null,
      label: leg.label || null,
      reason: 'not_in_remaining_draw',
    });
  }
  const coveredOther = otherLegCoveredByNamedRemaining(legs, remaining);
  if (coveredOther && !out.some(eliminated => labelIsOther(eliminated?.label))) {
    out.push(coveredOther);
  }
  return out;
}

function findEliminatedParallelLegIndexes(legs = [], result = {}) {
  if (!Array.isArray(legs)) return [];
  const eliminatedCompetitors = eliminatedCompetitorsForLegs(legs, result);
  if (eliminatedCompetitors.length === 0) return [];
  const indexes = new Set();

  for (const eliminated of eliminatedCompetitors) {
    const idNeedle = String(eliminated?.driverId || '').trim();
    const labelNeedle = String(eliminated?.label || '').trim();
    if (!idNeedle && !labelNeedle) continue;

    let idx = eliminated?.reason === 'field_fully_covered'
      ? legs.findIndex(leg => labelIsOther(leg?.label))
      : -1;

    if (idx < 0 && idNeedle) {
      idx = legs.findIndex(leg =>
        !labelIsOther(leg?.label)
        && leg?.driverId
        && String(leg.driverId).trim() === idNeedle,
      );
    }

    if (idx < 0 && labelNeedle) {
      idx = legs.findIndex(leg =>
        (eliminated?.reason === 'field_fully_covered' || !labelIsOther(leg?.label))
        && resolverLabelsOverlap(leg?.label, labelNeedle),
      );
    }

    if (idx >= 0) indexes.add(idx);
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

function findRemainingParallelLegIndexes(legs = [], result = {}) {
  if (!Array.isArray(legs)) return [];
  const remaining = Array.isArray(result?.remainingCompetitors)
    ? result.remainingCompetitors
    : [];
  if (remaining.length === 0) return [];
  const otherIndex = legs.findIndex(leg => labelIsOther(leg?.label));
  const indexes = new Set();

  for (const competitor of remaining) {
    const idNeedle = String(competitor?.driverId || '').trim();
    const labelNeedle = String(competitor?.label || '').trim();
    if (!idNeedle && !labelNeedle) continue;

    let idx = idNeedle
      ? legs.findIndex(leg =>
          !labelIsOther(leg?.label)
          && leg?.driverId
          && String(leg.driverId).trim() === idNeedle,
        )
      : -1;

    if (idx < 0 && labelNeedle) {
      idx = legs.findIndex(leg =>
        !labelIsOther(leg?.label)
        && resolverLabelsOverlap(leg?.label, labelNeedle),
      );
    }

    if (idx >= 0) indexes.add(idx);
    else if (otherIndex >= 0) indexes.add(otherIndex);
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

async function resolveEliminatedParallelLegs({ market, cfg, result, dry, report }) {
  if (!isEarlyTournamentLegSource(cfg)) return 0;
  const eliminatedCompetitors = eliminatedCompetitorsForLegs(cfg.legs, result);
  const indexes = findEliminatedParallelLegIndexes(cfg.legs, result);
  const remainingIndexes = findRemainingParallelLegIndexes(cfg.legs, result);
  if (indexes.length === 0 && remainingIndexes.length === 0) return 0;

  const detailsByIndex = new Map();
  for (const eliminated of eliminatedCompetitors) {
    const matchIndex = findEliminatedParallelLegIndexes(cfg.legs, {
      eliminatedCompetitors: [eliminated],
    })[0];
    if (Number.isInteger(matchIndex) && !detailsByIndex.has(matchIndex)) {
      detailsByIndex.set(matchIndex, eliminated);
    }
  }

  if (dry) {
    for (const index of indexes) {
      const leg = cfg.legs[index] || {};
      const detail = detailsByIndex.get(index) || {};
      report.resolved.push({
        id: market.id,
        parentId: market.id,
        legIndex: index,
        legLabel: leg.label || detail.label || null,
        winningIdx: 1,
        source: cfg.source,
        reason: `early_${detail.reason || 'eliminated'}`,
        dry: true,
      });
    }
    return indexes.length;
  }

  let resolvedCount = 0;
  await withTransaction(async (client) => {
    const legs = await client.query(
      `SELECT id, leg_label, status, outcome
         FROM points_markets
        WHERE parent_id = $1
          AND status <> 'canceled'
        ORDER BY id ASC
        FOR UPDATE`,
      [market.id],
    );
    for (const index of remainingIndexes) {
      const row = legs.rows[index];
      if (!row?.id || row.status !== 'resolved' || Number(row.outcome) !== 1) continue;
      const redeemed = await client.query(
        `SELECT id
           FROM points_trades
          WHERE market_id = $1
            AND side = 'redeem'
          LIMIT 1`,
        [row.id],
      );
      if (redeemed.rows.length > 0) {
        report.deferred.push({
          id: row.id,
          parentId: market.id,
          legIndex: index,
          legLabel: row.leg_label || null,
          reason: 'resolved_alive_leg_has_redemptions',
          source: cfg.source,
        });
        continue;
      }
      const reopened = await client.query(
        `UPDATE points_markets
            SET status = 'active',
                outcome = NULL,
                resolved_at = NULL,
                resolved_by = NULL,
                final_score = NULL
          WHERE id = $1
            AND status = 'resolved'
            AND outcome = 1
          RETURNING id`,
        [row.id],
      );
      if (reopened.rows.length > 0) {
        report.reopened.push({
          id: row.id,
          parentId: market.id,
          legIndex: index,
          legLabel: row.leg_label || null,
          source: cfg.source,
          reason: 'alive_in_remaining_draw',
        });
      }
    }

    const targetIds = indexes
      .map(index => legs.rows[index])
      .filter(row => row && row.status === 'active')
      .map(row => Number(row.id));
    if (!targetIds.length) return;

    await releaseOpenLimitOrdersForMarkets(client, targetIds, {
      reason: 'market_resolved',
    });

    for (const index of indexes) {
      const row = legs.rows[index];
      if (!row?.id) continue;
      const leg = cfg.legs[index] || {};
      const detail = detailsByIndex.get(index) || {};
      const reasonLabel = detail.reason === 'not_in_remaining_draw'
        ? 'Fuera del cuadro restante'
        : detail.reason === 'lost'
        ? 'Eliminado'
        : detail.reason === 'field_fully_covered'
        ? 'Campo restante cubierto por opciones nombradas'
        : detail.reason || 'Eliminado';
      const finalScore = `${reasonLabel}: ${detail.label || leg.label || row.leg_label || 'opcion'}`;
      const updated = await client.query(
        `UPDATE points_markets
            SET status = 'resolved',
                outcome = 1,
                resolved_at = NOW(),
                resolved_by = $1
          WHERE id = $2
            AND status = 'active'
          RETURNING id`,
        [`resolver:${cfg.source}:early-elimination`, row.id],
      );
      if (updated.rows.length === 0) continue;
      resolvedCount += 1;
      try {
        await client.query(
          `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
          [finalScore.slice(0, 240), row.id],
        );
      } catch (e) {
        if (e?.code !== '42703') throw e;
      }
      report.resolved.push({
        id: row.id,
        parentId: market.id,
        legIndex: index,
        legLabel: leg.label || row.leg_label || detail.label || null,
        winningIdx: 1,
        source: cfg.source,
        reason: `early_${detail.reason || 'eliminated'}`,
      });
    }
  });

  return resolvedCount;
}

async function enrichManualReviewCandidate({ market, cfg, sourceData, outcomes }) {
  if (isNetflixTop10Market({ cfg, row: market, sourceData })) {
    try {
      const review = await buildNetflixTop10ResolutionReview({
        market,
        cfg,
        sourceData,
        outcomes,
      });
      return {
        cfg: {
          ...(cfg || {}),
          ...(review?.resolverConfigPatch || {}),
        },
        sourceData: {
          ...(sourceData || {}),
          ...(review?.sourceDataPatch || {}),
        },
      };
    } catch (e) {
      const errorCode = typeof e?.code === 'string' ? e.code : null;
      const reason = errorCode === 'netflix_top10_not_published_yet'
        ? 'Netflix Top 10 todavía no publicó una semana posterior a la que se usó para crear el mercado.'
        : errorCode === 'netflix_top10_timeout'
        ? 'La descarga de Netflix Top 10 tardó demasiado; el resolver lo intentará de nuevo en la siguiente corrida.'
        : `No se pudo leer o interpretar Netflix Top 10: ${e?.message || 'error desconocido'}.`;
      return {
        cfg: {
          ...(cfg || {}),
          source: NETFLIX_TOP10_SOURCE,
          suggestedOutcomeIndex: null,
          confidenceBps: 0,
          evidenceUrl: NETFLIX_TOP10_PAGE,
          evidence: cfg?.evidence || [{ title: 'Netflix Top 10', url: NETFLIX_TOP10_PAGE }],
          rationale: `${reason} Requiere revisión manual antes de pagar MXNP.`,
        },
        sourceData: {
          ...(sourceData || {}),
          netflixTop10ResolutionError: errorCode || e?.message || 'unknown',
        },
      };
    }
  }

  if (!isLcdlfMarket({ cfg, row: market, sourceData })) {
    return { cfg, sourceData };
  }

  try {
    const review = await buildLcdlfResolutionReview({
      market,
      cfg,
      sourceData,
      outcomes,
    });
    return {
      cfg: {
        ...(cfg || {}),
        ...(review?.resolverConfigPatch || {}),
      },
      sourceData: {
        ...(sourceData || {}),
        ...(review?.sourceDataPatch || {}),
      },
    };
  } catch (e) {
    return {
      cfg: {
        ...(cfg || {}),
        source: 'lcdlf-official',
        suggestedOutcomeIndex: null,
        confidenceBps: 0,
        rationale: `No se pudo leer el sitio oficial de La Casa de los Famosos México: ${e?.message || 'error desconocido'}. Requiere revisión manual antes de pagar MXNP.`,
      },
      sourceData: {
        ...(sourceData || {}),
        lcdlfResolutionError: e?.message || 'unknown',
      },
    };
  }
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
 * but if that tick is missed, this loop resolves active rows and
 * recovers expired pending rows with Coinbase boundary candles.
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
      LEFT JOIN points_resolver_checkpoints noc
        ON noc.market_id = m.id
       AND noc.checkpoint_key = 'next-opponent'
      WHERE m.status = 'active'
        AND m.end_time IS NOT NULL
        AND m.parent_id IS NULL
        AND (
          (
            m.resolver_type IN ('chainlink_price', 'api_price', 'weather_api', 'aicm_delay_count', 'aicm_delay_minutes_live', 'api_chart', 'api_transcript', 'api_lcdlf', 'sports_api')
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
                  COALESCE(
                    noc.last_checked_at,
                    NULLIF(m.resolver_config->>'nextOpponentLastCheckedAt', '')::timestamptz
                  ) IS NULL
                  OR COALESCE(
                    noc.last_checked_at,
                    NULLIF(m.resolver_config->>'nextOpponentLastCheckedAt', '')::timestamptz
                  )
                       < NOW() - (${NEXT_OPPONENT_RECHECK_INTERVAL_HOURS}::int * INTERVAL '1 hour')
                )
              )
              OR (
                m.resolver_type = 'sports_api'
                AND m.resolver_config->>'shape' = 'parallel'
                AND m.resolver_config->>'source' IN ('espn-atp-tournament', 'espn-pga')
                AND m.start_time IS NOT NULL
                AND m.start_time < NOW()
                AND m.end_time > NOW()
              )
              OR (
                m.resolver_type = 'sports_api'
                AND m.resolver_config->>'source' = 'espn'
                AND m.resolver_config->>'shape' = 'combo-win-count'
                AND m.start_time IS NOT NULL
                AND m.start_time < NOW() - INTERVAL '90 minutes'
                AND m.end_time > NOW()
              )
              OR (
                m.resolver_type = 'api_lcdlf'
                AND m.resolver_config->>'shape' IN ('binary-status', 'parallel-status')
                AND LOWER(COALESCE(m.resolver_config->>'closeOnStatus', 'false')) = 'true'
                AND m.start_time IS NOT NULL
                AND m.start_time < NOW()
                AND m.end_time > NOW()
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
                  m.source IN ('entertainment', 'codex-entertainment', 'codex-premios-juventud-2026', 'manual-international-politics')
                  OR m.category = 'musica'
                  OR pm.source_data->>'kind' IN ('award', 'reality_week', 'reality_winner', 'concert', 'netflix_top10', 'granja_vip_week')
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
      reopened: [],
      errors: [],
      deferred: [],
      dryRun: dry,
    };

    try {
      await queueNextMananeraPendingMarkets({ candidates, dry, report });
    } catch (e) {
      report.errors.push({
        error: `mananera_next_pending_failed: ${e?.message || 'unknown'}`,
      });
    }

    try {
      const cryptoActiveCatchup = await catchUpExpiredActiveCryptoMarkets(schemaSql, {
        dry,
        limit: MAX_BINARY_DIRECTION_CATCHUP_PER_RUN,
      });
      report.cryptoActiveCatchup = cryptoActiveCatchup;
      report.checked += cryptoActiveCatchup.checked;
      for (const row of cryptoActiveCatchup.resolved || []) {
        report.resolved.push({
          id: row.id,
          winningIdx: row.outcome,
          finalScore: row.finalScore,
          source: 'crypto-5min-missed-active',
          asset: row.asset,
        });
      }
      for (const err of cryptoActiveCatchup.errors || []) {
        report.errors.push({
          id: err.id,
          error: `crypto_active_catchup_failed: ${err.error}`,
        });
      }
    } catch (e) {
      report.errors.push({
        error: `crypto_active_catchup_failed: ${e?.message || 'unknown'}`,
      });
    }

    try {
      const cryptoPendingCatchup = await catchUpMissedPendingCryptoMarkets(schemaSql, {
        dry,
        limit: MAX_BINARY_DIRECTION_CATCHUP_PER_RUN,
      });
      report.cryptoPendingCatchup = cryptoPendingCatchup;
      report.checked += cryptoPendingCatchup.checked;
      for (const row of cryptoPendingCatchup.resolved || []) {
        report.resolved.push({
          id: row.id,
          winningIdx: row.outcome,
          finalScore: row.finalScore,
          source: 'crypto-5min-missed-pending',
          asset: row.asset,
        });
      }
      for (const err of cryptoPendingCatchup.errors || []) {
        report.errors.push({
          id: err.id,
          error: `crypto_pending_catchup_failed: ${err.error}`,
        });
      }
    } catch (e) {
      report.errors.push({
        error: `crypto_pending_catchup_failed: ${e?.message || 'unknown'}`,
      });
    }

    try {
      const generatedHiddenFromHome = dry ? false : await readGeneratedCryptoHiddenFromHome(schemaSql);
      const cryptoActivationCatchup = await catchUpCurrentPendingCryptoMarkets(schemaSql, {
        dry,
        hiddenFromHome: generatedHiddenFromHome,
      });
      report.cryptoActivationCatchup = cryptoActivationCatchup;
      report.checked += cryptoActivationCatchup.checked;
      for (const err of cryptoActivationCatchup.errors || []) {
        report.errors.push({
          error: `crypto_activation_catchup_failed: ${err.error}`,
          sourceEventId: err.sourceEventId,
        });
      }
    } catch (e) {
      report.errors.push({
        error: `crypto_activation_catchup_failed: ${e?.message || 'unknown'}`,
      });
    }

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
      const legacyLcdlfWeekStatusCfg = buildLegacyLcdlfWeekStatusConfig({
        cfg,
        sourceData,
        market: m,
        outcomes: marketOutcomes,
      });
      if (legacyLcdlfWeekStatusCfg) {
        cfg = legacyLcdlfWeekStatusCfg;
        resolverType = 'api_lcdlf';
      }
      if (isManualReviewMarket({ resolverType, cfg, row: m, sourceData })) {
        try {
          const enriched = await enrichManualReviewCandidate({
            market: m,
            cfg,
            sourceData,
            outcomes: marketOutcomes,
          });
          await queueManualReviewCandidate({
            market: m,
            cfg: enriched.cfg,
            sourceData: enriched.sourceData,
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
      let independentLegResolutions = null;
      let result = null;
      let manualReviewCandidate = null;
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
            const closesAt = cfg.closesAt || m.end_time;
            let price;
            let roundUpdatedAt = null;
            if (closesAt) {
              const round = await readChainlinkRoundAtOrBefore({
                feedAddress: cfg.feedAddress,
                chainId: cfg.chainId,
                timestamp: closesAt,
              });
              price = round.price;
              roundUpdatedAt = Number.isFinite(Number(round.updatedAt))
                ? new Date(Number(round.updatedAt) * 1000).toISOString()
                : null;
              resolverConfigPatch = {
                closePrice: round.price,
                resolvedRoundId: round.roundId?.toString?.() || String(round.roundId),
                resolvedRoundUpdatedAt: roundUpdatedAt,
              };
            } else {
              price = await readChainlinkPrice({
                feedAddress: cfg.feedAddress,
                chainId: cfg.chainId,
              });
            }
            const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
            const yesIdx = Number(cfg.yesOutcome);
            winningIdx = yes ? yesIdx : (1 - yesIdx);
            resolverInfo = {
              priceAtResolve: price,
              op: cfg.op,
              threshold: cfg.threshold,
              source: cfg.symbol || 'chainlink',
              roundUpdatedAt,
            };
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
            const targetDateYmd = banxicoFixTargetDateYmd({
              resolverConfig: cfg,
              sourceData,
              endTime: m.end_time,
            });
            const latestDateYmd = banxicoFechaToYmd(r.fecha);
            if (targetDateYmd && latestDateYmd !== targetDateYmd) {
              const err = new Error(`banxico_fix_not_published_for_${targetDateYmd}`);
              err.benign = true;
              err.info = {
                source: cfg.source,
                seriesId: cfg.seriesId,
                expectedDateYmd: targetDateYmd,
                latestDateYmd,
                latestFecha: r.fecha,
              };
              throw err;
            }
            price = r.value;
            readerInfo = { seriesId: cfg.seriesId, fecha: r.fecha, targetDateYmd };
          } else if (cfg.source === FRANKFURTER_SOURCE) {
            if (!cfg.base) throw new Error('frankfurter: missing base');
            const targetDateYmd = frankfurterTargetDateYmd({
              resolverConfig: cfg,
              sourceData,
              endTime: m.end_time,
            });
            const r = await readFrankfurterRate({
              base: cfg.base,
              quote: cfg.quote || 'MXN',
              dateYmd: targetDateYmd,
            });
            if (targetDateYmd && r.date !== targetDateYmd) {
              const err = new Error(`frankfurter_not_published_for_${targetDateYmd}`);
              err.benign = true;
              err.info = {
                source: cfg.source,
                base: cfg.base,
                quote: cfg.quote || 'MXN',
                expectedDateYmd: targetDateYmd,
                latestDateYmd: r.date,
              };
              throw err;
            }
            price = r.value;
            readerInfo = {
              pair: cfg.pair || `${r.base}/${r.quote}`,
              base: r.base,
              quote: r.quote,
              date: r.date,
              targetDateYmd,
            };
          } else if (cfg.source === 'cre-gasolina') {
            if (!cfg.fuelType) throw new Error('cre-gasolina: missing fuelType');
            const r = await readCreAverageFor(cfg.fuelType);
            price = r.value;
            readerInfo = { fuelType: cfg.fuelType, sampleSize: r.sampleSize };
          } else if (cfg.source === COINGECKO_TOKEN_MCAP_SOURCE) {
            const resolved = await resolveSolanaTokenMcapOutcome({
              sql: readSql,
              marketId: m.id,
              resolverConfig: cfg,
              endTime: m.end_time,
            });
            price = resolved.price;
            readerInfo = resolved.readerInfo;
            resolverConfigPatch = resolved.resolverConfigPatch;
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
          if (cfg.resolutionSource === 'open-meteo-archive') {
            const reviewDeltaC = Number(cfg.manualReviewDeltaC);
            const weather = await resolveObservedWeatherMaxTempC({
              lat: cfg.lat,
              lng: cfg.lng,
              dateYmd: cfg.forecastDateYmd,
              timezone: cfg.timezone,
              buckets: cfg.buckets,
              mismatchThresholdC: Number.isFinite(reviewDeltaC)
                ? reviewDeltaC
                : WEATHER_MODEL_AUDIT_THRESHOLD_C,
            });
            winningIdx = weather.winningIdx;
            resolverInfo = {
              ...weather.resolverInfo,
              finalScore: weather.finalScore,
            };
            resolverConfigPatch = weather.resolverConfigPatch;
            if (weather.requiresManualReview) {
              manualReviewCandidate = buildWeatherManualReviewCandidate({
                market: m,
                cfg,
                resolverInfo,
                outcomes: marketOutcomes,
                winningIdx,
              });
            }
          } else {
            const tempC = await fetchMaxTempC({
              lat: cfg.lat,
              lng: cfg.lng,
              dateYmd: cfg.forecastDateYmd,
              timezone: cfg.timezone,
            });
            // Bucket match — prefer the config's own ranges over the
            // library's defaults so regenerated buckets don't desync.
            winningIdx = weatherBucketIndexFor(tempC, cfg.buckets);
            if (winningIdx < 0) winningIdx = bucketIndexFor(tempC); // fallback
            if (winningIdx < 0) throw new Error(`temp ${tempC}°C didn't fit any bucket`);
            resolverInfo = {
              recordedMaxC: tempC,
              source: 'open-meteo-forecast',
              forecastDateYmd: cfg.forecastDateYmd,
            };
          }
        } else if (resolverType === 'aicm_delay_count') {
          if (!cfg.fromDateYmd || !cfg.toDateYmd || !Array.isArray(cfg.buckets)) {
            throw new Error('invalid aicm_delay_count config');
          }
          const countResult = await readAicmDelayCount(readSql, {
            fromDateYmd: cfg.fromDateYmd,
            toDateYmd: cfg.toDateYmd,
            direction: cfg.direction || 'departure',
            statusNorm: cfg.statusNorm || 'delayed',
          });
          const minObservedPolls = Number(cfg.minObservedPolls ?? 1);
          const minObservedFlights = Number(cfg.minObservedFlights ?? 1);
          const okPolls = Number(countResult.okPollCount || 0);
          const observedFlights = Number(countResult.flightsWithAnyStatus || 0);
          if (okPolls < minObservedPolls || observedFlights < minObservedFlights) {
            const err = new Error('aicm_oracle_observations_not_ready');
            err.benign = true;
            err.info = {
              source: cfg.source || countResult.source,
              fromDateYmd: cfg.fromDateYmd,
              toDateYmd: cfg.toDateYmd,
              okPollCount: okPolls,
              minObservedPolls,
              flightsWithAnyStatus: observedFlights,
              minObservedFlights,
              lastPollObservedAt: countResult.lastPollObservedAt || null,
            };
            throw err;
          }
          winningIdx = aicmDelayBucketIndexFor(countResult.count, cfg.buckets);
          if (winningIdx < 0) {
            throw new Error(`AICM delay count ${countResult.count} did not fit any bucket`);
          }
          result = { completed: true, ...countResult };
          resolverInfo = {
            ...countResult,
            source: cfg.source || countResult.source,
            shape: cfg.shape || 'delay-bucket',
            window: cfg.window || null,
          };
        } else if (resolverType === 'aicm_delay_minutes_live') {
          if (!cfg.fromDateYmd || !cfg.toDateYmd || !Array.isArray(cfg.buckets)) {
            throw new Error('invalid aicm_delay_minutes_live config');
          }
          if (cfg.resolveAfterUtc && Date.now() < new Date(cfg.resolveAfterUtc).getTime()) {
            const err = new Error('aicm_live_window_still_settling');
            err.benign = true;
            err.info = { source: cfg.source, resolveAfterUtc: cfg.resolveAfterUtc };
            throw err;
          }
          const countResult = await readAicmTimetableDelayCount(readSql, {
            fromDateYmd: cfg.fromDateYmd,
            toDateYmd: cfg.toDateYmd,
            thresholdMinutes: cfg.thresholdMinutes,
            direction: cfg.direction || 'departure',
          });
          const expectedDays = countAicmAeDaysInclusive(cfg.fromDateYmd, cfg.toDateYmd);
          const minOkPolls = Number(cfg.minOkPolls ?? 1);
          const minOperatorFlights = Number(cfg.minOperatorFlights ?? 0);
          if (
            countResult.daysCovered < expectedDays
            || countResult.okPollCount < minOkPolls
            || countResult.operatorFlights < minOperatorFlights
          ) {
            const err = new Error('aicm_live_observations_not_ready');
            err.benign = true;
            err.info = {
              source: countResult.source,
              expectedDays,
              daysCovered: countResult.daysCovered,
              okPollCount: countResult.okPollCount,
              minOkPolls,
              operatorFlights: countResult.operatorFlights,
              minOperatorFlights,
            };
            throw err;
          }
          winningIdx = aicmAeBucketIndexFor(countResult.count, cfg.buckets);
          if (winningIdx < 0) {
            throw new Error(`AICM live delay count ${countResult.count} did not fit any bucket`);
          }
          result = { completed: true, ...countResult };
          resolverInfo = {
            ...countResult,
            shape: cfg.shape || 'delay-bucket',
            window: cfg.window || null,
          };
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
        } else if (resolverType === 'api_transcript') {
          let storedTranscript = null;
          if (cfg.dateYmd) {
            try {
              storedTranscript = await readStoredMananeraTranscript(readSql, cfg.dateYmd);
            } catch (cacheErr) {
              console.warn('[points-auto-resolve] mañanera transcript cache read failed', {
                dateYmd: cfg.dateYmd,
                message: cacheErr?.message,
                code: cacheErr?.code,
              });
            }
          }
          const transcript = await readMananeraPhraseResult(cfg, { storedTranscript });
          if (!transcript.ready) {
            const err = new Error(transcript.reason || 'official_transcript_not_ready');
            err.benign = true;
            err.info = {
              source: cfg.source,
              dateYmd: cfg.dateYmd || null,
              searchUrl: transcript.searchUrl || null,
              fallbackReason: transcript.fallbackReason || null,
              officialFetchAttempts: transcript.officialFetchAttempts || [],
              youtubeSearchUrl: transcript.youtubeSearchUrl || null,
              youtubeVideoUrl: transcript.youtubeVideoUrl || null,
              youtubeTranscriptTitle: transcript.youtubeTranscriptTitle || null,
              youtubeCaptionAttempts: transcript.youtubeCaptionAttempts || [],
            };
            throw err;
          }
          winningIdx = transcript.outcomeIndex;
          resolverInfo = {
            source: cfg.source,
            transcriptSource: transcript.transcriptSource,
            phrase: transcript.phrase,
            matchCount: transcript.count,
            op: transcript.op,
            threshold: transcript.threshold,
            transcriptUrl: transcript.transcriptUrl,
            transcriptTitle: transcript.transcriptTitle,
            videoId: transcript.videoId || null,
            channelTitle: transcript.channelTitle || null,
            captionLanguage: transcript.captionLanguage || null,
            captionKind: transcript.captionKind || null,
            firstMatchTimestamp: transcript.firstMatchTimestamp || null,
            firstMatchUrl: transcript.firstMatchUrl || null,
            requiredMatchTimestamps: transcript.requiredMatchTimestamps || [],
            matchTimestamps: transcript.matchTimestamps || [],
            requiredMatchPositions: transcript.requiredMatchPositions || [],
            matchPositions: transcript.matchPositions || [],
            timestampEvidenceUnavailableReason: transcript.timestampEvidenceUnavailableReason || null,
          };
          resolverConfigPatch = {
            transcriptUrl: transcript.transcriptUrl,
            transcriptTitle: transcript.transcriptTitle,
            transcriptSource: transcript.transcriptSource,
            transcriptMatchCount: transcript.count,
            transcriptObservedAt: transcript.observedAt,
            transcriptVideoId: transcript.videoId || null,
            transcriptChannelTitle: transcript.channelTitle || null,
            transcriptCaptionLanguage: transcript.captionLanguage || null,
            transcriptCaptionKind: transcript.captionKind || null,
            transcriptFirstMatchSeconds: transcript.firstMatchSeconds ?? null,
            transcriptFirstMatchTimestamp: transcript.firstMatchTimestamp || null,
            transcriptFirstMatchUrl: transcript.firstMatchUrl || null,
            transcriptRequiredMatchTimestamps: transcript.requiredMatchTimestamps || [],
            transcriptMatchTimestamps: transcript.matchTimestamps || [],
            transcriptRequiredMatchPositions: transcript.requiredMatchPositions || [],
            transcriptMatchPositions: transcript.matchPositions || [],
            transcriptTimestampEvidenceUnavailableReason: transcript.timestampEvidenceUnavailableReason || null,
          };
        } else if (resolverType === 'api_lcdlf') {
          if (cfg.source !== LCDLF_SOURCE || !cfg.statusKey) {
            throw new Error('invalid api_lcdlf config');
          }
          const snapshot = await readLcdlfOfficialSnapshot();
          if (!snapshot?.ok) {
            const err = new Error(snapshot?.error || 'lcdlf_status_not_ready');
            err.benign = true;
            err.info = {
              source: LCDLF_SOURCE,
              parsedCount: snapshot?.parsedCount ?? null,
              total: snapshot?.total ?? null,
            };
            throw err;
          }

          const targetStatus = String(cfg.statusKey || '').trim().toLowerCase();
          const yesOutcome = Number.isInteger(Number(cfg.yesOutcome)) ? Number(cfg.yesOutcome) : 0;
          const noOutcome = Number.isInteger(Number(cfg.noOutcome)) ? Number(cfg.noOutcome) : 1;
          const statusMinRaw = Number.isFinite(Number(cfg.statusMinStatusCount))
            ? Number(cfg.statusMinStatusCount)
            : Number(cfg.nominationMinStatusCount);
          const statusMinStatusCount = Math.max(
            1,
            Number.isFinite(statusMinRaw)
              ? statusMinRaw
              : (targetStatus === 'nominado' ? 2 : 1),
          );
          const targetStatusRows = lcdlfStatusRowsForMarket({
            snapshot,
            statusKey: targetStatus,
            cfg,
            marketOutcomes,
          });
          const targetRoundPosted = lcdlfStatusRoundPosted({
            snapshot,
            targetStatus,
            cfg,
            marketOutcomes,
            minStatusCount: statusMinStatusCount,
          });
          const marketClosed = new Date(m.end_time).getTime() <= Date.now();
          const statusResolutionOpen = lcdlfStatusResolutionOpen(m, cfg);
          const statusReadyInfo = (extra = {}) => ({
            source: LCDLF_SOURCE,
            targetStatus,
            statusCount: targetStatusRows.length,
            statusMinStatusCount,
            closeOnStatus: cfg.closeOnStatus === true,
            marketClosed,
            statusResolutionOpen,
            nominatedCount: Array.isArray(snapshot.nominated) ? snapshot.nominated.length : null,
            observedAt: snapshot.observedAt,
            ...extra,
          });
          const throwStatusNotReady = (extra = {}) => {
            const err = new Error('lcdlf_status_not_marked_yet');
            err.benign = true;
            err.info = statusReadyInfo(extra);
            throw err;
          };

          if (cfg.shape === 'binary-status') {
            const row = findLcdlfStatusRow(snapshot, cfg);
            if (!row) {
              const err = new Error('lcdlf_resident_not_found');
              err.benign = true;
              err.info = {
                source: LCDLF_SOURCE,
                residentName: cfg.residentName || null,
                residentSlug: cfg.residentSlug || null,
                parsedCount: snapshot.parsedCount,
              };
              throw err;
            }

            if (!statusResolutionOpen || !targetRoundPosted) {
              throwStatusNotReady({
                shape: cfg.shape,
                residentName: row.name,
                residentSlug: row.slug,
                statusKey: row.statusKey || null,
                statusLabel: row.statusLabel || null,
              });
            }

            const isTargetStatus = String(row.statusKey || '').trim().toLowerCase() === targetStatus;
            if (isTargetStatus) {
              winningIdx = yesOutcome;
            } else {
              winningIdx = noOutcome;
            }

            resolverInfo = {
              source: LCDLF_SOURCE,
              shape: cfg.shape,
              residentName: row.name || cfg.residentName || null,
              residentSlug: row.slug || cfg.residentSlug || null,
              statusKey: row.statusKey || null,
              statusLabel: row.statusLabel || null,
              observedAt: snapshot.observedAt,
              sourceUrl: row.url || snapshot.sourceUrl,
              targetStatus,
              statusCount: targetStatusRows.length,
              statusMinStatusCount,
            };
            resolverConfigPatch = buildLcdlfStatusPatch({
              cfg,
              row,
              snapshot,
              winningIdx,
            });
          } else if (cfg.shape === 'parallel-status') {
            const resolverLegs = Array.isArray(cfg.legs) && cfg.legs.length > 0
              ? cfg.legs
              : marketOutcomes.map((label) => ({
                  label,
                  residentName: label,
                  residentSlug: null,
                  statusKey: targetStatus,
                }));
            if (resolverLegs.length !== marketOutcomes.length) {
              throw new Error('lcdlf_parallel_status_leg_mismatch');
            }

            if (!statusResolutionOpen || !targetRoundPosted) {
              throwStatusNotReady({
                shape: cfg.shape,
              });
            }

            const legResolutions = [];
            for (let i = 0; i < resolverLegs.length; i++) {
              const leg = resolverLegs[i] || {};
              const label = leg.label || marketOutcomes[i] || `Opción ${i + 1}`;
              const row = findLcdlfStatusRow(snapshot, {
                residentName: leg.residentName || label,
                residentSlug: leg.residentSlug || null,
              });
              if (!row) {
                const err = new Error('lcdlf_resident_not_found');
                err.benign = true;
                err.info = {
                  source: LCDLF_SOURCE,
                  shape: cfg.shape,
                  legIndex: i,
                  residentName: leg.residentName || label,
                  residentSlug: leg.residentSlug || null,
                  parsedCount: snapshot.parsedCount,
                };
                throw err;
              }
              const legTargetStatus = String(leg.statusKey || targetStatus).trim().toLowerCase();
              const isTargetStatus = String(row.statusKey || '').trim().toLowerCase() === legTargetStatus;
              if (isTargetStatus) {
                legResolutions.push({
                  index: i,
                  label,
                  residentName: row.name || leg.residentName || label,
                  residentSlug: row.slug || leg.residentSlug || null,
                  statusKey: row.statusKey || null,
                  statusLabel: row.statusLabel || null,
                  rawStatus: row.rawStatus || null,
                  url: row.url || null,
                  outcomeIndex: yesOutcome,
                });
              } else {
                legResolutions.push({
                  index: i,
                  label,
                  residentName: row.name || leg.residentName || label,
                  residentSlug: row.slug || leg.residentSlug || null,
                  statusKey: row.statusKey || null,
                  statusLabel: row.statusLabel || null,
                  rawStatus: row.rawStatus || null,
                  url: row.url || null,
                  outcomeIndex: noOutcome,
                });
              }
            }

            independentLegResolutions = legResolutions;
            resolverInfo = {
              source: LCDLF_SOURCE,
              shape: cfg.shape,
              targetStatus,
              observedAt: snapshot.observedAt,
              sourceUrl: snapshot.sourceUrl,
              nominatedCount: Array.isArray(snapshot.nominated) ? snapshot.nominated.length : null,
              statusCount: targetStatusRows.length,
              statusMinStatusCount,
              yesCount: legResolutions.filter(row => Number(row.outcomeIndex) === yesOutcome).length,
            };
            resolverConfigPatch = buildLcdlfParallelStatusPatch({
              cfg,
              snapshot,
              legResolutions,
            });
          } else {
            throw new Error('invalid api_lcdlf config');
          }
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
            if (cfg.shape === 'combo-win-count') {
              result = await readComboWinCountProgress(cfg);
            } else {
              result = await readEspnEvent({
                leaguePath: cfg.leaguePath,
                eventId: cfg.eventId,
                dateYmd: cfg.dateYmd,
                homeName: cfg.homeName,
                awayName: cfg.awayName,
              });
            }
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
          } else if (cfg.source === 'espn-atp-match') {
            result = await readEspnAtpMatchWinner({
              eventId: cfg.eventId,
              matchId: cfg.matchId,
            });
          } else {
            throw new Error(`unsupported sports_api source: ${cfg.source}`);
          }

          await resolveEliminatedParallelLegs({
            market: m,
            cfg,
            result,
            dry,
            report,
          });
          await resolveComboWinCountChildLegs({
            market: m,
            cfg,
            outcomes: marketOutcomes,
            progress: result,
            dry,
            report,
          });

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
          } else if (cfg.shape === 'combo-win-count') {
            winningIdx = comboWinningOutcomeIndex({
              cfg,
              outcomes: marketOutcomes,
              wins: result.wins,
            });
            if (winningIdx < 0) {
              throw new Error(`combo-win-count got unmatched wins total: ${result.wins}`);
            }
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
            comboWins: cfg.shape === 'combo-win-count' ? result.wins ?? null : null,
            comboTotal: cfg.shape === 'combo-win-count' ? result.total ?? null : null,
            comboCompleted: cfg.shape === 'combo-win-count' ? result.completedCount ?? null : null,
            comboPending: cfg.shape === 'combo-win-count' ? result.pendingCount ?? null : null,
            comboLegs: cfg.shape === 'combo-win-count'
              ? (Array.isArray(result.legs) ? result.legs : [])
              : null,
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
                INSERT INTO points_resolver_checkpoints (
                  market_id, checkpoint_key, last_checked_at, metadata, updated_at
                )
                VALUES (
                  ${m.id},
                  'next-opponent',
                  ${checkedAt}::timestamptz,
                  ${JSON.stringify({
                    reason: e.message || 'deferred',
                    source: cfg.source || null,
                    state: e.info?.state || null,
                    notFound: e.info?.notFound === true,
                  })}::jsonb,
                  NOW()
                )
                ON CONFLICT (market_id, checkpoint_key) DO UPDATE
                  SET last_checked_at = EXCLUDED.last_checked_at,
                      metadata = EXCLUDED.metadata,
                      updated_at = NOW()
                  WHERE points_resolver_checkpoints.last_checked_at IS DISTINCT FROM EXCLUDED.last_checked_at
                     OR points_resolver_checkpoints.metadata IS DISTINCT FROM EXCLUDED.metadata
              `;
              deferred.nextOpponentLastCheckedAt = checkedAt;
              deferred.nextOpponentCheckpoint = 'points_resolver_checkpoints';
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

      if (manualReviewCandidate) {
        try {
          await queueManualReviewCandidate({
            market: m,
            cfg: manualReviewCandidate,
            sourceData: {
              ...sourceData,
              resolverInfo,
            },
            outcomes: marketOutcomes,
            dry,
            report,
          });
        } catch (e) {
          report.errors.push({ id: m.id, error: `weather_manual_review_queue_failed: ${e.message}` });
        }
        continue;
      }

      if (Array.isArray(independentLegResolutions)) {
        const finalScore = resolverConfigPatch?.finalScore
          || finalScoreForLcdlfParallelStatus(independentLegResolutions, cfg?.statusKey);
        const legAudit = independentLegResolutions.map(row => ({
          index: row.index,
          label: row.label,
          residentName: row.residentName,
          residentSlug: row.residentSlug,
          outcomeIndex: row.outcomeIndex,
          statusKey: row.statusKey,
          statusLabel: row.statusLabel,
        }));
        if (dry) {
          report.resolved.push({
            id: m.id,
            finalScore,
            legResolutions: legAudit,
            ...resolverInfo,
            dry: true,
          });
          continue;
        }

        try {
          await withTransaction(async (client) => {
            const legs = await client.query(
              `SELECT id FROM points_markets
                 WHERE parent_id = $1
                   AND status <> 'canceled'
                 ORDER BY id ASC
                 FOR UPDATE`,
              [m.id],
            );
            if (legs.rows.length !== independentLegResolutions.length) {
              throw new Error(`lcdlf_parallel_leg_count_mismatch: db=${legs.rows.length} cfg=${independentLegResolutions.length}`);
            }
            const legIds = legs.rows.map(row => Number(row.id)).filter(Number.isFinite);
            await bestEffortPersistTopHolderSnapshot(
              client,
              m.id,
              'cron/points-auto-resolve',
              {
                resolution: {
                  independentLegOutcomes: independentLegResolutions.map(row => Number(row.outcomeIndex)),
                },
              },
            );
            await releaseOpenLimitOrdersForMarkets(client, [m.id, ...legIds], {
              reason: 'market_resolved',
            });
            const r = await client.query(
              `UPDATE points_markets
                 SET status = 'resolved',
                     outcome = NULL,
                     resolved_at = NOW(),
                     resolved_by = $1,
                     resolver_type = COALESCE(resolver_type, $3),
                     resolver_config = COALESCE(resolver_config, $4::jsonb)
               WHERE id = $2
                 AND status = 'active'
               RETURNING id`,
              [`resolver:${resolverType}`, m.id, resolverType, JSON.stringify(cfg)],
            );
            if (r.rows.length === 0) {
              const err = new Error('not_active_at_write'); err.benign = true; throw err;
            }
            if (finalScore != null && finalScore !== '') {
              try {
                await client.query(
                  `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
                  [finalScore, m.id],
                );
              } catch (e) {
                if (e?.code !== '42703') throw e;
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
            for (let i = 0; i < legs.rows.length; i++) {
              const outcomeIndex = Number(independentLegResolutions[i]?.outcomeIndex);
              if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
                throw new Error(`invalid independent leg outcome ${outcomeIndex}`);
              }
              await client.query(
                `UPDATE points_markets
                   SET status = 'resolved',
                       outcome = $1,
                       resolved_at = NOW(),
                       resolved_by = $2
                 WHERE id = $3
                   AND status = 'active'`,
                [outcomeIndex, `resolver:${resolverType}`, legs.rows[i].id],
              );
            }

            await bestEffortPersistResolvedCryptoMarketSnapshot(
              client,
              m.id,
              'cron/points-auto-resolve',
            );
          });
          report.resolved.push({
            id: m.id,
            finalScore,
            legResolutions: legAudit,
            ...resolverInfo,
          });
        } catch (e) {
          if (e.benign) continue;
          report.errors.push({ id: m.id, error: `write_failed: ${e.message}` });
        }
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
          await bestEffortPersistTopHolderSnapshot(
            client,
            m.id,
            'cron/points-auto-resolve',
            { resolution: { winningOutcomeIndex: winningIdx } },
          );
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
