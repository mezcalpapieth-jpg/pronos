/**
 * ATP tennis generator — ESPN scoreboard.
 *
 * Pulls upcoming ATP matches, filters to a configurable player
 * whitelist, and emits one binary market per match. Resolution is
 * via ESPN's `completed` flag, same shape as MLB/NBA sports_api.
 *
 * Whitelist covers the top-seeded players the user called out. Add
 * or remove names to adjust what surfaces.
 */

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

// Player name matching is case-insensitive, strips accents, and
// matches on either FULL name or LAST name (ESPN sometimes abbreviates).
// Normalized forms computed at module load — avoids per-event work.
const PLAYER_WHITELIST_RAW = [
  'Jannik Sinner',
  'Novak Djokovic',
  'Carlos Alcaraz',
  'Alexander Zverev',
  'Ben Shelton',
  'Lorenzo Musetti',
  'Flavio Cobolli',
  'Daniil Medvedev',
];

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim();
}

const WHITELIST_FULL = new Set(PLAYER_WHITELIST_RAW.map(normalize));
const WHITELIST_LAST = new Set(
  PLAYER_WHITELIST_RAW.map(n => normalize(n.split(' ').pop())),
);

function matchesWhitelist(name) {
  const n = normalize(name);
  if (WHITELIST_FULL.has(n)) return true;
  const last = normalize(n.split(' ').pop());
  return WHITELIST_LAST.has(last);
}

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export async function generateTennisMarkets({ horizonDays = 14 } = {}) {
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
    const kickoff = ev?.date;
    if (!kickoff) continue;
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    if (!comp) continue;
    const ctors = Array.isArray(comp.competitors) ? comp.competitors : [];
    if (ctors.length !== 2) continue;
    const [c1, c2] = ctors;
    const p1Name = c1?.athlete?.displayName || c1?.displayName;
    const p2Name = c2?.athlete?.displayName || c2?.displayName;
    if (!p1Name || !p2Name) continue;

    // Admit the match if AT LEAST ONE player is on the whitelist —
    // usually a top seed vs a qualifier the user doesn't care about.
    if (!matchesWhitelist(p1Name) && !matchesWhitelist(p2Name)) continue;

    const kickoffMs = new Date(kickoff).getTime();
    if (!Number.isFinite(kickoffMs)) continue;
    const startTime = new Date(kickoffMs).toISOString();
    const endTime = new Date(kickoffMs + 4 * 3600_000).toISOString();
    const dateYmd = new Date(kickoff).toISOString().slice(0, 10);

    const p1Photo = c1?.athlete?.headshot?.href || c1?.headshot?.href || null;
    const p2Photo = c2?.athlete?.headshot?.href || c2?.headshot?.href || null;

    const tournamentName = comp?.venue?.fullName
                        || ev?.season?.displayName
                        || 'ATP Tour';

    specs.push({
      source: 'espn-atp',
      source_event_id: `atp:${ev.id}`,
      sport: 'tennis',
      league: 'atp',
      question: `${p1Name} vs ${p2Name}`,
      category: 'deportes',
      icon: '🎾',
      outcomes: [p1Name, p2Name],
      outcome_images: [p1Photo, p2Photo],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'espn',
        leaguePath: 'tennis/atp',
        eventId: ev.id,
        dateYmd,
        shape: 'binary',
      },
      source_data: {
        eventId: ev.id,
        tournament: tournamentName,
        kickoffUtc: kickoff,
        p1: { id: c1?.athlete?.id, name: p1Name, photo: p1Photo },
        p2: { id: c2?.athlete?.id, name: p2Name, photo: p2Photo },
      },
    });
  }
  return specs;
}

export const _internal = { PLAYER_WHITELIST_RAW, matchesWhitelist, normalize };
