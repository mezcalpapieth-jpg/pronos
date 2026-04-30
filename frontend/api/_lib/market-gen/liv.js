/**
 * LIV Golf generator — next-tournament winner prediction.
 *
 * Mirrors golf.js (PGA) almost identically, but points at ESPN's
 * /sports/golf/liv/scoreboard endpoint and uses the LIV-specific
 * field. We emit ONE parallel market per upcoming LIV event:
 * "¿Quién gana el <Event>?" with a hardcoded top field plus an
 * "Otro" catchall.
 *
 * Why hardcoded legs: LIV's individual entry list isn't exposed in
 * the pre-event ESPN response (only competitions/competitors after
 * round 1 starts). The top names are stable across the season, so a
 * curated list of ~12 covers most realistic individual winners.
 *
 * Resolution: sports_api via espn-liv reader (sports-results.js).
 * Once the tournament's status.type.completed flips true on ESPN,
 * the cron auto-resolver picks the position-1 player and matches by
 * driverId (the FIELD entry's `id` below) against the leg list.
 *
 * NOTE on team scoring: LIV runs a 4-man team competition alongside
 * the individual leaderboard. We resolve on the individual winner
 * (order=1 in ESPN's scoreboard). Team-leaderboard markets would
 * need a separate generator since the entrants are different.
 */

const LIV = 'https://site.api.espn.com/apis/site/v2/sports/golf/liv/scoreboard';

// ESPN headshot CDN — same path as PGA. IDs verified by mapping
// completed-event leaderboards back to athlete display names
// (see git history for the verification pass).
function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
}

// Top-tier LIV roster. IDs verified against LIV scoreboard responses
// for 2025-2026 events. Kept narrow enough that the FIELD covers
// realistic winners without drowning the UI in 50 options.
const FIELD = [
  { id: '10046', name: 'Bryson DeChambeau' },
  { id: '9780',  name: 'Jon Rahm' },
  { id: '9131',  name: 'Cameron Smith' },
  { id: '3448',  name: 'Dustin Johnson' },
  { id: '11099', name: 'Joaquín Niemann' },
  { id: '5553',  name: 'Tyrrell Hatton' },
  { id: '9513',  name: 'Talor Gooch' },
  { id: '308',   name: 'Phil Mickelson' },
  { id: '158',   name: 'Sergio García' },
  { id: '9261',  name: 'Abraham Ancer' },
  { id: '5532',  name: 'Carlos Ortiz' },
  { id: '9031',  name: 'Thomas Pieters' },
];

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

async function fetchNextTournament() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000); // 60 days
  const dates = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
  try {
    const res = await fetch(`${LIV}?dates=${dates}&limit=50`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    const upcoming = events
      .filter(e => e?.status?.type?.state === 'pre')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming[0] || null;
  } catch (e) {
    console.error('[market-gen/liv] fetch failed', { message: e?.message });
    return null;
  }
}

export async function generateLivMarkets() {
  const ev = await fetchNextTournament();
  if (!ev) return [];

  // LIV events are shotgun-start 3-rounders Fri-Sun. ev.date is
  // Friday tee-off UTC; final round wraps Sunday. Pad 4 days past
  // start so weather/Monday-finish doesn't strand the market.
  const startMs = new Date(ev.date).getTime();
  if (!Number.isFinite(startMs)) return [];
  const startTime = new Date(startMs).toISOString();
  const endTime = new Date(startMs + 4 * 86_400_000).toISOString();

  const legs = [
    ...FIELD.map(p => ({ label: p.name, driverId: p.id })),
    { label: 'Otro', driverId: null },
  ];

  return [{
    source: 'espn-liv',
    source_event_id: `liv:${ev.id}`,
    sport: 'golf',
    league: 'liv',
    question: `¿Quién gana el ${ev.name}?`,
    category: 'deportes',
    icon: '⛳',
    outcomes: legs.map(l => l.label),
    outcome_images: [
      ...FIELD.map(p => headshot(p.id)),
      null, // Otro
    ],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    // sports_api auto-resolution via espn-liv reader. The cron polls
    // ESPN's LIV scoreboard, finds this eventId, and picks the
    // order=1 player when the tournament reports completed=true.
    // Player ID match → exact leg; name match → fallback; "Otro"
    // catches any winner outside FIELD.
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn-liv',
      shape: 'parallel',
      eventId: ev.id,
      legs,
    },
    source_data: {
      eventId: ev.id,
      tournamentName: ev.name,
      startDateIso: ev.date,
      field: FIELD,
    },
  }];
}
