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

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'boxing_boxing';

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

function shouldGenerateFor(home, away) {
  if (!home || !away) return false;
  if (isMexicanBoxer(home) || isMexicanBoxer(away)) return true;
  if (isMarqueeBoxer(home) || isMarqueeBoxer(away)) return true;
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
  return specs;
}
