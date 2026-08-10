/**
 * ATP tennis generator — top-tier tournament-winner + selected H2H markets.
 *
 * We emit ONE parallel market per upcoming top-tier tournament:
 *   "¿Quién gana el <Tournament>?"
 * with confirmed draw entrants plus "Otro" for dark-horse winners.
 * We also emit a bounded number of binary head-to-head markets for
 * matches in those same top-tier tournaments, but only when there is
 * enough lead time before first serve.
 *
 * Mirrors the golf.js (PGA) generator shape — the cron's parallel-
 * shape leg matcher handles tennis tournament resolution unchanged
 * (id-match → label-match → 'Otro' fallback).
 *
 * Tier filter: Slams + Masters 1000 + ATP 500 only. ATP 250 and
 * regional / "challenger" events are filtered out. We also skip any
 * tournament whose ESPN draw has not populated yet; using rankings
 * alone puts injured/skipping players in markets and reads broken.
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

const MAX_FIELD_OUTCOMES = 32;
const MIN_CONFIRMED_DRAW_PLAYERS = 8;
const MAX_HEAD_TO_HEAD_MARKETS = 8;
const HEAD_TO_HEAD_WINDOW_DAYS = 7;
const MIN_HEAD_TO_HEAD_LEAD_HOURS = 3;

// Ranking/favorite priority only. These names are no longer used as
// market entrants by themselves; they only sort players that ESPN
// confirms are actually in the tournament draw.
const FIELD = [
  { id: '3782', name: 'Carlos Alcaraz' },
  { id: '3623', name: 'Jannik Sinner' },
  { id: '296',  name: 'Novak Djokovic' },
  { id: '2375', name: 'Alexander Zverev' },
  { id: '2383', name: 'Daniil Medvedev' },
  { id: '2869', name: 'Stefanos Tsitsipas' },
  { id: '2642', name: 'Andrey Rublev' },
  { id: '2989', name: 'Casper Ruud' },
  { id: '2946', name: 'Taylor Fritz' },
  { id: '9250', name: 'Ben Shelton' },
  { id: '3764', name: 'Lorenzo Musetti' },
  { id: '2651', name: 'Alex de Minaur' },
];

const FIELD_PRIORITY_BY_ID = new Map(FIELD.map((p, index) => [String(p.id), index]));
const FIELD_PRIORITY_BY_NAME = new Map(FIELD.map((p, index) => [normalizeName(p.name), index]));

function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png` : null;
}

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

function ymdFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isPlaceholderPlayerName(name) {
  const normalized = normalizeName(name);
  return !normalized
    || normalized === 'bye'
    || normalized === 'tbd'
    || normalized === 'to be determined'
    || normalized === 'qualifier'
    || normalized === 'lucky loser'
    || normalized === 'alternate';
}

function tennisGroupingIsMensSingles(grouping) {
  const slug = normalizeName(grouping?.grouping?.slug || grouping?.slug);
  const name = normalizeName(grouping?.grouping?.name || grouping?.name || grouping?.displayName);
  return slug === 'mens singles'
    || name === 'mens singles'
    || name === 'men s singles'
    || name.includes('men singles')
    || name.includes('men s singles');
}

function tennisCompetitorToEntrant(competitor, order) {
  const athlete = competitor?.athlete || {};
  const id = String(athlete.id || competitor?.id || '').trim() || null;
  const name = displayName(
    athlete.displayName
      || athlete.fullName
      || athlete.shortName
      || competitor?.displayName
      || competitor?.name
      || competitor?.shortName,
  );
  if (isPlaceholderPlayerName(name)) return null;
  return {
    id,
    name,
    seed: numberOrNull(competitor?.seed || competitor?.curatedRank?.current),
    rank: numberOrNull(
      competitor?.rank
        || athlete.rank
        || athlete.curatedRank?.current
        || competitor?.curatedRank?.current,
    ),
    order,
  };
}

function mergeEntrant(previous, next) {
  if (!previous) return next;
  return sortEntrants(next, previous) < 0 ? { ...previous, ...next } : previous;
}

function fieldPriority(player) {
  if (player?.id && FIELD_PRIORITY_BY_ID.has(String(player.id))) {
    return FIELD_PRIORITY_BY_ID.get(String(player.id));
  }
  const byName = FIELD_PRIORITY_BY_NAME.get(normalizeName(player?.name));
  return byName == null ? 9999 : byName;
}

function sortEntrants(a, b) {
  return (a.seed ?? 9999) - (b.seed ?? 9999)
    || (a.rank ?? 9999) - (b.rank ?? 9999)
    || fieldPriority(a) - fieldPriority(b)
    || (a.order ?? 9999) - (b.order ?? 9999)
    || String(a.name || '').localeCompare(String(b.name || ''));
}

function heuristicTournamentProbabilities(field, fullFieldSize) {
  const listedCount = field.length;
  if (listedCount <= 0) return [];
  const totalField = Math.max(Number(fullFieldSize) || listedCount, listedCount);
  const remainingCount = Math.max(0, totalField - listedCount);
  const otherProbability = remainingCount > 0
    ? Math.min(0.5, Math.max(0.16, (remainingCount / totalField) * 0.55))
    : 0.04;
  const listedMass = 1 - otherProbability;
  const weights = field.map((player, index) => {
    const strength = player.seed ?? player.rank ?? fieldPriority(player) ?? index + 1;
    return 1 / Math.pow(Math.max(1, Number(strength) || index + 1), 0.82);
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || listedCount;
  return [
    ...weights.map(weight => (weight / totalWeight) * listedMass),
    otherProbability,
  ];
}

function eventCompetitions(event) {
  const groupings = Array.isArray(event?.groupings) ? event.groupings : [];
  const mens = groupings.find(tennisGroupingIsMensSingles);
  return Array.isArray(mens?.competitions) ? mens.competitions : [];
}

function statusState(item) {
  return String(item?.status?.type?.state || '').trim().toLowerCase();
}

function eventCanEmitHeadToHeads(event) {
  return statusState(event) !== 'post';
}

function competitionCanEmitHeadToHead(competition) {
  const state = statusState(competition);
  return !state || state === 'pre';
}

function headToHeadCompetitors(competition) {
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  if (competitors.length !== 2) return null;
  const players = competitors.map((competitor, index) => tennisCompetitorToEntrant(competitor, index));
  if (players.some(player => !player)) return null;
  if (normalizeName(players[0].name) === normalizeName(players[1].name)) return null;
  return players;
}

function buildHeadToHeadMarket(event, competition, players) {
  if (!competitionCanEmitHeadToHead(competition)) return null;
  const startIso = competition?.date || event?.date;
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  const nowMs = Date.now();
  if (startMs < nowMs + MIN_HEAD_TO_HEAD_LEAD_HOURS * 3600_000) return null;
  if (startMs > nowMs + HEAD_TO_HEAD_WINDOW_DAYS * 86_400_000) return null;

  const matchId = String(competition?.id || '').trim();
  if (!matchId) return null;
  const eventId = String(event?.id || '').trim();
  if (!eventId) return null;
  const roundLabel = competition?.round?.displayName || competition?.round?.name || null;
  const p0 = players[0];
  const p1 = players[1];
  const startTime = new Date(startMs).toISOString();

  return {
    source: 'espn-atp-match',
    source_event_id: `atp-match:${matchId}`,
    sport: 'tennis',
    league: 'atp',
    question: `¿Quién gana: ${p0.name} vs ${p1.name} en el ${event.name}?`,
    category: 'deportes',
    icon: '🎾',
    outcomes: [p0.name, p1.name],
    outcome_images: [headshot(p0.id), headshot(p1.id)],
    seed_liquidity: 1000,
    start_time: new Date().toISOString(),
    end_time: startTime,
    amm_mode: 'unified',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn-atp-match',
      shape: 'binary',
      eventId,
      matchId,
      dateYmd: ymdFromIso(startTime),
      homeName: p0.name,
      awayName: p1.name,
    },
    source_data: {
      eventId,
      matchId,
      tournamentName: event.name,
      roundLabel,
      startDateIso: startTime,
      tier: event?.major === true ? 'grand-slam' : 'atp-500-plus',
      fieldSource: 'espn-mens-singles-draw',
      players: players.map(p => ({ id: p.id, name: p.name, seed: p.seed, rank: p.rank })),
    },
  };
}

export function extractAtpMensSinglesField(event) {
  const groupings = Array.isArray(event?.groupings) ? event.groupings : [];
  const mens = groupings.find(tennisGroupingIsMensSingles);
  if (!mens) return [];

  const entrants = new Map();
  let order = 0;
  for (const competition of Array.isArray(mens.competitions) ? mens.competitions : []) {
    for (const competitor of Array.isArray(competition?.competitors) ? competition.competitors : []) {
      const entrant = tennisCompetitorToEntrant(competitor, order++);
      if (!entrant) continue;
      const key = entrant.id ? `id:${entrant.id}` : `name:${normalizeName(entrant.name)}`;
      entrants.set(key, mergeEntrant(entrants.get(key), entrant));
    }
  }

  return Array.from(entrants.values()).sort(sortEntrants);
}

// Top-tier tournament name matchers. ESPN's `event.major === true`
// flag identifies the four Slams; everything else needs a name
// pattern. Patterns are case-insensitive substring matches against
// `event.name`. Curated to cover Masters 1000 and ATP 500 events
// using the sponsor names ESPN actually returns (verified against
// the full 2026 ATP calendar).
const TOP_TIER_NAME_PATTERNS = [
  // Masters 1000
  /BNP Paribas Open/i,             // Indian Wells
  /Miami Open/i,
  /Monte[- ]?Carlo Masters/i,
  /Mutua Madrid Open/i,
  /Internazionali BNL/i,           // Italian Open / Rome
  /Canadian Open|Rogers Cup|National Bank Open/i,
  /Western & Southern Open|Cincinnati Open/i,
  /Shanghai Masters|Rolex Shanghai/i,
  /Paris Masters|Rolex Paris/i,
  // ATP 500
  /ABN Amro/i,                     // Rotterdam
  /Abierto Mexicano/i,             // Acapulco
  /Dubai Duty Free/i,
  /Qatar ExxonMobil Open|Qatar Open/i, // Doha
  /Rio Open/i,
  /Barcelona Open Banc Sabadell/i,
  /Boss Open/i,                    // Stuttgart
  /Cinch Championships|Queen's Club/i,
  /Bitpanda Hamburg Open|Hamburg European Open/i,
  /Mubadala Citi DC Open|Citi Open/i, // Washington
  /China Open|Beijing/i,
  /Kinoshita Group Japan Open|Rakuten/i, // Tokyo
  /Erste Bank Open/i,              // Vienna
  /Swiss Indoors|Basel/i,
  // Year-end
  /ATP Finals|Nitto ATP Finals/i,
];

function isTopTier(ev) {
  if (ev?.major === true) return true; // The 4 Slams
  const name = String(ev?.name || '');
  return TOP_TIER_NAME_PATTERNS.some(re => re.test(name));
}

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export async function generateTennisMarkets({ horizonDays = 60 } = {}) {
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const dates = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;

  let events = [];
  try {
    const res = await fetch(`${ESPN}?dates=${dates}&limit=500`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    events = Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    console.error('[market-gen/tennis] fetch failed', { message: e?.message });
    return [];
  }

  const specs = [];
  for (const ev of events) {
    const state = statusState(ev);
    if (state === 'post') continue;
    if (!isTopTier(ev)) continue;          // Drop ATP 250 / regional events
    const startIso = ev.date;
    const endIso = ev.endDate || ev.date;  // ESPN ships endDate on tournaments

    const fullDrawField = extractAtpMensSinglesField(ev);

    if (state === 'pre') {
      if (!startIso) continue;
      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

      // Pad 2 days past tournament endDate so a Sunday-evening final
      // landing on a UTC-boundary edge doesn't strand the market.
      const startTime = new Date(startMs).toISOString();
      const endTime = new Date(endMs + 2 * 86_400_000).toISOString();

      if (fullDrawField.length < MIN_CONFIRMED_DRAW_PLAYERS) {
        console.warn('[market-gen/tennis] skipped tournament without confirmed draw field', {
          eventId: ev.id,
          name: ev.name,
          fieldSize: fullDrawField.length,
        });
      } else {
        const eventField = fullDrawField.slice(0, MAX_FIELD_OUTCOMES).map(player => ({
          id: player.id,
          name: player.name,
          seed: player.seed,
          rank: player.rank,
        }));
        const suggestedProbabilities = heuristicTournamentProbabilities(eventField, fullDrawField.length);

        const legs = [
          ...eventField.map(p => ({ label: p.name, driverId: p.id })),
          { label: 'Otro', driverId: null },
        ];

        specs.push({
          source: 'espn-atp-tournament',
          source_event_id: `atp:${ev.id}`,
          sport: 'tennis',
          league: 'atp',
          question: `¿Quién gana el ${ev.name}?`,
          category: 'deportes',
          icon: '🎾',
          outcomes: legs.map(l => l.label),
          outcome_images: [
            ...eventField.map(p => headshot(p.id)),
            null, // Otro
          ],
          seed_liquidity: 1000,
          start_time: startTime,
          end_time: endTime,
          amm_mode: 'parallel',
          // sports_api auto-resolution via espn-atp-tournament reader.
          // After the tournament ends the cron fetches the event's
          // Men's Singles Final (round.id='7') and reads the competitor
          // with winner=true. Player ID match → exact leg; name match
          // → fallback; "Otro" catches dark horses.
          resolver_type: 'sports_api',
          resolver_config: {
            source: 'espn-atp-tournament',
            shape: 'parallel',
            eventId: ev.id,
            legs,
          },
          source_data: {
            eventId: ev.id,
            tournamentName: ev.name,
            startDateIso: ev.date,
            endDateIso: ev.endDate || null,
            isMajor: ev.major === true,
            field: eventField,
            confirmedFieldSize: fullDrawField.length,
            fieldSource: 'espn-mens-singles-draw',
            fieldUpdatedAt: new Date().toISOString(),
            rankingFallbackDisabled: true,
            listedFieldSize: eventField.length,
            fieldCap: MAX_FIELD_OUTCOMES,
            suggestedPricing: {
              source: 'source-signals:tennis-seed-field',
              probabilities: suggestedProbabilities,
              rationale: 'Probabilidad inicial heurística por seed/ranking y masa de Otro para jugadores no listados.',
            },
          },
        });
      }
    }

    if (eventCanEmitHeadToHeads(ev)) {
      const h2hSpecs = eventCompetitions(ev)
        .map(competition => {
          const players = headToHeadCompetitors(competition);
          return players ? buildHeadToHeadMarket(ev, competition, players) : null;
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime())
        .slice(0, MAX_HEAD_TO_HEAD_MARKETS);
      specs.push(...h2hSpecs);
    }
  }
  return specs;
}
