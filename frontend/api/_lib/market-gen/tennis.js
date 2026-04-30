/**
 * ATP tennis generator — TOURNAMENT-WINNER markets.
 *
 * Earlier versions of this generator emitted one binary head-to-head
 * market per match, but matches resolve in 2-3 hours after first
 * serve and the market never had time to attract liquidity. We now
 * emit ONE parallel market per upcoming top-tier tournament:
 *   "¿Quién gana el <Tournament>?"
 * with a curated top field plus "Otro" for dark-horse winners.
 *
 * Mirrors the golf.js (PGA) generator shape — the cron's parallel-
 * shape leg matcher handles tennis tournament resolution unchanged
 * (id-match → label-match → 'Otro' fallback).
 *
 * Tier filter: Slams + Masters 1000 + ATP 500 only. ATP 250 and
 * regional / "challenger" events are filtered out — they don't draw
 * the whitelisted top names so a market for them would resolve to
 * "Otro" 90% of the time, which reads as broken.
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

// Top-12 ATP field for tournament-winner markets. Each ESPN
// athlete ID was verified by walking the 2026 ATP scoreboard and
// matching displayNames to competitor.id (HEAD-200 against the
// headshot CDN proves the URL exists but NOT that it points at the
// right player — earlier versions of this file had wrong IDs that
// would never have matched a winner). Holger Rune doesn't appear
// in 2026 ATP events on ESPN (injured/out); swapped for Alex de
// Minaur, a consistent top-10 player.
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

function headshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png` : null;
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
    if (ev?.status?.type?.state !== 'pre') continue;
    if (!isTopTier(ev)) continue;          // Drop ATP 250 / regional events
    const startIso = ev.date;
    const endIso = ev.endDate || ev.date;  // ESPN ships endDate on tournaments
    if (!startIso) continue;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    // Pad 2 days past tournament endDate so a Sunday-evening final
    // landing on a UTC-boundary edge doesn't strand the market.
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs + 2 * 86_400_000).toISOString();

    const legs = [
      ...FIELD.map(p => ({ label: p.name, driverId: p.id })),
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
        ...FIELD.map(p => headshot(p.id)),
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
        field: FIELD,
      },
    });
  }
  return specs;
}
