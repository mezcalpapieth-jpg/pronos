/**
 * Boxing generator — emits a parallel-binary market per upcoming
 * filter-passing boxing fight via the-odds-api.com.
 *
 * Why the-odds-api: ESPN dropped their public boxing scoreboard
 * (returns 404), BoxRec is Cloudflare-walled, every other free
 * boxing source we probed was either empty or paid. the-odds-api's
 * free tier (500 req/month) gives us ~30 daily polls + ~20 weekly
 * resolution polls — well under cap.
 *
 * Env: ODDS_API_KEY (set in Vercel). Generator silently no-ops when
 * the key is missing, mirroring how generateLivMarkets bails when
 * ESPN returns nothing.
 *
 * Filter — generate a market only if ANY of:
 *   1. Mexican boxer on either side (name-list match — the-odds-api
 *      doesn't carry nationality)
 *   2. Marquee boxer on either side (allowlist in marquee-fighters.js)
 *
 * No "title fight" detection because the-odds-api's events array
 * doesn't expose title-at-stake metadata. Marquee + Mexican capture
 * ~all the title fights worth a market in practice.
 *
 * Source: 'odds-api-boxing'
 * Source_event_id: `boxing:${event.id}`  (unique per fight in their feed)
 */

import { isMarqueeBoxer, isMexicanBoxer } from './marquee-fighters.js';
import {
  attachSuggestedPricing,
  impliedProbabilitiesFromOdds,
  normalizeProbabilities,
} from '../market-pricing.js';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'boxing_boxing';
const FIGHT_IMPORT_HORIZON_DAYS = 14;

function authKey() {
  return process.env.ODDS_API_KEY || null;
}

async function fetchUpcomingBoxingEvents() {
  const key = authKey();
  if (!key) return [];
  try {
    const res = await fetch(
      `${ODDS_API_BASE}/sports/${SPORT_KEY}/events?apiKey=${encodeURIComponent(key)}&dateFormat=iso`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) {
      console.warn('[market-gen/boxing] events HTTP', res.status);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[market-gen/boxing] fetch failed', { message: e?.message });
    return [];
  }
}

async function fetchH2hOddsByEventIds(eventIds = []) {
  const key = authKey();
  const ids = [...new Set(eventIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!key || ids.length === 0) return new Map();
  try {
    const url = `${ODDS_API_BASE}/sports/${SPORT_KEY}/odds?apiKey=${encodeURIComponent(key)}`
      + `&regions=us&markets=h2h&oddsFormat=decimal&dateFormat=iso`
      + `&eventIds=${encodeURIComponent(ids.join(','))}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      console.warn('[market-gen/boxing] odds HTTP', res.status);
      return new Map();
    }
    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    return new Map(rows.map(ev => [String(ev.id), ev]));
  } catch (e) {
    console.error('[market-gen/boxing] odds fetch failed', { message: e?.message });
    return new Map();
  }
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function extractH2hProbabilities(oddsEvent, outcomes = []) {
  const labels = Array.isArray(outcomes) ? outcomes.filter(Boolean) : [];
  if (!oddsEvent || labels.length < 2) return null;
  const targetKeys = labels.map(normalizeName);
  const vectors = [];
  const evidence = [];

  for (const bookmaker of oddsEvent.bookmakers || []) {
    const market = (bookmaker.markets || []).find(m => m?.key === 'h2h');
    const marketOutcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
    if (!marketOutcomes.length) continue;

    const prices = targetKeys.map(key => {
      const found = marketOutcomes.find(o => normalizeName(o?.name) === key);
      return found ? Number(found.price) : null;
    });
    if (prices.some(v => !Number.isFinite(v) || v <= 1)) continue;

    const implied = impliedProbabilitiesFromOdds(prices, { format: 'decimal' });
    if (implied.error) continue;
    vectors.push(implied.probabilities);
    evidence.push({
      bookmaker: bookmaker.title || bookmaker.key || 'bookmaker',
      prices,
    });
  }

  if (!vectors.length) return null;
  const averaged = targetKeys.map((_, i) => (
    vectors.reduce((sum, probs) => sum + probs[i], 0) / vectors.length
  ));
  const normalized = normalizeProbabilities(averaged, targetKeys.length, { minProbability: 0.02 });
  if (normalized.error) return null;

  return {
    probabilities: normalized.probabilities,
    probabilityPct: normalized.probabilityPct,
    bookmakerCount: vectors.length,
    evidence,
  };
}

function isLikelyPlaceholderFightDate(d) {
  return d.getUTCMonth() === 0 && d.getUTCDate() === 1;
}

function shouldKeepFightDate(value, now = new Date()) {
  const atMs = new Date(value).getTime();
  if (!Number.isFinite(atMs)) return false;
  const at = new Date(atMs);
  if (isLikelyPlaceholderFightDate(at)) return false;
  const nowMs = now.getTime();
  if (atMs <= nowMs) return false;
  return atMs <= nowMs + FIGHT_IMPORT_HORIZON_DAYS * 86_400_000;
}

function shouldGenerateFor(home, away) {
  if (!home || !away) return false;
  if (isMexicanBoxer(home) || isMexicanBoxer(away)) return true;
  if (isMarqueeBoxer(home) && isMarqueeBoxer(away)) return true;
  return false;
}

function buildBoxingMarket(ev) {
  const home = ev.home_team || '';
  const away = ev.away_team || '';
  const commenceMs = new Date(ev.commence_time).getTime();
  if (!Number.isFinite(commenceMs)) return null;
  const startTime = new Date(commenceMs).toISOString();
  // Pad 6 hours past commence so late-card main events still get
  // resolved in the same trading window.
  const endTime = new Date(commenceMs + 6 * 3600_000).toISOString();

  const legs = [
    { label: home, driverId: home },
    { label: away, driverId: away },
  ];

  return {
    source: 'odds-api-boxing',
    source_event_id: `boxing:${ev.id}`,
    sport: 'combate',
    league: 'boxing',
    question: `¿Quién gana ${home} vs ${away}?`,
    category: 'deportes',
    icon: '🥊',
    outcomes: legs.map(l => l.label),
    // No headshots from the-odds-api; leave images null. Admin can
    // patch in via edit-market if desired.
    outcome_images: [null, null],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'odds-api-boxing',
      shape: 'parallel',
      eventId: ev.id,
      legs,
    },
    source_data: {
      eventId: ev.id,
      home,
      away,
      commenceTimeIso: ev.commence_time,
      sportTitle: ev.sport_title || 'Boxing',
    },
  };
}

export async function generateBoxingMarkets() {
  const events = await fetchUpcomingBoxingEvents();
  if (events.length === 0) return [];

  const specs = [];
  for (const ev of events) {
    const home = ev.home_team;
    const away = ev.away_team;
    if (!shouldGenerateFor(home, away)) continue;
    if (!shouldKeepFightDate(ev.commence_time)) continue;
    try {
      const spec = buildBoxingMarket(ev);
      if (spec) specs.push(spec);
    } catch (e) {
      console.warn('[market-gen/boxing] skip event — build failed', {
        eventId: ev.id,
        error: e?.message,
      });
    }
  }
  const oddsById = await fetchH2hOddsByEventIds(
    specs.map(s => s.source_data?.eventId).filter(Boolean),
  );

  return specs.map(spec => {
    const oddsEvent = oddsById.get(String(spec.source_data?.eventId || ''));
    const consensus = extractH2hProbabilities(oddsEvent, spec.outcomes);
    if (!consensus) return spec;
    return attachSuggestedPricing(spec, {
      probabilities: consensus.probabilities,
      source: 'the-odds-api:h2h',
      rationale: `Promedio de ${consensus.bookmakerCount} books en moneyline.`,
      evidence: consensus.evidence,
    });
  });
}

export const _internal = {
  extractH2hProbabilities,
  fetchH2hOddsByEventIds,
  shouldGenerateFor,
  shouldKeepFightDate,
};
