/**
 * MLB market generator (binary, Home vs Away).
 *
 * ESPN scoreboard API is public, no key required. We pull scheduled
 * games for a rolling 3-day window, filter to games featuring at
 * least one marquee franchise, and build one binary market per
 * kept game — "¿Quién gana {Away} @ {Home}?" — with outcomes
 * [home, away]. (Baseball can't draw so no 3-way shape.)
 *
 * Whitelist keeps the approval queue small — a full MLB slate is
 * ~15 games/day × 3 days = 45+ markets which drowns the admin UI.
 * Filtering to top teams cuts that to ~15–20 per batch while still
 * covering the games users are most likely to actually bet on.
 *
 * Resolver stays manual for now. Admin resolves by looking at the
 * final score; a future `espn_scoreboard` resolver can auto-settle
 * by re-reading the scoreboard after the game and picking the winner.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const HORIZON_DAYS = 3;

// Marquee franchises — edit this list to change what shows in the
// queue. A game is kept if EITHER team's abbreviation is in here, so
// NYY @ TB passes but TB @ KC doesn't. Abbreviations match ESPN's
// `team.abbreviation` field exactly.
const TEAM_WHITELIST = new Set([
  'NYY',  // New York Yankees
  'LAD',  // Los Angeles Dodgers
  'BOS',  // Boston Red Sox
  'CHC',  // Chicago Cubs
  'NYM',  // New York Mets
  'SF',   // San Francisco Giants
  'PHI',  // Philadelphia Phillies
  'ATL',  // Atlanta Braves
  'HOU',  // Houston Astros
  'SD',   // San Diego Padres
]);

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export async function generateMlbMarkets() {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const range = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
  const url = `${BASE}?dates=${range}&limit=500`;

  let data;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (e) {
    console.error('[market-gen/mlb] scoreboard fetch failed', { message: e?.message });
    return [];
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const specs = [];
  for (const ev of events) {
    const status = ev?.status?.type?.state; // "pre" | "in" | "post"
    if (status !== 'pre') continue;          // only scheduled games
    const kickoff = ev?.date;
    if (!kickoff) continue;
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    if (!comp) continue;
    const comps = Array.isArray(comp.competitors) ? comp.competitors : [];
    const home = comps.find(c => c.homeAway === 'home');
    const away = comps.find(c => c.homeAway === 'away');
    if (!home?.team?.displayName || !away?.team?.displayName) continue;

    // Drop games that don't feature at least one marquee franchise.
    const homeAbbr = home?.team?.abbreviation;
    const awayAbbr = away?.team?.abbreviation;
    if (!TEAM_WHITELIST.has(homeAbbr) && !TEAM_WHITELIST.has(awayAbbr)) continue;

    // Trading stays open through the game. end_time = kickoff + 5h
    // covers a worst-case 3h standard game + potential extra innings
    // + buffer; the auto-resolver benign-skips while ESPN shows the
    // game as still in progress, so this is just a hard close.
    const kickoffMs = new Date(kickoff).getTime();
    const startTime = new Date(kickoffMs).toISOString();
    const endTime   = new Date(kickoffMs + 5 * 3600_000).toISOString();
    const dateYmd   = new Date(kickoff).toISOString().slice(0, 10);
    specs.push({
      source: 'espn-mlb',
      source_event_id: String(ev.id),
      sport: 'mlb',
      league: 'mlb',
      question: `¿Quién gana ${away.team.displayName} @ ${home.team.displayName}?`,
      category: 'deportes',
      icon: '⚾',
      outcomes: [home.team.displayName, away.team.displayName],
      seed_liquidity: 1000,
      start_time: startTime,
      end_time: endTime,
      amm_mode: 'unified',           // 2-way home/away → unified binary
      resolver_type: 'sports_api',   // auto-resolves via ESPN scoreboard
      resolver_config: {
        source: 'espn',
        leaguePath: 'baseball/mlb',
        eventId: ev.id,
        dateYmd,
        shape: 'binary',
      },
      source_data: {
        eventId: ev.id,
        kickoffUtc: kickoff,
        league: 'MLB',
        home: { id: home?.team?.id, name: home.team.displayName, abbr: home.team.abbreviation },
        away: { id: away?.team?.id, name: away.team.displayName, abbr: away.team.abbreviation },
        venue: comp?.venue?.fullName || null,
      },
    });
  }
  return specs;
}

// Exported for tests / manual inspection.
export const _internal = { TEAM_WHITELIST };
