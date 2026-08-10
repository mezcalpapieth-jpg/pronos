/**
 * PGA golf generator — next-tournament winner prediction.
 *
 * Pulls the nearest upcoming PGA TOUR event from ESPN's scoreboard
 * and emits ONE parallel market ("¿Quién gana el <Tournament>?")
 * once ESPN exposes confirmed competitors for that event. Static
 * ranking lists only prioritize confirmed entrants; they no longer
 * create markets by themselves.
 *
 * Resolution: sports_api via espn-pga reader (sports-results.js).
 * Once the tournament's status.type.completed flips true on ESPN,
 * the cron auto-resolver picks the position-1 player and matches
 * by ESPN athlete id or label against the leg list. Dark-horse
 * wins fall through to the "Otro" catchall leg.
 */

const PGA = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const MAX_FIELD_OUTCOMES = 40;
const MIN_CONFIRMED_GOLF_FIELD = 8;

// ESPN headshot CDN pattern — confirmed working via HEAD probes
// against the `golf/players` path (the earlier `pga/players` guess
// was wrong — all 404s). IDs below were verified via ESPN's search
// API. Update if ESPN re-orgs their CDN.
function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
}

// Top-tier PGA priority list. IDs verified by mapping ESPN's PGA scoreboard
// responses back to athlete display names (a HEAD-200 against the
// headshot CDN proves the id exists, but NOT that it points at the
// right person — earlier versions of this file had wrong ids that
// never matched winners). These names are not market entrants unless
// ESPN confirms they are in the actual event field.
//
// PGA-tour-only golfers below. LIV defectors don't play regular
// PGA events anymore — they only show up on ESPN's PGA scoreboard
// when a major (Masters / PGA / US Open / The Open) is on the
// calendar, since the majors are run by independent bodies and
// invite both tours. The priority list below still cannot add a
// golfer unless ESPN's event field includes him.
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

// LIV golfers who are realistic contenders at the four majors. This
// is also priority-only now: they appear only when ESPN includes
// them in a major's actual competitor list.
const MAJORS_LIV_EXTRAS = [
  { id: '10046', name: 'Bryson DeChambeau' },
  { id: '9780',  name: 'Jon Rahm' },
];

const GOLF_PRIORITY_FIELD = [...PGA_FIELD, ...MAJORS_LIV_EXTRAS];
const GOLF_PRIORITY_BY_ID = new Map(GOLF_PRIORITY_FIELD.map((p, index) => [String(p.id), index]));
const GOLF_PRIORITY_BY_NAME = new Map(GOLF_PRIORITY_FIELD.map((p, index) => [normalizeName(p.name), index]));

function normalizeName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const num = Number(String(value).replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(num) ? num : null;
}

function isPlaceholderGolfName(name) {
  const normalized = normalizeName(name);
  return !normalized
    || normalized === 'tbd'
    || normalized === 'to be determined'
    || normalized === 'field'
    || normalized === 'the field'
    || normalized === 'other'
    || normalized === 'others';
}

function golfCompetitorToEntrant(competitor, order) {
  const athlete = competitor?.athlete || {};
  const team = competitor?.team || {};
  const isTeam = competitor?.type === 'team';
  const id = isTeam ? null : (String(athlete.id || competitor?.id || '').trim() || null);
  const name = displayName(
    athlete.displayName
      || athlete.fullName
      || athlete.shortName
      || team.displayName
      || team.shortDisplayName
      || team.name
      || competitor?.displayName
      || competitor?.name
      || competitor?.shortName,
  );
  if (isPlaceholderGolfName(name)) return null;
  return {
    id,
    name,
    type: isTeam ? 'team' : 'athlete',
    logo: isTeam ? (team.logo || team.logos?.[0]?.href || null) : null,
    rank: numberOrNull(
      competitor?.rank
        || competitor?.curatedRank?.current
        || athlete.rank
        || athlete.curatedRank?.current
        || competitor?.status?.position?.id,
    ),
    order: numberOrNull(competitor?.order) ?? order,
  };
}

function mergeEntrant(previous, next) {
  if (!previous) return next;
  return sortEntrants(next, previous) < 0 ? { ...previous, ...next } : previous;
}

function fieldPriority(player) {
  if (player?.id && GOLF_PRIORITY_BY_ID.has(String(player.id))) {
    return GOLF_PRIORITY_BY_ID.get(String(player.id));
  }
  const byName = GOLF_PRIORITY_BY_NAME.get(normalizeName(player?.name));
  return byName == null ? 9999 : byName;
}

function sortEntrants(a, b) {
  return fieldPriority(a) - fieldPriority(b)
    || (a.rank ?? 9999) - (b.rank ?? 9999)
    || (a.order ?? 9999) - (b.order ?? 9999)
    || String(a.name || '').localeCompare(String(b.name || ''));
}

function heuristicTournamentProbabilities(field, fullFieldSize) {
  const listedCount = field.length;
  if (listedCount <= 0) return [];
  const totalField = Math.max(Number(fullFieldSize) || listedCount, listedCount);
  const remainingCount = Math.max(0, totalField - listedCount);
  const otherProbability = remainingCount > 0
    ? Math.min(0.55, Math.max(0.24, (remainingCount / totalField) * 0.65))
    : 0.05;
  const listedMass = 1 - otherProbability;
  const weights = field.map((player, index) => {
    const priority = fieldPriority(player);
    const rank = player.rank ?? (priority < 9999 ? priority + 1 : index + 1);
    return 1 / Math.pow(Math.max(1, Number(rank) || index + 1), 0.72);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || listedCount;
  return [
    ...weights.map(weight => (weight / totalWeight) * listedMass),
    otherProbability,
  ];
}

export function extractGolfEventField(event) {
  const entrants = new Map();
  let order = 0;
  for (const competition of Array.isArray(event?.competitions) ? event.competitions : []) {
    for (const competitor of Array.isArray(competition?.competitors) ? competition.competitors : []) {
      const entrant = golfCompetitorToEntrant(competitor, order++);
      if (!entrant) continue;
      const key = entrant.id ? `id:${entrant.id}` : `name:${normalizeName(entrant.name)}`;
      entrants.set(key, mergeEntrant(entrants.get(key), entrant));
    }
  }
  return Array.from(entrants.values()).sort(sortEntrants);
}

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

  const fullField = extractGolfEventField(ev);
  if (fullField.length < MIN_CONFIRMED_GOLF_FIELD) {
    console.warn('[market-gen/golf] skipped tournament without confirmed field', {
      eventId: ev.id,
      name: ev.name,
      fieldSize: fullField.length,
    });
    return [];
  }
  const eventField = fullField.slice(0, MAX_FIELD_OUTCOMES).map(player => ({
    id: player.id,
    name: player.name,
    type: player.type,
    rank: player.rank,
    order: player.order,
    logo: player.logo || null,
  }));
  const suggestedProbabilities = heuristicTournamentProbabilities(eventField, fullField.length);

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
      ...eventField.map(p => p.logo || headshot(p.id)),
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
      confirmedFieldSize: fullField.length,
      listedFieldSize: eventField.length,
      fieldCap: MAX_FIELD_OUTCOMES,
      fieldSource: 'espn-scoreboard-competitors',
      fieldUpdatedAt: new Date().toISOString(),
      rankingFallbackDisabled: true,
      suggestedPricing: {
        source: 'source-signals:golf-priority-field',
        probabilities: suggestedProbabilities,
        rationale: 'Probabilidad inicial heurística por prioridad/ranking y masa de Otro para golfistas no listados.',
      },
      // Persist the per-event field so backfill-resolvers can rebuild
      // outcome_images and resolver legs from this row alone.
      field: eventField,
    },
  }];
}
