/**
 * PGA golf generator — next-tournament winner prediction.
 *
 * Pulls the nearest upcoming PGA TOUR event from ESPN's scoreboard
 * and emits ONE parallel market ("¿Quién gana el <Tournament>?")
 * with a hardcoded top-tier field of legs plus an "Otro" catchall.
 *
 * Why hardcoded legs: ESPN's free tier doesn't expose the pre-
 * tournament commitment / entries list, so we can't enumerate the
 * field dynamically. The top-12 covers most realistic winners; any
 * longshot win resolves to "Otro".
 *
 * Resolution: sports_api via espn-pga reader (sports-results.js).
 * Once the tournament's status.type.completed flips true on ESPN,
 * the cron auto-resolver picks the position-1 player and matches
 * by driverId (the FIELD entry's `id` below) against the leg list.
 * Dark-horse wins fall through to the "Otro" catchall leg.
 */

const PGA = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// ESPN headshot CDN pattern — confirmed working via HEAD probes
// against the `golf/players` path (the earlier `pga/players` guess
// was wrong — all 404s). IDs below were verified via ESPN's search
// API. Update if ESPN re-orgs their CDN.
function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
}

// Top-tier PGA field. IDs verified by mapping ESPN's PGA scoreboard
// responses back to athlete display names (a HEAD-200 against the
// headshot CDN proves the id exists, but NOT that it points at the
// right person — earlier versions of this file had wrong ids that
// never matched winners). Edit to refocus the market on a different
// pool.
//
// PGA-tour-only golfers below. LIV defectors don't play regular
// PGA events anymore — they only show up on ESPN's PGA scoreboard
// when a major (Masters / PGA / US Open / The Open) is on the
// calendar, since the majors are run by independent bodies and
// invite both tours. We add the LIV stars in via MAJORS_LIV_EXTRAS
// only when the upcoming event is one of those four — see
// isMajorEvent() below.
const PGA_FIELD = [
  { id: '9478',    name: 'Scottie Scheffler' },
  { id: '3470',    name: 'Rory McIlroy' },
  { id: '10140',   name: 'Xander Schauffele' },
  { id: '4375972', name: 'Ludvig Åberg' },
  { id: '4364873', name: 'Viktor Hovland' },
  { id: '10592',   name: 'Collin Morikawa' },
  { id: '5860',    name: 'Hideki Matsuyama' },
  { id: '5539',    name: 'Tommy Fleetwood' },
  { id: '6007',    name: 'Patrick Cantlay' },
  { id: '9938',    name: 'Sam Burns' },
  { id: '5467',    name: 'Jordan Spieth' },
  { id: '4848',    name: 'Justin Thomas' },
];

// LIV golfers who are realistic contenders at the four majors and
// should appear as outcomes ONLY when the upcoming event is a
// major. Adding them to non-major PGA events would put a non-entrant
// on the leaderboard — the market would always resolve to "Otro"
// for them, which looks broken from the user's side.
const MAJORS_LIV_EXTRAS = [
  { id: '10046', name: 'Bryson DeChambeau' },
  { id: '9780',  name: 'Jon Rahm' },
];

// True when the ESPN event name matches one of the four majors. The
// Masters Tournament, PGA Championship, U.S. Open, and The Open
// Championship are the only PGA-scoreboard events where LIV players
// can compete (and frequently win — Rahm '23 Masters, DeChambeau '24
// US Open). Everything else is PGA-only.
function isMajorEvent(name) {
  if (!name) return false;
  const n = String(name).toLowerCase();
  return /\bmasters\b/.test(n)              // "Masters Tournament"
      || /\bpga championship\b/.test(n)     // "PGA Championship"
      || /\bu\.?s\.? open\b/.test(n)        // "U.S. Open" / "US Open"
      || /\bthe open\b/.test(n)             // "The Open Championship"
      || /\bopen championship\b/.test(n);
}

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

async function fetchNextTournament() {
  const now = new Date();
  const horizon = new Date(now.getTime() + 60 * 86_400_000); // 60 days
  const dates = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
  try {
    const res = await fetch(`${PGA}?dates=${dates}&limit=50`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    // Filter to pre-tournament events so we don't seed a market for
    // one that's already live/finished. ESPN sets state='pre' until
    // the first round begins.
    const upcoming = events
      .filter(e => e?.status?.type?.state === 'pre')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return upcoming[0] || null;
  } catch (e) {
    console.error('[market-gen/golf] fetch failed', { message: e?.message });
    return null;
  }
}

export async function generateGolfMarkets() {
  const ev = await fetchNextTournament();
  if (!ev) return [];

  // Each PGA event spans ~4 days (Thu–Sun). `ev.date` is the Thursday
  // tee-off UTC; market closes Sunday evening when the winner is
  // known. Padding 5 days past start covers any weather delay.
  const startMs = new Date(ev.date).getTime();
  if (!Number.isFinite(startMs)) return [];
  const startTime = new Date(startMs).toISOString();
  const endTime = new Date(startMs + 5 * 86_400_000).toISOString();

  // Field for THIS event: regular PGA tournaments use PGA_FIELD only;
  // the four majors (Masters, PGA Championship, US Open, The Open)
  // also include the LIV stars who actually play those events. See
  // isMajorEvent() and MAJORS_LIV_EXTRAS for the rule.
  const eventField = isMajorEvent(ev.name)
    ? [...PGA_FIELD, ...MAJORS_LIV_EXTRAS]
    : PGA_FIELD;

  // Include an "Otro" catchall so the market is always resolvable
  // even when a dark-horse wins. Field name `driverId` is the
  // shared key the cron's parallel-shape dispatch matches against
  // (originally F1, now also golf via espn-pga). Keeping the same
  // name avoids a sport-specific code path in the cron.
  const legs = [
    ...eventField.map(p => ({ label: p.name, driverId: p.id })),
    { label: 'Otro', driverId: null },
  ];

  return [{
    source: 'espn-pga',
    source_event_id: `pga:${ev.id}`,
    sport: 'golf',
    league: 'pga',
    question: `¿Quién gana el ${ev.name}?`,
    category: 'deportes',
    icon: '⛳',
    outcomes: legs.map(l => l.label),
    outcome_images: [
      ...eventField.map(p => headshot(p.id)),
      null, // Otro
    ],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'parallel',
    // sports_api auto-resolution via espn-pga reader. The cron polls
    // ESPN's PGA scoreboard, finds this eventId, and picks the
    // position-1 player when the tournament reports completed=true.
    // Player ID match → exact leg; name match → fallback; "Otro"
    // catches any winner outside FIELD.
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn-pga',
      shape: 'parallel',
      eventId: ev.id,
      legs,
    },
    source_data: {
      eventId: ev.id,
      tournamentName: ev.name,
      startDateIso: ev.date,
      isMajor: isMajorEvent(ev.name),
      // Persist the per-event field (with LIV extras for majors) so
      // backfill-resolvers can rebuild outcome_images and resolver
      // legs from this row alone, without having to recompute the
      // major-detection logic later.
      field: eventField,
    },
  }];
}
