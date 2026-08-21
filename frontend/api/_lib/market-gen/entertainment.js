/**
 * Entertainment calendar generator (Mexico pop culture).
 *
 * Reads admin-curated config arrays and emits one pending-market
 * spec per resolvable event within a near-term horizon. Covers:
 *   - Awards   (Latin Grammy, Premios Juventud, Premios Lo Nuestro …)
 *   - Reality  (La Casa de los Famosos weekly + season winner)
 *   - Concerts (Ticketmaster / promoter-announced, binary Sí/No)
 *   - Popular  (news/pop-culture binary events, manual review)
 *
 * All markets produced here carry resolver_type=manual_review — the
 * scheduler wakes them at close and queues an admin resolution candidate
 * instead of auto-paying a fuzzy entertainment result.
 *
 * Idempotent per (source, source_event_id) — editing the config and
 * re-running refreshes any pending rows in place (same DO UPDATE
 * semantics as every other generator).
 */

import {
  AWARD_CEREMONIES,
  REALITY_EVENTS,
  CONCERT_EVENTS,
  POPULAR_EVENTS,
} from '../entertainment-config.js';
import { attachSuggestedPricing } from '../market-pricing.js';

// Only generate markets for events that resolve within this many days.
// Prevents the queue from filling with events months ahead — admin can
// always approve earlier by populating closer to the date.
const HORIZON_DAYS = 60;
const POPULAR_HORIZON_DAYS = 180;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const ENTERTAINMENT_DISCOVERY_LIMIT = 5;
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const NETFLIX_TOP10_GLOBAL_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv';
const NETFLIX_TOP10_COUNTRIES_TSV = 'https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv';
const DISCOVERY_FETCH_TIMEOUT_MS = 8000;

function aiPricingEnabled() {
  return process.env.ENTERTAINMENT_PRICING_AI_ENABLED === 'true'
    && Boolean(process.env.ANTHROPIC_API_KEY);
}

function apiDiscoveryEnabled() {
  return process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED !== 'false';
}

function tmdbEnabled() {
  return apiDiscoveryEnabled()
    && Boolean(process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_API_KEY);
}

function netflixTop10Enabled() {
  return apiDiscoveryEnabled()
    && process.env.NETFLIX_TOP10_DISCOVERY_ENABLED !== 'false';
}

function manualReviewConfig({ sourceEventId, criteria, evidence = [] }) {
  return {
    source: 'manual-review',
    sourceEventId,
    criteria,
    evidence: Array.isArray(evidence) ? evidence : [],
  };
}

function withinHorizon(iso, { horizonDays = HORIZON_DAYS, now = Date.now() } = {}) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return false;
  if (t <= nowMs) return false;                         // past = skip
  return t - nowMs <= horizonDays * 86_400_000;
}

function configuredProbabilities(config = {}, outcomeCount, fallback) {
  const explicit = config.probabilities || config.probabilityPct || null;
  if (Array.isArray(explicit) && explicit.length === outcomeCount) return explicit;
  return fallback;
}

function awardProbabilities(outcomeCount) {
  if (outcomeCount < 2) return [];
  const otherShare = outcomeCount > 2 ? 0.08 : 0;
  const nomineeCount = outcomeCount - 1;
  return [
    ...Array.from({ length: nomineeCount }, () => (1 - otherShare) / nomineeCount),
    otherShare,
  ];
}

function uniformProbabilities(outcomeCount) {
  return Array.from({ length: outcomeCount }, () => 1 / outcomeCount);
}

function binaryProbabilitiesFromYes(value, fallback = 0.45) {
  const raw = Number(value ?? fallback);
  const yes = Number.isFinite(raw) ? (raw > 1 ? raw / 100 : raw) : fallback;
  return [yes, 1 - yes];
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function nextWeekdayUtc(now = new Date(), weekday = 1, hour = 18) {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    0,
    0,
    0,
  ));
  const delta = (weekday - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

function currentWeekendWindow(now = new Date()) {
  const close = nextWeekdayUtc(now, 1, 18); // Monday after the weekend.
  const friday = new Date(close);
  friday.setUTCDate(close.getUTCDate() - 3);
  friday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(close);
  sunday.setUTCDate(close.getUTCDate() - 1);
  sunday.setUTCHours(23, 59, 59, 999);
  return {
    key: isoDate(friday),
    friday,
    sunday,
    close,
  };
}

function netflixWeekClose(now = new Date()) {
  const close = nextWeekdayUtc(now, 2, 6); // Tuesday 00:00 Mexico City-ish.
  return close;
}

function withTimeoutSignal(timeoutMs = DISCOVERY_FETCH_TIMEOUT_MS) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(timeoutMs), cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

async function fetchJson(url, options = {}) {
  const { signal, cleanup } = withTimeoutSignal();
  try {
    const res = await fetch(url, { ...options, signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.json();
  } finally {
    cleanup();
  }
}

async function fetchText(url, options = {}) {
  const { signal, cleanup } = withTimeoutSignal();
  try {
    const res = await fetch(url, { ...options, signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.text();
  } finally {
    cleanup();
  }
}

async function tmdbGet(path, params = {}) {
  const url = new URL(`${TMDB_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const headers = {};
  if (process.env.TMDB_READ_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.TMDB_READ_ACCESS_TOKEN}`;
  } else {
    url.searchParams.set('api_key', process.env.TMDB_API_KEY);
  }
  return fetchJson(url, { headers });
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function moviePosterUrl(movie) {
  return movie?.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null;
}

function movieBoxOfficeProbability(movie, rank) {
  const popularity = clamp(movie?.popularity, 0, 300);
  const base = [0.44, 0.32, 0.24, 0.18, 0.14][rank] ?? 0.12;
  return clamp(base + Math.min(0.08, popularity / 5000), 0.1, 0.58);
}

function movieWeekendBoxOfficeSpec(movie, { weekend = currentWeekendWindow(), rank = 0 } = {}) {
  const title = String(movie?.title || movie?.name || '').trim();
  if (!movie?.id || !title) return null;
  const releaseDate = movie.release_date || movie.primary_release_date || null;
  const sourceEventId = `tmdb-box-office-weekend:${weekend.key}:${movie.id}`;
  const evidence = [
    {
      title: `TMDb · ${title}`,
      url: `https://www.themoviedb.org/movie/${movie.id}`,
    },
    {
      title: 'Box Office Mojo · Weekend box office',
      url: 'https://www.boxofficemojo.com/weekend/',
    },
    {
      title: 'The Numbers · Weekend box office',
      url: 'https://www.the-numbers.com/box-office-chart/weekend',
    },
  ];
  const spec = {
    source: 'entertainment-api',
    source_event_id: sourceEventId,
    question: `¿${title} será #1 en taquilla de EE.UU. este fin de semana?`,
    category: 'musica',
    icon: '🎬',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    start_time: weekend.friday.toISOString(),
    end_time: weekend.close.toISOString(),
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId,
      criteria: 'Resolver Sí si Box Office Mojo, The Numbers, Comscore/AP, Variety o Deadline reportan que esta película fue #1 por gross doméstico de EE.UU./Canadá durante el fin de semana indicado. Resolver No en cualquier otro caso.',
      evidence,
    }),
    source_data: {
      kind: 'box_office_weekend',
      sourceProvider: 'tmdb',
      tmdbId: movie.id,
      movie: title,
      releaseDate,
      weekendKey: weekend.key,
      posterUrl: moviePosterUrl(movie),
      overview: movie.overview || null,
      popularity: movie.popularity ?? null,
      resolutionSource: 'manual-box-office',
      categorization: {
        geoTags: ['us-canada'],
        topicTags: ['cine'],
      },
    },
    category_tags: ['musica'],
    geo_tags: ['us-canada'],
    topic_tags: ['cine'],
  };
  return attachSuggestedPricing(spec, {
    probabilities: binaryProbabilitiesFromYes(movieBoxOfficeProbability(movie, rank)),
    source: 'source-signals:tmdb-popularity',
    rationale: 'Estimación automática basada en recencia y popularidad TMDb; admin debe revisar antes de aprobar.',
    evidence,
  });
}

async function discoverMovieWeekendSpecs({ now = new Date(), limit = ENTERTAINMENT_DISCOVERY_LIMIT } = {}) {
  if (!tmdbEnabled()) return [];
  const weekend = currentWeekendWindow(now);
  try {
    const [nowPlaying, upcoming] = await Promise.all([
      tmdbGet('/movie/now_playing', { language: 'es-MX', region: 'US', page: 1 }),
      tmdbGet('/movie/upcoming', { language: 'es-MX', region: 'US', page: 1 }),
    ]);
    const minReleaseMs = weekend.friday.getTime() - 24 * 86_400_000;
    const maxReleaseMs = weekend.sunday.getTime();
    const movies = uniqueBy([
      ...(nowPlaying?.results || []),
      ...(upcoming?.results || []),
    ], movie => movie?.id)
      .filter(movie => {
        const releaseMs = Date.parse(movie?.release_date || '');
        if (!Number.isFinite(releaseMs)) return false;
        return releaseMs >= minReleaseMs && releaseMs <= maxReleaseMs;
      })
      .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
      .slice(0, limit);
    return movies
      .map((movie, rank) => movieWeekendBoxOfficeSpec(movie, { weekend, rank }))
      .filter(Boolean);
  } catch (e) {
    console.warn('[market-gen/entertainment] TMDb discovery skipped', { message: e?.message });
    return [];
  }
}

function parseTsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map(header => normalizeSlug(header).replace(/-/g, '_'));
  return lines.slice(1).map(line => {
    const cells = line.split('\t');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? '';
    });
    return row;
  });
}

function rowValue(row, names) {
  for (const name of names) {
    const key = normalizeSlug(name).replace(/-/g, '_');
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function netflixTitle(row) {
  return rowValue(row, ['show_title', 'title', 'name', 'season_title']);
}

function netflixWeek(row) {
  return rowValue(row, ['week', 'week_of', 'week_start', 'week_start_date', 'week_ending']);
}

function netflixRank(row) {
  return Number(rowValue(row, ['weekly_rank', 'rank', 'position']));
}

function isNetflixTvRow(row) {
  const category = rowValue(row, ['category', 'list', 'type']).toLowerCase();
  return /tv|series|show/.test(category);
}

function latestNetflixWeek(rows) {
  return rows
    .map(netflixWeek)
    .filter(Boolean)
    .sort()
    .at(-1) || null;
}

function topNetflixRows(rows, { country = null, limit = ENTERTAINMENT_DISCOVERY_LIMIT } = {}) {
  const latestWeek = latestNetflixWeek(rows);
  if (!latestWeek) return [];
  const countryNorm = country ? normalizeTopicText(country) : null;
  return uniqueBy(
    rows
      .filter(row => netflixWeek(row) === latestWeek)
      .filter(isNetflixTvRow)
      .filter(row => {
        if (!countryNorm) return true;
        const rowCountry = normalizeTopicText(rowValue(row, ['country_name', 'country', 'market']));
        return rowCountry === countryNorm;
      })
      .map(row => ({ row, title: netflixTitle(row), rank: netflixRank(row) }))
      .filter(item => item.title && Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank),
    item => normalizeSlug(item.title),
  ).slice(0, limit);
}

function netflixProbabilityForRank(rank, mode) {
  if (mode === 'top3') {
    if (rank <= 1) return 0.72;
    if (rank === 2) return 0.62;
    if (rank === 3) return 0.52;
    return 0.34;
  }
  if (rank <= 1) return 0.52;
  if (rank === 2) return 0.34;
  if (rank === 3) return 0.24;
  return 0.16;
}

function netflixTop10Spec(item, { scope = 'global', mode = 'number1', close = netflixWeekClose() } = {}) {
  const title = String(item?.title || '').trim();
  if (!title) return null;
  const start = new Date(close.getTime() - 7 * 86_400_000);
  const titleSlug = normalizeSlug(title);
  const metric = mode === 'top3' ? 'top3' : 'number1';
  const sourceEventId = `netflix-top10:${scope}:${metric}:${isoDate(close)}:${titleSlug}`;
  const evidence = [
    {
      title: 'Netflix Top 10',
      url: 'https://www.netflix.com/tudum/top10',
    },
  ];
  const question = scope === 'mx'
    ? `¿${title} entra al Top 3 de Netflix México esta semana?`
    : `¿${title} será #1 global en Netflix TV esta semana?`;
  const spec = {
    source: 'entertainment-api',
    source_event_id: sourceEventId,
    question,
    category: 'musica',
    icon: '📺',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    start_time: start.toISOString(),
    end_time: close.toISOString(),
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId,
      criteria: scope === 'mx'
        ? 'Resolver Sí si Netflix Top 10 coloca este título dentro del Top 3 de TV en México para la semana objetivo. Resolver No si queda fuera del Top 3 o no aparece.'
        : 'Resolver Sí si Netflix Top 10 coloca este título como #1 global de TV para la semana objetivo. Resolver No si queda en otra posición o no aparece.',
      evidence,
    }),
    source_data: {
      kind: 'netflix_top10',
      sourceProvider: 'netflix-top10',
      title,
      scope,
      targetRank: scope === 'mx' ? 3 : 1,
      latestKnownRank: item.rank,
      latestKnownWeek: netflixWeek(item.row),
      resolutionSource: 'manual-netflix-top10',
      categorization: {
        geoTags: scope === 'mx' ? ['mexico'] : ['world'],
        topicTags: ['tv'],
      },
    },
    category_tags: ['musica'],
    geo_tags: scope === 'mx' ? ['mexico'] : ['world'],
    topic_tags: ['tv'],
  };
  return attachSuggestedPricing(spec, {
    probabilities: binaryProbabilitiesFromYes(netflixProbabilityForRank(item.rank, mode)),
    source: 'source-signals:netflix-top10-rank',
    rationale: 'Estimación automática basada en el ranking público más reciente de Netflix Top 10; admin debe revisar antes de aprobar.',
    evidence,
  });
}

async function discoverNetflixTop10Specs({ now = new Date(), limit = ENTERTAINMENT_DISCOVERY_LIMIT } = {}) {
  if (!netflixTop10Enabled()) return [];
  try {
    const close = netflixWeekClose(now);
    const [globalText, countriesText] = await Promise.all([
      fetchText(process.env.NETFLIX_TOP10_GLOBAL_TSV_URL || NETFLIX_TOP10_GLOBAL_TSV),
      fetchText(process.env.NETFLIX_TOP10_COUNTRIES_TSV_URL || NETFLIX_TOP10_COUNTRIES_TSV),
    ]);
    const globalRows = parseTsv(globalText);
    const countryRows = parseTsv(countriesText);
    const globalSpecs = topNetflixRows(globalRows, { limit: Math.ceil(limit / 2) })
      .map(item => netflixTop10Spec(item, { scope: 'global', mode: 'number1', close }))
      .filter(Boolean);
    const mexicoSpecs = topNetflixRows(countryRows, { country: 'Mexico', limit: Math.floor(limit / 2) || 1 })
      .map(item => netflixTop10Spec(item, { scope: 'mx', mode: 'top3', close }))
      .filter(Boolean);
    return [...globalSpecs, ...mexicoSpecs].slice(0, limit);
  } catch (e) {
    console.warn('[market-gen/entertainment] Netflix Top 10 discovery skipped', { message: e?.message });
    return [];
  }
}

function normalizeTopicText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function awardTopic(award = {}, cat = {}) {
  const text = normalizeTopicText([
    award.key,
    award.label,
    cat.key,
    cat.label,
  ].filter(Boolean).join(' '));
  if (/(oscar|cine|pelicula|film|actor|actriz|director)/.test(text)) return 'cine';
  if (/(emmy|tv|television|serie|show|reality)/.test(text)) return 'tv';
  if (/(grammy|musica|musical|cancion|album|artista|juventud|lo nuestro|billboard)/.test(text)) return 'musica';
  return 'musica';
}

function withEntertainmentTopic(spec, topicTags) {
  const tags = Array.isArray(topicTags) ? topicTags.filter(Boolean) : [];
  return {
    ...spec,
    topic_tags: tags,
    source_data: {
      ...(spec.source_data || {}),
      categorization: {
        ...(spec.source_data?.categorization || {}),
        topicTags: tags,
      },
    },
  };
}

function explicitTags(spec, tags = {}) {
  const categoryTags = Array.isArray(tags.categoryTags) ? tags.categoryTags.filter(Boolean) : [];
  const geoTags = Array.isArray(tags.geoTags) ? tags.geoTags.filter(Boolean) : [];
  const topicTags = Array.isArray(tags.topicTags) ? tags.topicTags.filter(Boolean) : [];
  if (!categoryTags.length && !geoTags.length && !topicTags.length) return spec;
  return {
    ...spec,
    ...(categoryTags.length ? { category_tags: categoryTags } : {}),
    ...(geoTags.length ? { geo_tags: geoTags } : {}),
    ...(topicTags.length ? { topic_tags: topicTags } : {}),
    source_data: {
      ...(spec.source_data || {}),
      categorization: {
        ...(spec.source_data?.categorization || {}),
        ...(geoTags.length ? { geoTags } : {}),
        ...(topicTags.length ? { topicTags } : {}),
      },
    },
  };
}

async function suggestPricingWithAnthropic(spec) {
  if (!aiPricingEnabled()) return null;
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  if (outcomes.length < 2 || outcomes.length > 12) return null;

  const prompt = `Sugiere probabilidades iniciales para este mercado de entretenimiento/farandula en Pronos. No resuelvas el mercado; solo estima odds de apertura revisables por admin.

Pregunta: ${spec.question}
Opciones: ${JSON.stringify(outcomes)}
Contexto: ${JSON.stringify({
    sourceData: spec.source_data || {},
    resolverEvidence: spec.resolver_config?.evidence || [],
    currentSuggestion: spec.source_data?.suggestedPricing || null,
  })}

Reglas:
- Devuelve probabilidades conservadoras, no certeza.
- Las probabilidades deben sumar 100.
- Usa solamente numeros, sin simbolo %.
- Si no hay evidencia fuerte, quedate cerca de balanceado.

Responde SOLO JSON valido:
{"probabilities":[50,50],"rationale":"explicacion breve en espanol"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.warn('[market-gen/entertainment] AI pricing HTTP', res.status);
      return null;
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const probabilities = Array.isArray(parsed.probabilities) ? parsed.probabilities : null;
    if (!probabilities || probabilities.length !== outcomes.length) return null;
    return {
      probabilities,
      source: 'anthropic-pricing',
      rationale: parsed.rationale || 'Estimación AI conservadora para revisión admin.',
      evidence: [
        ...(spec.source_data?.suggestedPricing?.evidence || []),
        { title: 'Anthropic pricing model', model: ANTHROPIC_MODEL },
      ],
    };
  } catch (e) {
    console.warn('[market-gen/entertainment] AI pricing failed', { message: e?.message });
    return null;
  }
}

async function maybeAttachAiPricing(spec) {
  const aiPricing = await suggestPricingWithAnthropic(spec);
  return aiPricing ? attachSuggestedPricing(spec, aiPricing) : spec;
}

// ─── Awards ─────────────────────────────────────────────────────────────
function awardSpecs(award) {
  if (!withinHorizon(award.ceremonyDate)) return [];
  const specs = [];
  for (const cat of award.categories || []) {
    const nominees = Array.isArray(cat.nominees) ? cat.nominees.filter(Boolean) : [];
    if (nominees.length < 2) continue; // need at least 2 legs
    const outcomes = [...nominees, 'Otro'];
    const spec = {
      source: 'entertainment',
      source_event_id: `award:${award.key}:${cat.key}`,
      question: `${cat.label} · ${award.label}`,
      category: 'musica',
      icon: null,
      outcomes,
      seed_liquidity: 1000,
      end_time: award.ceremonyDate,
      amm_mode: 'parallel',
      resolver_type: 'manual_review',
      resolver_config: manualReviewConfig({
        sourceEventId: `award:${award.key}:${cat.key}`,
        criteria: 'Confirmar ganador oficial después de la ceremonia.',
        evidence: award.sources || award.evidence || [],
      }),
      source_data: {
        kind: 'award',
        awardKey: award.key,
        awardLabel: award.label,
        categoryKey: cat.key,
        ceremonyDate: award.ceremonyDate,
      },
    };
    specs.push(attachSuggestedPricing(withEntertainmentTopic(spec, [awardTopic(award, cat)]), {
      probabilities: configuredProbabilities(cat, outcomes.length, awardProbabilities(outcomes.length)),
      source: Array.isArray(cat.probabilities) || Array.isArray(cat.probabilityPct)
        ? 'admin-config'
        : 'source-signals:award-nominees',
      rationale: 'Nominados balanceados con una reserva menor para Otro; admin puede editar antes de aprobar.',
      evidence: award.sources || award.evidence || [],
    }));
  }
  return specs;
}

// ─── Reality shows ──────────────────────────────────────────────────────
function realityWeekSpec(ev) {
  if (!withinHorizon(ev.eliminationDate)) return null;
  const nominated = Array.isArray(ev.nominated) ? ev.nominated.filter(Boolean) : [];
  if (nominated.length < 2) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `reality_week:${ev.key}`,
    question: `¿Quién sale de ${ev.showLabel} esta semana? (${ev.seasonLabel}, semana ${ev.weekNumber})`,
    category: 'musica',
    icon: null,
    outcomes: nominated,
    seed_liquidity: 1000,
    end_time: ev.eliminationDate,
    amm_mode: 'parallel',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `reality_week:${ev.key}`,
      criteria: 'Confirmar expulsado oficial después de la transmisión.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'reality_week',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
      weekNumber: ev.weekNumber,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['tv', 'farandula']), {
    probabilities: configuredProbabilities(ev, nominated.length, uniformProbabilities(nominated.length)),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct)
      ? 'admin-config'
      : 'source-signals:reality-nominees',
    rationale: 'Nominados balanceados hasta que haya señales más fuertes de audiencia/votación.',
    evidence: ev.sources || ev.evidence || [],
  });
}

function realityWinnerSpec(ev) {
  if (!withinHorizon(ev.finaleDate)) return null;
  const housemates = Array.isArray(ev.housemates) ? ev.housemates.filter(Boolean) : [];
  if (housemates.length < 2) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `reality_winner:${ev.key}`,
    question: `¿Quién gana ${ev.showLabel} (${ev.seasonLabel})?`,
    category: 'musica',
    icon: null,
    outcomes: housemates,
    seed_liquidity: 1000,
    end_time: ev.finaleDate,
    amm_mode: 'parallel',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `reality_winner:${ev.key}`,
      criteria: 'Confirmar ganador oficial después de la final.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'reality_winner',
      showLabel: ev.showLabel,
      seasonLabel: ev.seasonLabel,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['tv', 'farandula']), {
    probabilities: configuredProbabilities(ev, housemates.length, uniformProbabilities(housemates.length)),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct)
      ? 'admin-config'
      : 'source-signals:reality-cast',
    rationale: 'Cast balanceado hasta que haya señales más fuertes de audiencia/votación.',
    evidence: ev.sources || ev.evidence || [],
  });
}

// ─── Concerts ───────────────────────────────────────────────────────────
function concertSpec(ev) {
  if (!withinHorizon(ev.resolveAt)) return null;
  if (typeof ev.question !== 'string' || ev.question.trim().length < 8) return null;
  const spec = {
    source: 'entertainment',
    source_event_id: `concert:${ev.key}`,
    question: ev.question,
    category: ev.category || 'musica',
    icon: null,
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: ev.resolveAt,
    amm_mode: 'unified',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `concert:${ev.key}`,
      criteria: 'Confirmar anuncio oficial, venta publicada o comunicado del promotor.',
      evidence: ev.sources || ev.evidence || [],
    }),
    source_data: {
      kind: 'concert',
      artist: ev.artist,
      venue: ev.venue,
    },
  };
  return attachSuggestedPricing(withEntertainmentTopic(spec, ['musica']), {
    probabilities: configuredProbabilities(
      ev,
      2,
      binaryProbabilitiesFromYes(ev.probabilityYes ?? ev.suggestedProbabilityYes),
    ),
    source: Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct) || ev.probabilityYes != null
      ? 'admin-config'
      : 'source-signals:concert',
    rationale: 'Señal inicial para anuncio/venta; admin puede editar la liquidez antes de aprobar.',
    evidence: ev.sources || ev.evidence || [],
  });
}

// ─── Popular manual-review events ─────────────────────────────────────
function popularEventSpec(ev) {
  const horizonDays = Number.isFinite(Number(ev.horizonDays))
    ? Number(ev.horizonDays)
    : POPULAR_HORIZON_DAYS;
  if (!withinHorizon(ev.resolveAt, { horizonDays })) return null;
  if (typeof ev.question !== 'string' || ev.question.trim().length < 8) return null;
  if (typeof ev.criteria !== 'string' || ev.criteria.trim().length < 12) return null;

  const outcomes = Array.isArray(ev.outcomes)
    ? ev.outcomes.map(value => String(value || '').trim()).filter(Boolean)
    : ['Sí', 'No'];
  if (outcomes.length < 2) return null;

  const evidence = ev.sources || ev.evidence || [];
  const spec = {
    source: ev.source || 'popular',
    source_event_id: `popular:${ev.key}`,
    question: ev.question,
    category: ev.category || 'general',
    icon: ev.icon || null,
    outcomes,
    seed_liquidity: 1000,
    end_time: ev.resolveAt,
    amm_mode: ev.ammMode || ev.amm_mode || 'unified',
    resolver_type: 'manual_review',
    resolver_config: manualReviewConfig({
      sourceEventId: `popular:${ev.key}`,
      criteria: ev.criteria,
      evidence,
    }),
    source_data: {
      kind: 'popular_event',
      topic: ev.topic || null,
      eventLabel: ev.eventLabel || null,
      movie: ev.movie || null,
      franchise: ev.franchise || null,
      region: ev.region || ev.marketRegion || 'world',
      sourceUrls: evidence
        .map(item => (typeof item === 'string' ? item : item?.url))
        .filter(Boolean),
      evidence,
      resolutionCriteria: ev.criteria,
    },
  };
  const hasExplicitProbabilities = Array.isArray(ev.probabilities) || Array.isArray(ev.probabilityPct);
  return attachSuggestedPricing(explicitTags(spec, ev.tags), {
    probabilities: configuredProbabilities(
      ev,
      outcomes.length,
      outcomes.length === 2
        ? binaryProbabilitiesFromYes(ev.probabilityYes ?? ev.suggestedProbabilityYes, 0.45)
        : uniformProbabilities(outcomes.length),
    ),
    source: hasExplicitProbabilities || ev.probabilityYes != null
      ? 'admin-config'
      : 'source-signals:popular-event',
    rationale: 'Mercado popular con resolución manual y fuentes explícitas; admin puede editar odds antes de aprobar.',
    evidence,
  });
}

export async function generateEntertainmentMarkets() {
  const specs = [];

  for (const award of AWARD_CEREMONIES) {
    specs.push(...awardSpecs(award));
  }
  for (const ev of REALITY_EVENTS) {
    if (ev.kind === 'reality_week') {
      const s = realityWeekSpec(ev);
      if (s) specs.push(s);
    } else if (ev.kind === 'reality_winner') {
      const s = realityWinnerSpec(ev);
      if (s) specs.push(s);
    }
  }
  for (const ev of CONCERT_EVENTS) {
    const s = concertSpec(ev);
    if (s) specs.push(s);
  }
  for (const ev of POPULAR_EVENTS) {
    const s = popularEventSpec(ev);
    if (s) specs.push(s);
  }
  specs.push(...await discoverMovieWeekendSpecs());
  specs.push(...await discoverNetflixTop10Specs());

  const out = [];
  for (const spec of specs) out.push(await maybeAttachAiPricing(spec));
  return out;
}

export const _internal = {
  aiPricingEnabled,
  apiDiscoveryEnabled,
  awardProbabilities,
  binaryProbabilitiesFromYes,
  configuredProbabilities,
  currentWeekendWindow,
  discoverMovieWeekendSpecs,
  discoverNetflixTop10Specs,
  explicitTags,
  latestNetflixWeek,
  movieWeekendBoxOfficeSpec,
  netflixTop10Spec,
  normalizeSlug,
  parseTsv,
  popularEventSpec,
  suggestPricingWithAnthropic,
  tmdbEnabled,
  topNetflixRows,
  uniformProbabilities,
  withinHorizon,
};
