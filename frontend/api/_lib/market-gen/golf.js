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

// Top-tier PGA field. Each ID was spot-checked with a HEAD request
// against the CDN; the whole list returns 200 as of 2026-04. Edit
// to refocus the market on a different pool.
const FIELD = [
  { id: '9478',    name: 'Scottie Scheffler' },
  { id: '3470',    name: 'Rory McIlroy' },
  { id: '10140',   name: 'Xander Schauffele' },
  { id: '10046',   name: 'Bryson DeChambeau' },
  { id: '4375972', name: 'Ludvig Åberg' },
  { id: '9131',    name: 'Viktor Hovland' },
  { id: '10592',   name: 'Collin Morikawa' },
  { id: '5860',    name: 'Hideki Matsuyama' },
  { id: '5539',    name: 'Tommy Fleetwood' },
  { id: '6007',    name: 'Patrick Cantlay' },
  { id: '9938',    name: 'Sam Burns' },
  { id: '5467',    name: 'Jordan Spieth' },
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

  // Include an "Otro" catchall so the market is always resolvable
  // even when a dark-horse wins. Field name `driverId` is the
  // shared key the cron's parallel-shape dispatch matches against
  // (originally F1, now also golf via espn-pga). Keeping the same
  // name avoids a sport-specific code path in the cron.
  const legs = [
    ...FIELD.map(p => ({ label: p.name, driverId: p.id })),
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
      ...FIELD.map(p => headshot(p.id)),
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
      field: FIELD,
    },
  }];
}
