/**
 * UFC market generator — emits ONE parallel-binary market per
 * filter-passing fight on every upcoming UFC card.
 *
 * Source: ESPN MMA scoreboard
 *   https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard
 *
 * Each event (UFC numbered PPV or UFC Fight Night) carries N
 * competitions; each competition is one fight. We filter to:
 *
 *   1. PPV main event (event name starts with "UFC " + digits)
 *      AND the fight is the last competition on the card
 *   2. EITHER fighter is on the marquee allowlist
 *   3. EITHER fighter has a Mexican flag
 *   4. EITHER fighter has a LATAM flag (broader)
 *
 * Markets are 2-leg parallel: each leg is a binary Yes/No for one
 * fighter. UFC has no draws as a practical matter (technically split
 * draws happen ~0.1% of fights — when one does the reader returns
 * completed=false and admin handles via the void-market endpoint).
 *
 * source             = 'espn-mma'
 * source_event_id    = 'mma:<eventId>:<fightId>'  (unique per fight)
 */

import {
  isMarqueeUfcFighter,
  isMexicanFighter,
  isLatamFighter,
} from './marquee-fighters.js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const FIGHT_IMPORT_HORIZON_DAYS = 14;

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function isPpvNumbered(eventName) {
  // UFC PPVs are named "UFC 327: ...", "UFC 328: ..." — numbered
  // events vs "UFC Fight Night: ...". A regex on the leading
  // "UFC <number>" disambiguates without a hardcoded list.
  return /^UFC\s+\d+\b/i.test(String(eventName || ''));
}

function headshot(athleteId) {
  return athleteId
    ? `https://a.espncdn.com/i/headshots/mma/players/full/${athleteId}.png`
    : null;
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

async function fetchUpcomingEvents() {
  // Two-week forward window keeps the pending queue focused on fights
  // admins can approve soon instead of every upcoming card.
  const now = new Date();
  const horizon = new Date(now.getTime() + FIGHT_IMPORT_HORIZON_DAYS * 86_400_000);
  const dates = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
  try {
    const res = await fetch(`${SCOREBOARD}?dates=${dates}&limit=30`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    console.error('[market-gen/ufc] fetch failed', { message: e?.message });
    return [];
  }
}

// Decide if a fight should get a market.
function shouldGenerateFor(fight, eventName, isLastOnCard) {
  const a = fight.competitors?.[0]?.athlete || {};
  const b = fight.competitors?.[1]?.athlete || {};
  if (!a.displayName || !b.displayName) return false;

  // Skip already-completed fights — the cron polls upcoming, so a
  // 'post' state here means stale data. Markets only make sense
  // for 'pre' or 'in' fights.
  const state = fight?.status?.type?.state;
  if (state === 'post') return false;

  // 1. PPV main event (last fight on a numbered card)
  if (isPpvNumbered(eventName) && isLastOnCard) return true;

  // 2. Marquee fighter on either side
  if (isMarqueeUfcFighter(a.displayName) || isMarqueeUfcFighter(b.displayName)) {
    return true;
  }

  // 3. Mexican / LATAM nationality
  const flagA = a.flag?.alt;
  const flagB = b.flag?.alt;
  if (isMexicanFighter(flagA) || isMexicanFighter(flagB)) return true;
  if (isLatamFighter(flagA) || isLatamFighter(flagB)) return true;

  return false;
}

// Build the market spec for one fight.
function buildFightMarket(ev, fight, isLastOnCard) {
  const a = fight.competitors[0];
  const b = fight.competitors[1];
  const aName = a.athlete.displayName;
  const bName = b.athlete.displayName;
  const aId   = String(a.id || '');
  const bId   = String(b.id || '');

  // Fight time — competition.date is the scheduled start of THAT
  // fight (within the event window). Pad 4h for the bout to wrap.
  const startMs = new Date(fight.date || ev.date).getTime();
  const startTime = new Date(startMs).toISOString();
  const endTime   = new Date(startMs + 4 * 3600_000).toISOString();

  const weightClass = fight.type?.abbreviation || 'Catchweight';
  const isMain = isLastOnCard && isPpvNumbered(ev.name);

  const legs = [
    { label: aName, driverId: aId },
    { label: bName, driverId: bId },
  ];

  return {
    source: 'espn-mma',
    source_event_id: `mma:${ev.id}:${fight.id}`,
    // sport='combate' is the new umbrella for fighting markets in
    // PointsCategoryPage; UFC + boxing land under it via the
    // league sidebar (see PointsCategoryPage SPORT_TABS + the
    // COMBATE_LEAGUES list).
    sport: 'combate',
    league: 'ufc',
    question: `¿Quién gana ${aName} vs ${bName}?`,
    category: 'deportes',
    icon: '🥊',
    outcomes: legs.map(l => l.label),
    outcome_images: [headshot(aId), headshot(bId)],
    seed_liquidity: isMain ? 1500 : 800,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn-mma',
      shape: 'parallel',
      eventId: ev.id,
      fightId: fight.id,
      legs,
    },
    source_data: {
      eventId: ev.id,
      fightId: fight.id,
      eventName: ev.name,
      eventDateIso: ev.date,
      weightClass,
      isMainEvent: isMain,
      cardPosition: isLastOnCard ? 'main' : 'undercard',
      fighters: [
        { id: aId, name: aName, flag: a.athlete.flag?.alt || null },
        { id: bId, name: bName, flag: b.athlete.flag?.alt || null },
      ],
    },
  };
}

export async function generateUfcMarkets() {
  const events = await fetchUpcomingEvents();
  if (events.length === 0) return [];

  const specs = [];
  for (const ev of events) {
    const fights = Array.isArray(ev.competitions) ? ev.competitions : [];
    if (fights.length === 0) continue;

    // ESPN orders the array prelims first → main card → main event
    // last. Index-based lastOnCard works for both PPV and Fight
    // Night cards.
    const lastIdx = fights.length - 1;

    for (let i = 0; i < fights.length; i++) {
      const fight = fights[i];
      const isLastOnCard = i === lastIdx;
      if (!shouldKeepFightDate(fight.date || ev.date)) continue;
      if (!shouldGenerateFor(fight, ev.name, isLastOnCard)) continue;
      try {
        specs.push(buildFightMarket(ev, fight, isLastOnCard));
      } catch (e) {
        console.warn('[market-gen/ufc] skip fight — build failed', {
          eventId: ev.id,
          fightId: fight.id,
          error: e?.message,
        });
      }
    }
  }
  return specs;
}

export const _internal = {
  shouldKeepFightDate,
};
