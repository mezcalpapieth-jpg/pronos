/**
 * ESPN-backed soccer generator for Liga MX, MLS, Leagues Cup,
 * UEFA Europa League, UEFA Conference League, international friendlies,
 * and summer-break club friendlies.
 *
 * Why not football-data.org: Liga MX and MLS are both paywalled on
 * their free tier, and the user specifically wants Liga MX/MLS coverage.
 * ESPN's soccer scoreboard is a
 * keyless public JSON API with the same shape we use for MLB/NBA.
 *
 * Scope:
 *   - `mex.1` (Liga MX): every scheduled game inside the 14-day window
 *   - `usa.1` (MLS): every scheduled game inside the 14-day window
 *   - `concacaf.leagues.cup` (Leagues Cup): all scheduled games
 *   - `uefa.europa` (UEL): all scheduled games
 *   - `uefa.europa.conf` (UECL): all scheduled games, with a longer
 *      lookahead because this competition can start later than the
 *      standard two-week soccer window
 *   - `fifa.friendly` (international friendlies): all scheduled games
 *   - `club.friendly` (club friendlies): summer-break games only
 *
 * Outcome shape: regular league/friendly fixtures are 3-way W/D/L.
 * Leagues Cup is binary because knockout-style tournament games must
 * produce a winner.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const HORIZON_DAYS = 14;
const SUMMER_BREAK_MONTHS_UTC = new Set([5, 6, 7]); // June, July, August
const PLACEHOLDER_TEAM_RE = /^(?:tbd|to be determined)(?:\s|$)/i;

// Legacy whitelists kept for tests/manual reference. Generation no longer
// filters by team: every event in the fetched ESPN feeds enters pending.
const MLS_WHITELIST = new Set([
  'Inter Miami CF',
]);

const CLUB_FRIENDLY_WHITELIST = new Set([
  'AC Milan',
  'América',
  'Arsenal',
  'Arsenal FC',
  'Aston Villa',
  'Aston Villa FC',
  'Atlético Madrid',
  'Atletico Madrid',
  'Barcelona',
  'Bayer 04 Leverkusen',
  'Bayer Leverkusen',
  'Bayern Munich',
  'Borussia Dortmund',
  'Chelsea',
  'Chelsea FC',
  'Chivas',
  'Club América',
  'Cruz Azul',
  'Crystal Palace',
  'Crystal Palace FC',
  'FC Barcelona',
  'FC Bayern München',
  'Freiburg',
  'Guadalajara',
  'Inter Miami CF',
  'Juventus',
  'Juventus FC',
  'Manchester City',
  'Manchester City FC',
  'Manchester United',
  'Manchester United FC',
  'Monterrey',
  'Pachuca',
  'Paris Saint Germain',
  'Paris Saint-Germain',
  'PSG',
  'Pumas',
  'Pumas UNAM',
  'Rayo Vallecano',
  'Rayo Vallecano de Madrid',
  'Rayados',
  'Real Madrid',
  'Real Madrid CF',
  'SC Freiburg',
  'Tigres UANL',
  'Toluca',
]);

const ESPN_SOCCER_LEAGUES = [
  {
    leagueCode: 'mex.1',
    league: 'liga-mx',
    leagueLabel: 'Liga MX',
    outcomeShape: 'draw3',
  },
  {
    leagueCode: 'usa.1',
    league: 'mls',
    leagueLabel: 'MLS',
    outcomeShape: 'draw3',
  },
  {
    leagueCode: 'concacaf.leagues.cup',
    league: 'leagues-cup',
    leagueLabel: 'Leagues Cup',
    outcomeShape: 'binary',
    matchTypeLabel: 'TORNEO',
    durationHours: 4,
  },
  {
    leagueCode: 'uefa.europa',
    league: 'uefa-europa-league',
    leagueLabel: 'UEFA Europa League (UEL)',
    outcomeShape: 'draw3',
    matchTypeLabel: 'TORNEO',
  },
  {
    leagueCode: 'uefa.europa.conf',
    league: 'uefa-conference-league',
    leagueLabel: 'UEFA Conference League (UECL)',
    outcomeShape: 'draw3',
    matchTypeLabel: 'TORNEO',
    horizonDays: 45,
  },
  {
    leagueCode: 'fifa.friendly',
    league: 'international',
    leagueLabel: 'International Friendly',
    outcomeShape: 'draw3',
    matchTypeLabel: 'INTERNACIONAL',
  },
  {
    leagueCode: 'club.friendly',
    league: 'club-friendlies',
    leagueLabel: 'Club Friendly',
    outcomeShape: 'draw3',
    matchTypeLabel: 'AMISTOSO',
    summerBreakOnly: true,
  },
];

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function dateRangeForConfig(config, now = new Date()) {
  const days = Number(config?.horizonDays);
  const horizonDays = Number.isFinite(days) && days > 0 ? days : HORIZON_DAYS;
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  return `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;
}

async function fetchLeagueEvents(leagueCode, dateRange) {
  const url = `${BASE}/${leagueCode}/scoreboard?dates=${dateRange}&limit=500`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  } catch (e) {
    console.error('[market-gen/espn-soccer] scoreboard fetch failed', {
      league: leagueCode, message: e?.message,
    });
    return [];
  }
}

function eventTeamNames(ev) {
  const comp = Array.isArray(ev?.competitions) ? ev.competitions[0] : null;
  const comps = Array.isArray(comp?.competitors) ? comp.competitors : [];
  return comps.map(c => c?.team?.displayName).filter(Boolean);
}

function eventMatchesWhitelist(ev, whitelist) {
  if (!whitelist) return true;
  return eventTeamNames(ev).some(n => whitelist.has(n));
}

function isSummerBreakDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(d.getTime())) return false;
  return SUMMER_BREAK_MONTHS_UTC.has(d.getUTCMonth());
}

function shouldFetchLeagueEvents(config, now = new Date()) {
  if (!config?.summerBreakOnly) return true;
  return isSummerBreakDate(now);
}

function isPlaceholderTeamName(name) {
  return PLACEHOLDER_TEAM_RE.test(String(name || '').trim());
}

/**
 * Convert an ESPN soccer event into the shared market-spec shape used
 * by points_pending_markets. Returns null for events we should skip.
 */
function eventToSpec(ev, {
  leagueCode,
  league,
  leagueLabel,
  outcomeShape = 'draw3',
  matchTypeLabel = null,
  durationHours = null,
}) {
  if (ev?.status?.type?.state !== 'pre') return null; // only scheduled
  const kickoff = ev?.date;
  if (!kickoff) return null;
  const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
  if (!comp) return null;
  const comps = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = comps.find(c => c.homeAway === 'home');
  const away = comps.find(c => c.homeAway === 'away');
  const homeName = home?.team?.displayName;
  const awayName = away?.team?.displayName;
  if (!homeName || !awayName) return null;
  if (isPlaceholderTeamName(homeName) || isPlaceholderTeamName(awayName)) return null;

  // Auto-resolver waits for ESPN's `completed=true` anyway, so end_time
  // is just the hard close if the scoreboard stalls. Binary tournament
  // games get a longer window for penalties.
  const kickoffMs = new Date(kickoff).getTime();
  const winnerOnly = outcomeShape === 'binary';
  const closeHours = durationHours || (winnerOnly ? 4 : 2);
  const startTime = new Date(kickoffMs).toISOString();
  const endTime   = new Date(kickoffMs + closeHours * 3600_000).toISOString();
  const dateYmd   = new Date(kickoff).toISOString().slice(0, 10);
  // ESPN competitors carry either team.logo (single) or team.logos[]
  // — prefer the single field since it's what scoreboard responses
  // reliably populate. Draw has no image.
  const homeLogo = home?.team?.logo || home?.team?.logos?.[0]?.href || null;
  const awayLogo = away?.team?.logo || away?.team?.logos?.[0]?.href || null;

  return {
    source: 'espn-soccer',
    // leagueCode namespaces the event id — stable across ESPN updates.
    source_event_id: `${leagueCode}:${ev.id}`,
    sport: 'soccer',
    league,
    // Match the football-data generator's bare "Home vs Away" format.
    question: `${homeName} vs ${awayName}`,
    category: 'deportes',
    icon: null,
    outcomes: winnerOnly ? [homeName, awayName] : [homeName, 'Empate', awayName],
    outcome_images: winnerOnly ? [homeLogo, awayLogo] : [homeLogo, null, awayLogo],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',          // 3-way W/D/L → unified CPMM
    resolver_type: 'sports_api',  // auto via ESPN soccer scoreboard
    resolver_config: {
      source: 'espn',
      leaguePath: `soccer/${leagueCode}`,
      eventId: ev.id,
      dateYmd,
      shape: winnerOnly ? 'binary' : 'draw3',
    },
    source_data: {
      eventId: ev.id,
      leagueCode,
      leagueLabel,
      matchTypeLabel,
      kickoffUtc: kickoff,
      home: { id: home?.team?.id, name: homeName, abbr: home?.team?.abbreviation },
      away: { id: away?.team?.id, name: awayName, abbr: away?.team?.abbreviation },
      venue: comp?.venue?.fullName || null,
    },
  };
}

export async function generateEspnSoccerMarkets({
  now = new Date(),
  fetchLeagueEventsFn = fetchLeagueEvents,
} = {}) {
  const specs = [];

  for (const config of ESPN_SOCCER_LEAGUES) {
    if (!shouldFetchLeagueEvents(config, now)) continue;
    const dateRange = dateRangeForConfig(config, now);
    for (const ev of await fetchLeagueEventsFn(config.leagueCode, dateRange)) {
      if (!eventMatchesWhitelist(ev, config.whitelist)) continue;
      const spec = eventToSpec(ev, config);
      if (spec) specs.push(spec);
    }
  }

  return specs;
}

// Exported for tests / manual inspection
export const _internal = {
  CLUB_FRIENDLY_WHITELIST,
  ESPN_SOCCER_LEAGUES,
  MLS_WHITELIST,
  eventMatchesWhitelist,
  eventTeamNames,
  eventToSpec,
  dateRangeForConfig,
  formatDateCompact,
  isPlaceholderTeamName,
  isSummerBreakDate,
  shouldFetchLeagueEvents,
};
