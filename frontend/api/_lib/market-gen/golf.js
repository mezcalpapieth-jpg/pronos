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
 * Resolution stays manual — admin picks the winner once the
 * tournament finishes. A future sports_api resolver can read the
 * leaderboard's 1st-place finisher via ESPN (post-event that
 * endpoint works fine).
 */

const PGA = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// ESPN headshot CDN pattern — stable across the site.
function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/pga/players/full/${id}.png` : null;
}

// Top-tier PGA field. ESPN athlete IDs are the stable key for
// headshots; picked by current world-ranking / Race to the Cup
// form. Edit this list to refocus the market on a different pool.
const FIELD = [
  { id: '9478',    name: 'Scottie Scheffler' },
  { id: '3470',    name: 'Rory McIlroy' },
  { id: '10140',   name: 'Xander Schauffele' },
  { id: '10046',   name: 'Bryson DeChambeau' },
  { id: '10592',   name: 'Ludvig Åberg' },
  { id: '9131',    name: 'Viktor Hovland' },
  { id: '10909',   name: 'Collin Morikawa' },
  { id: '5860',    name: 'Hideki Matsuyama' },
  { id: '8286',    name: 'Justin Thomas' },
  { id: '8143',    name: 'Patrick Cantlay' },
  { id: '11118',   name: 'Sam Burns' },
  { id: '9468',    name: 'Jordan Spieth' },
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
  // even when a dark-horse wins.
  const legs = [
    ...FIELD.map(p => ({ label: p.name, playerId: p.id })),
    { label: 'Otro', playerId: null },
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
    // Manual for now — sports_api resolver for PGA can read the
    // leaderboard's 1st-place finisher post-event. TODO once we
    // wire a readPgaWinner() helper.
    resolver_type: 'manual',
    resolver_config: {
      source: 'manual',
      eventId: ev.id,
      shape: 'parallel',
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
