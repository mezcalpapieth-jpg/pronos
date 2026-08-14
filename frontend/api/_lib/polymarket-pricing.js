import { attachSuggestedPricing, normalizeProbabilities } from './market-pricing.js';

const DEFAULT_GAMMA_BASE = 'https://gamma-api.polymarket.com';
const DEFAULT_CLOB_BASE = 'https://clob.polymarket.com';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MIN_SCORE = 0.48;
const DEFAULT_MAX_SPREAD = 0.18;
const DEFAULT_MAX_EVENTS_TO_FETCH = 8;
const DEFAULT_MAX_SEARCH_QUERIES = 7;
const DEFAULT_SEARCH_LIMIT_PER_TYPE = 12;

const STRONG_PRICING_SOURCES = new Set([
  'admin-config',
  'the-odds-api:h2h',
]);

const SEARCH_STOPWORDS = new Set([
  'a', 'al', 'an', 'and', 'ante', 'antes', 'after', 'before', 'con', 'contra',
  'de', 'del', 'does', 'durante', 'el', 'en', 'es', 'esta', 'este', 'for',
  'from', 'gana', 'ganador', 'ganadora', 'ganara', 'ganará', 'if', 'la', 'las',
  'lo', 'los', 'mas', 'más', 'mercado', 'no', 'on', 'para', 'por', 'que',
  'quien', 'quién', 'recibe', 'recibira', 'recibirá', 'sera', 'será', 'si',
  'sí', 'su', 'the', 'to', 'un', 'una', 'vs', 'will', 'wins', 'with', 'y',
]);

const SEARCH_TOKEN_TRANSLATIONS = new Map([
  ['abril', 'april'],
  ['agosto', 'august'],
  ['cancion', 'song'],
  ['canción', 'song'],
  ['diciembre', 'december'],
  ['enero', 'january'],
  ['febrero', 'february'],
  ['ganara', 'win'],
  ['ganará', 'win'],
  ['julio', 'july'],
  ['junio', 'june'],
  ['marzo', 'march'],
  ['mayo', 'may'],
  ['mexico', 'mexico'],
  ['méxico', 'mexico'],
  ['noviembre', 'november'],
  ['numero', 'number'],
  ['número', 'number'],
  ['octubre', 'october'],
  ['pelicula', 'movie'],
  ['película', 'movie'],
  ['premio', 'award'],
  ['premios', 'awards'],
  ['septiembre', 'september'],
  ['trailer', 'trailer'],
  ['tráiler', 'trailer'],
  ['uno', 'one'],
]);

function envFlagEnabled(name, fallback = true) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numericOption(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getExistingPricingSource(spec) {
  const pricing = spec?.source_data?.suggestedPricing || spec?.suggestedPricing || null;
  return pricing?.source || spec?.pricing_source || spec?.pricingSource || null;
}

export function shouldUsePolymarketPricing(spec = {}) {
  if (!envFlagEnabled('POLYMARKET_PRICING_ENABLED', true)) return false;
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  if (outcomes.length < 2 || outcomes.length > 20) return false;

  const source = getExistingPricingSource(spec);
  if (!source) return true;
  const normalized = String(source);
  if (STRONG_PRICING_SOURCES.has(normalized)) return false;
  return normalized === 'uniform-default'
    || normalized === 'anthropic-pricing'
    || normalized.startsWith('anthropic-pricing:')
    || normalized.startsWith('source-signals:');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function displayText(value) {
  return String(value || '')
    .replace(/[¿?¡!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addUnique(list, value) {
  const cleaned = displayText(value);
  if (!cleaned) return;
  const normalized = normalizeText(cleaned);
  if (!normalized) return;
  if (!list.some(item => normalizeText(item) === normalized)) {
    list.push(cleaned.slice(0, 160));
  }
}

function translatedQuery(value) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  const translated = normalized
    .split(/\s+/)
    .map(token => SEARCH_TOKEN_TRANSLATIONS.get(token) || token)
    .filter(token => token.length > 1 && !SEARCH_STOPWORDS.has(token));
  return translated.join(' ');
}

function significantTokens(value, limit = 9) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const tokens = [];
  for (const token of normalized.split(/\s+/)) {
    if (token.length < 3) continue;
    if (SEARCH_STOPWORDS.has(token)) continue;
    if (!tokens.includes(token)) tokens.push(token);
    if (tokens.length >= limit) break;
  }
  return tokens;
}

function sourceDataSearchParts(sourceData = {}) {
  return [
    sourceData.artist,
    sourceData.song,
    sourceData.track,
    sourceData.movie,
    sourceData.film,
    sourceData.franchise,
    sourceData.showLabel,
    sourceData.seasonLabel,
    sourceData.awardLabel,
    sourceData.categoryLabel,
    sourceData.topic,
    sourceData.venue,
    sourceData.city,
    sourceData.country,
  ].filter(Boolean);
}

export function buildPolymarketSearchQueries(spec = {}) {
  const queries = [];
  const sourceData = spec.source_data && typeof spec.source_data === 'object'
    ? spec.source_data
    : {};
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  const namedOutcomes = outcomes
    .filter(outcome => !isYesLabel(outcome) && !isNoLabel(outcome) && !isOtherLabel(outcome))
    .slice(0, 5);
  const sourceParts = sourceDataSearchParts(sourceData);

  addUnique(queries, spec.question);
  addUnique(queries, sourceParts.join(' '));

  const questionTokens = significantTokens(spec.question, 10);
  addUnique(queries, questionTokens.join(' '));
  addUnique(queries, translatedQuery(spec.question));

  if (sourceParts.length && namedOutcomes.length) {
    addUnique(queries, `${sourceParts.slice(0, 4).join(' ')} ${namedOutcomes.join(' ')}`);
  }
  if (namedOutcomes.length) {
    const topic = sourceData.awardLabel || sourceData.showLabel || sourceData.topic || sourceData.categoryLabel || '';
    addUnique(queries, `${namedOutcomes.join(' ')} ${topic}`.trim());
  }

  if (spec.source_event_id) {
    addUnique(queries, String(spec.source_event_id).replace(/[:_-]+/g, ' '));
  }

  return queries.slice(0, DEFAULT_MAX_SEARCH_QUERIES);
}

function tokenSet(value) {
  return new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter(token => token.length > 1 && !['the', 'and', 'for', 'will', 'with', 'que', 'quien', 'gana', 'antes', 'after', 'before'].includes(token))
  );
}

function similarity(a, b) {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function labelIncludedScore(label, text) {
  const normalizedLabel = normalizeText(label);
  const normalizedText = normalizeText(text);
  if (!normalizedLabel || !normalizedText) return 0;
  if (normalizedText.includes(normalizedLabel)) return 1;
  return similarity(normalizedLabel, normalizedText);
}

function isYesLabel(label) {
  return ['si', 'yes', 'verdadero'].includes(normalizeText(label));
}

function isNoLabel(label) {
  return ['no', 'false', 'falso'].includes(normalizeText(label));
}

function isOtherLabel(label) {
  return ['otro', 'otra', 'other', 'field'].includes(normalizeText(label));
}

function isYesNoOutcomeSet(outcomes) {
  return outcomes.length === 2
    && outcomes.some(isYesLabel)
    && outcomes.some(isNoLabel);
}

function safeJson(value) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function marketText(market, event = null) {
  return [
    event?.title,
    market?.question,
    market?.title,
    market?.slug,
  ].filter(Boolean).join(' ');
}

function getMarketOutcomes(market) {
  const raw = safeJson(market?.outcomes) || market?.outcomes;
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object' && raw.yes && raw.no) return ['Yes', 'No'];
  return [];
}

function getMarketTokenIds(market) {
  const raw = safeJson(market?.clobTokenIds)
    || safeJson(market?.clob_token_ids)
    || market?.clobTokenIds
    || market?.clob_token_ids;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);

  const outcomes = safeJson(market?.outcomes) || market?.outcomes;
  if (outcomes && typeof outcomes === 'object') {
    const yes = outcomes.yes?.tokenId || outcomes.yes?.token_id;
    const no = outcomes.no?.tokenId || outcomes.no?.token_id;
    return [yes, no].filter(Boolean).map(String);
  }

  return [];
}

function getOutcomePrices(market) {
  const raw = safeJson(market?.outcomePrices)
    || safeJson(market?.outcome_prices)
    || market?.outcomePrices
    || market?.outcome_prices;
  if (!Array.isArray(raw)) return [];
  return raw.map(asNumber).filter(value => value !== null && value > 0);
}

function polymarketUrl(match) {
  if (match?.eventSlug) return `https://polymarket.com/event/${match.eventSlug}`;
  if (match?.marketSlug) return `https://polymarket.com/market/${match.marketSlug}`;
  return 'https://polymarket.com';
}

async function fetchJson(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  method = 'GET',
  body = null,
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res?.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeMarket(item) {
  return Boolean(item && typeof item === 'object' && (
    item.question
    || item.conditionId
    || item.condition_id
    || item.clobTokenIds
    || item.clob_token_ids
    || item.outcomePrices
    || (item.outcomes && !Array.isArray(item.markets))
  ));
}

function eventFromMarket(market, fallbackEvent = null) {
  const nestedEvent = market?.event && typeof market.event === 'object' ? market.event : null;
  return {
    ...(fallbackEvent || {}),
    ...(nestedEvent || {}),
    id: nestedEvent?.id || fallbackEvent?.id || market?.eventId || market?.event_id || market?.event_id_string || null,
    slug: nestedEvent?.slug || fallbackEvent?.slug || market?.eventSlug || market?.event_slug || null,
    title: nestedEvent?.title || fallbackEvent?.title || market?.eventTitle || market?.groupItemTitle || null,
  };
}

function eventKey(event) {
  if (!event) return null;
  return event.id ? `id:${event.id}` : event.slug ? `slug:${event.slug}` : null;
}

function marketKey(market, event = null) {
  if (!market) return null;
  if (market.id) return `id:${market.id}`;
  if (market.conditionId) return `condition:${market.conditionId}`;
  if (market.condition_id) return `condition:${market.condition_id}`;
  if (market.slug) return `slug:${market.slug}`;
  const text = normalizeText(`${event?.slug || event?.title || ''} ${market.question || market.title || ''}`);
  return text ? `text:${text}` : null;
}

function addCandidate(map, event, market) {
  if (!looksLikeMarket(market)) return;
  const candidateEvent = eventFromMarket(market, event);
  const key = marketKey(market, candidateEvent);
  if (!key || map.has(key)) return;
  map.set(key, { event: candidateEvent, market });
}

function parseSearchCandidates(payload) {
  const events = [];
  const candidates = new Map();

  function addEvent(event) {
    if (event?.id || event?.slug) events.push(event);
  }

  function visit(item, fallbackEvent = null) {
    if (!item || typeof item !== 'object') return;
    if (item.event && typeof item.event === 'object') addEvent(item.event);
    if (item.market && typeof item.market === 'object') {
      addCandidate(candidates, item.event || fallbackEvent, item.market);
      return;
    }
    if (looksLikeMarket(item)) {
      addCandidate(candidates, fallbackEvent, item);
      return;
    }
    if (Array.isArray(item.markets)) {
      addEvent(item);
      for (const market of item.markets) addCandidate(candidates, item, market);
      return;
    }
    if (item.id || item.slug) addEvent(item);
  }

  if (Array.isArray(payload?.events)) {
    for (const event of payload.events) visit(event);
  }
  if (Array.isArray(payload?.markets)) {
    for (const market of payload.markets) visit(market);
  }
  if (Array.isArray(payload?.results)) {
    for (const result of payload.results) visit(result);
  }
  if (Array.isArray(payload)) {
    for (const item of payload) visit(item);
  }

  const eventMap = new Map();
  for (const event of events) {
    const key = eventKey(event);
    if (key && !eventMap.has(key)) eventMap.set(key, event);
  }

  return {
    events: [...eventMap.values()],
    candidates: [...candidates.values()],
  };
}

function flattenMarkets(events) {
  const candidates = new Map();
  for (const event of events) {
    for (const market of Array.isArray(event?.markets) ? event.markets : []) {
      addCandidate(candidates, event, market);
    }
  }
  return [...candidates.values()];
}

async function discoverMarketCandidates(spec, opts) {
  const gammaBase = opts.gammaBase || process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_BASE;
  const baseUrl = gammaBase.replace(/\/$/, '');
  const maxQueries = Math.floor(numericOption(
    opts.maxSearchQueries ?? process.env.POLYMARKET_PRICING_MAX_SEARCH_QUERIES,
    DEFAULT_MAX_SEARCH_QUERIES,
  ));
  const maxEvents = Math.floor(numericOption(
    opts.maxEventsToFetch ?? process.env.POLYMARKET_PRICING_MAX_EVENTS,
    DEFAULT_MAX_EVENTS_TO_FETCH,
  ));
  const limitPerType = Math.floor(numericOption(
    opts.limitPerType ?? process.env.POLYMARKET_PRICING_LIMIT_PER_TYPE,
    DEFAULT_SEARCH_LIMIT_PER_TYPE,
  ));
  const keepClosed = opts.keepClosed ?? envFlagEnabled('POLYMARKET_PRICING_KEEP_CLOSED', false);
  const queries = buildPolymarketSearchQueries(spec).slice(0, maxQueries);
  if (!queries.length) return { candidates: [], attemptedQueries: [] };

  const eventMap = new Map();
  const directCandidateMap = new Map();
  const attemptedQueries = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      limit_per_type: String(limitPerType),
      optimized: 'true',
      search_tags: 'true',
    });
    if (keepClosed) {
      params.set('keep_closed_markets', 'true');
    } else {
      params.set('events_status', 'active');
    }
    const searchUrl = `${baseUrl}/public-search?${params}`;
    attemptedQueries.push(query);
    const search = await fetchJson(searchUrl, opts);
    const parsed = parseSearchCandidates(search);
    for (const event of parsed.events) {
      const key = eventKey(event);
      if (key && !eventMap.has(key)) eventMap.set(key, event);
    }
    for (const candidate of parsed.candidates) {
      const key = marketKey(candidate.market, candidate.event);
      if (key && !directCandidateMap.has(key)) directCandidateMap.set(key, candidate);
    }
    if (directCandidateMap.size >= limitPerType && eventMap.size >= maxEvents) break;
  }

  const events = [...eventMap.values()].slice(0, maxEvents);
  const detailed = [];
  for (const event of events) {
    const idOrSlug = event.id
      ? `events/${encodeURIComponent(event.id)}`
      : `events/slug/${encodeURIComponent(event.slug)}`;
    const detail = await fetchJson(`${baseUrl}/${idOrSlug}`, opts);
    detailed.push(detail || event);
  }

  const detailedCandidates = flattenMarkets(detailed.filter(Boolean));
  const combined = new Map(directCandidateMap);
  for (const candidate of detailedCandidates) {
    const key = marketKey(candidate.market, candidate.event);
    if (key && !combined.has(key)) combined.set(key, candidate);
  }
  return {
    candidates: [...combined.values()],
    attemptedQueries,
  };
}

async function fetchMidpoints(tokenIds, opts) {
  const ids = [...new Set(tokenIds.filter(Boolean).map(String))];
  if (!ids.length) return {};
  const clobBase = opts.clobBase || process.env.POLYMARKET_CLOB_BASE || DEFAULT_CLOB_BASE;
  const body = ids.map(tokenId => ({ token_id: tokenId }));
  const data = await fetchJson(`${clobBase.replace(/\/$/, '')}/midpoints`, {
    ...opts,
    method: 'POST',
    body,
  });
  return data && typeof data === 'object' ? data : {};
}

async function fetchSpreads(tokenIds, opts) {
  const ids = [...new Set(tokenIds.filter(Boolean).map(String))];
  if (!ids.length) return {};
  const clobBase = opts.clobBase || process.env.POLYMARKET_CLOB_BASE || DEFAULT_CLOB_BASE;
  const body = ids.map(tokenId => ({ token_id: tokenId }));
  const data = await fetchJson(`${clobBase.replace(/\/$/, '')}/spreads`, {
    ...opts,
    method: 'POST',
    body,
  });
  return data && typeof data === 'object' ? data : {};
}

function valuesForTokens(tokenIds, lookup) {
  return tokenIds.map(tokenId => asNumber(lookup?.[tokenId])).filter(value => value !== null && value > 0);
}

function spreadIsAcceptable(tokenIds, spreads, maxSpread) {
  const values = valuesForTokens(tokenIds, spreads);
  if (!values.length) return true;
  return Math.max(...values) <= maxSpread;
}

function directOutcomeMatch(spec, candidates, midpoints, spreads, opts) {
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  const maxSpread = numericOption(opts.maxSpread ?? process.env.POLYMARKET_PRICING_MAX_SPREAD, DEFAULT_MAX_SPREAD);
  let best = null;

  for (const { event, market } of candidates) {
    const tokens = getMarketTokenIds(market);
    const marketOutcomes = getMarketOutcomes(market);
    const prices = valuesForTokens(tokens, midpoints);
    const fallbackPrices = getOutcomePrices(market);
    let values = prices.length === outcomes.length ? prices : fallbackPrices;
    if (values.length !== outcomes.length) continue;
    if (isYesNoOutcomeSet(outcomes) && marketOutcomes.length === 2) {
      const yesIndex = marketOutcomes.findIndex(isYesLabel);
      const noIndex = marketOutcomes.findIndex(isNoLabel);
      if (yesIndex >= 0 && noIndex >= 0) {
        values = outcomes.map(outcome => isYesLabel(outcome) ? values[yesIndex] : values[noIndex]);
      }
    }

    const questionScore = Math.max(
      similarity(spec.question, market?.question || market?.title || ''),
      similarity(spec.question, event?.title || '')
    );
    const outcomeScore = outcomes.every((outcome, index) => {
      const marketOutcome = marketOutcomes[index] || '';
      return normalizeText(outcome) === normalizeText(marketOutcome);
    }) ? 1 : isYesNoOutcomeSet(outcomes) && marketOutcomes.length === 2 ? 0.88 : 0;
    const score = Math.max(questionScore, questionScore * 0.65 + outcomeScore * 0.35);
    if (!outcomeScore && !isYesNoOutcomeSet(outcomes)) continue;
    if (!spreadIsAcceptable(tokens, spreads, maxSpread)) continue;

    const normalized = normalizeProbabilities(values, outcomes.length, { minProbability: 0.02 });
    if (normalized.error) continue;
    const source = prices.length === outcomes.length ? 'polymarket:midpoint' : 'polymarket:outcome-prices';
    const match = {
      type: 'direct',
      score,
      source,
      probabilities: normalized.probabilities,
      marketId: market?.id,
      marketSlug: market?.slug,
      eventId: event?.id,
      eventSlug: event?.slug,
      question: market?.question || event?.title || null,
      prices: values,
      spreads: tokens.map(tokenId => spreads?.[tokenId] ?? null),
    };
    if (!best || match.score > best.score) best = match;
  }

  return best;
}

function parallelOutcomeMatch(spec, candidates, midpoints, spreads, opts) {
  const outcomes = Array.isArray(spec.outcomes) ? spec.outcomes : [];
  const maxSpread = numericOption(opts.maxSpread ?? process.env.POLYMARKET_PRICING_MAX_SPREAD, DEFAULT_MAX_SPREAD);
  const raw = [];
  const evidenceMarkets = [];

  for (const outcome of outcomes) {
    if (isOtherLabel(outcome)) {
      raw.push(0.04);
      continue;
    }

    let best = null;
    for (const { event, market } of candidates) {
      const tokens = getMarketTokenIds(market);
      if (tokens.length < 2 || !spreadIsAcceptable(tokens.slice(0, 1), spreads, maxSpread)) continue;

      const text = marketText(market, event);
      const outcomeScore = labelIncludedScore(outcome, text);
      const questionScore = Math.max(
        similarity(spec.question, event?.title || ''),
        similarity(spec.question, market?.question || market?.title || '')
      );
      const score = outcomeScore * 0.7 + questionScore * 0.3;
      if (outcomeScore < 0.55) continue;

      const midpoint = asNumber(midpoints?.[tokens[0]]);
      const fallback = getOutcomePrices(market)?.[0] ?? null;
      const price = midpoint && midpoint > 0 ? midpoint : fallback;
      if (!price || price <= 0) continue;

      const match = {
        score,
        price,
        source: midpoint ? 'polymarket:midpoint' : 'polymarket:outcome-prices',
        marketId: market?.id,
        marketSlug: market?.slug,
        eventId: event?.id,
        eventSlug: event?.slug,
        question: market?.question || event?.title || null,
        spread: spreads?.[tokens[0]] ?? null,
      };
      if (!best || match.score > best.score) best = match;
    }

    if (!best) return null;
    raw.push(best.price);
    evidenceMarkets.push(best);
  }

  const normalized = normalizeProbabilities(raw, outcomes.length, { minProbability: 0.02 });
  if (normalized.error) return null;
  const avgScore = evidenceMarkets.length
    ? evidenceMarkets.reduce((sum, item) => sum + item.score, 0) / evidenceMarkets.length
    : 0;
  const source = evidenceMarkets.some(item => item.source === 'polymarket:midpoint')
    ? 'polymarket:midpoint'
    : 'polymarket:outcome-prices';

  return {
    type: 'parallel',
    score: avgScore,
    source,
    probabilities: normalized.probabilities,
    marketId: evidenceMarkets[0]?.marketId || null,
    marketSlug: evidenceMarkets[0]?.marketSlug || null,
    eventId: evidenceMarkets[0]?.eventId || null,
    eventSlug: evidenceMarkets[0]?.eventSlug || null,
    question: evidenceMarkets[0]?.question || null,
    prices: raw,
    markets: evidenceMarkets,
  };
}

function buildEvidence(match) {
  return {
    source: 'polymarket',
    type: match.type,
    title: match.question,
    marketId: match.marketId || null,
    marketSlug: match.marketSlug || null,
    eventId: match.eventId || null,
    eventSlug: match.eventSlug || null,
    url: polymarketUrl(match),
    matchScore: Math.round(match.score * 1000) / 1000,
    prices: match.prices,
    spreads: match.spreads || match.markets?.map(item => item.spread ?? null) || [],
    fetchedAt: new Date().toISOString(),
  };
}

function attachPolymarketAttempt(spec, attempt) {
  const sourceData = spec.source_data && typeof spec.source_data === 'object'
    ? { ...spec.source_data }
    : {};
  const pricingSearch = sourceData.pricingSearch && typeof sourceData.pricingSearch === 'object'
    ? { ...sourceData.pricingSearch }
    : {};
  pricingSearch.polymarket = {
    ok: Boolean(attempt.ok),
    reason: attempt.reason || null,
    queries: Array.isArray(attempt.queries) ? attempt.queries.slice(0, DEFAULT_MAX_SEARCH_QUERIES) : [],
    candidates: Number.isFinite(Number(attempt.candidates)) ? Number(attempt.candidates) : 0,
    minScore: Number.isFinite(Number(attempt.minScore)) ? Number(attempt.minScore) : null,
    bestScore: Number.isFinite(Number(attempt.bestScore)) ? Math.round(Number(attempt.bestScore) * 1000) / 1000 : null,
    checkedAt: new Date().toISOString(),
  };
  sourceData.pricingSearch = pricingSearch;
  return {
    ...spec,
    source_data: sourceData,
  };
}

export async function tryAttachPolymarketPricing(spec = {}, opts = {}) {
  if (!shouldUsePolymarketPricing(spec)) return spec;

  const timeoutMs = numericOption(opts.timeoutMs ?? process.env.POLYMARKET_PRICING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const minScore = numericOption(opts.minScore ?? process.env.POLYMARKET_PRICING_MIN_SCORE, DEFAULT_MIN_SCORE);
  const fetchOpts = {
    ...opts,
    timeoutMs,
  };

  const discovery = await discoverMarketCandidates(spec, fetchOpts);
  const candidates = discovery.candidates || [];
  const queries = discovery.attemptedQueries || [];
  if (!candidates.length) {
    return attachPolymarketAttempt(spec, {
      ok: false,
      reason: queries.length ? 'no_candidates' : 'no_query',
      queries,
      candidates: 0,
      minScore,
    });
  }

  const tokenIds = candidates.flatMap(({ market }) => getMarketTokenIds(market));
  const [midpoints, spreads] = await Promise.all([
    fetchMidpoints(tokenIds, fetchOpts),
    fetchSpreads(tokenIds, fetchOpts),
  ]);

  const matches = [
    directOutcomeMatch(spec, candidates, midpoints, spreads, fetchOpts),
    isYesNoOutcomeSet(spec.outcomes || []) ? null : parallelOutcomeMatch(spec, candidates, midpoints, spreads, fetchOpts),
  ].filter(Boolean);
  const best = matches.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < minScore) {
    return attachPolymarketAttempt(spec, {
      ok: false,
      reason: best ? 'score_below_threshold' : 'no_match',
      queries,
      candidates: candidates.length,
      minScore,
      bestScore: best?.score ?? null,
    });
  }

  const currentEvidence = Array.isArray(spec?.source_data?.suggestedPricing?.evidence)
    ? spec.source_data.suggestedPricing.evidence
    : [];
  const specWithAttempt = attachPolymarketAttempt(spec, {
    ok: true,
    queries,
    candidates: candidates.length,
    minScore,
    bestScore: best.score,
  });
  return attachSuggestedPricing(specWithAttempt, {
    source: best.source,
    probabilities: best.probabilities,
    rationale: 'Referencia tomada de Polymarket para abrir con una probabilidad inicial mas realista; admin puede editarla antes de aprobar.',
    evidence: [
      ...currentEvidence,
      buildEvidence(best),
    ],
  });
}
