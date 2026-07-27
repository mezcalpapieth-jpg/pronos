import { attachSuggestedPricing, normalizeProbabilities } from './market-pricing.js';

const DEFAULT_GAMMA_BASE = 'https://gamma-api.polymarket.com';
const DEFAULT_CLOB_BASE = 'https://clob.polymarket.com';
const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MIN_SCORE = 0.48;
const DEFAULT_MAX_SPREAD = 0.18;
const MAX_EVENTS_TO_FETCH = 3;

const STRONG_PRICING_SOURCES = new Set([
  'admin-config',
  'the-odds-api:h2h',
  'anthropic-pricing',
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
  return normalized === 'uniform-default' || normalized.startsWith('source-signals:');
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
  const raw = safeJson(market?.clobTokenIds) || market?.clobTokenIds;
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
  const raw = safeJson(market?.outcomePrices) || market?.outcomePrices;
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

function parseSearchEvents(payload) {
  if (Array.isArray(payload?.events)) return payload.events;
  if (Array.isArray(payload?.results)) {
    return payload.results
      .map(item => item?.event || item)
      .filter(item => item?.id || item?.slug);
  }
  return [];
}

async function discoverEvents(spec, opts) {
  const gammaBase = opts.gammaBase || process.env.POLYMARKET_GAMMA_BASE || DEFAULT_GAMMA_BASE;
  const query = [
    spec.question,
    spec.source_data?.artist,
    spec.source_data?.showLabel,
    spec.source_data?.awardLabel,
    spec.source_data?.topic,
  ].filter(Boolean).join(' ');
  if (!query.trim()) return [];

  const searchUrl = `${gammaBase.replace(/\/$/, '')}/public-search?${new URLSearchParams({ q: query })}`;
  const search = await fetchJson(searchUrl, opts);
  const events = parseSearchEvents(search).slice(0, MAX_EVENTS_TO_FETCH);

  const detailed = [];
  for (const event of events) {
    const idOrSlug = event.id
      ? `events/${encodeURIComponent(event.id)}`
      : `events/slug/${encodeURIComponent(event.slug)}`;
    const detail = await fetchJson(`${gammaBase.replace(/\/$/, '')}/${idOrSlug}`, opts);
    detailed.push(detail || event);
  }
  return detailed.filter(Boolean);
}

function flattenMarkets(events) {
  const markets = [];
  for (const event of events) {
    for (const market of Array.isArray(event?.markets) ? event.markets : []) {
      markets.push({ event, market });
    }
  }
  return markets;
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

export async function tryAttachPolymarketPricing(spec = {}, opts = {}) {
  if (!shouldUsePolymarketPricing(spec)) return spec;

  const timeoutMs = numericOption(opts.timeoutMs ?? process.env.POLYMARKET_PRICING_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const minScore = numericOption(opts.minScore ?? process.env.POLYMARKET_PRICING_MIN_SCORE, DEFAULT_MIN_SCORE);
  const fetchOpts = {
    ...opts,
    timeoutMs,
  };

  const events = await discoverEvents(spec, fetchOpts);
  const candidates = flattenMarkets(events);
  if (!candidates.length) return spec;

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
  if (!best || best.score < minScore) return spec;

  const currentEvidence = Array.isArray(spec?.source_data?.suggestedPricing?.evidence)
    ? spec.source_data.suggestedPricing.evidence
    : [];
  return attachSuggestedPricing(spec, {
    source: best.source,
    probabilities: best.probabilities,
    rationale: 'Referencia tomada de Polymarket para abrir con una probabilidad inicial mas realista; admin puede editarla antes de aprobar.',
    evidence: [
      ...currentEvidence,
      buildEvidence(best),
    ],
  });
}
