/**
 * Soccer market generator — football-data.org client.
 *
 * Returns an array of market specs for upcoming matches involving the
 * user-defined team whitelist, plus every fixture for selected continental
 * cups: UEFA Champions League, UEFA Europa League, UEFA Conference League,
 * and Copa Libertadores.
 * Only fixtures within the next `horizonDays` (default 14) are returned,
 * and only those with status=SCHEDULED (so finished/live matches don't
 * show up as "pending to create").
 *
 * API: https://www.football-data.org/documentation/quickstart
 *   Free tier: 10 req/min, 12 competitions. Key goes in X-Auth-Token.
 *
 * Free-tier competition codes we use:
 *   CL  — UEFA Champions League
 *   EL  — UEFA Europa League
 *   UCL — UEFA Conference League
 *   CLI — Copa Libertadores
 *   PD  — La Liga (Real Madrid, Barcelona, Atlético)
 *   PL  — Premier League (Arsenal, Chelsea, Man City, Man United)
 *   SA  — Serie A (Juventus, AC Milan)
 *
 * NOT in free tier (deferred to another source):
 *   Liga MX (Mexico) · MLS (Inter Miami). TheSportsDB covers both for
 *   free; a TheSportsDB-backed generator can plug in alongside this one
 *   without touching the caller.
 */

// Team TLA (three-letter acronym, football-data.org's stable identifier)
// whitelist. Markets are generated for any fixture where either home or
// away team is in this set. TLA is preferable to name matching because
// names can vary ("Manchester United FC" vs "Man United").
const TEAM_TLA_WHITELIST = new Set([
  'RMA',   // Real Madrid
  'FCB',   // Barcelona
  'ATL',   // Atlético Madrid
  'ARS',   // Arsenal
  'AVL',   // Aston Villa
  'CHE',   // Chelsea
  'CRY',   // Crystal Palace
  'MCI',   // Manchester City
  'MUN',   // Manchester United
  'JUV',   // Juventus
  'MIL',   // AC Milan
  'BAY',   // Bayern Munich
  'BVB',   // Borussia Dortmund
  'B04',   // Bayer Leverkusen
  'SCF',   // Freiburg
  'RAY',   // Rayo Vallecano
]);

// Competition codes to pull. Continental cups are always included; domestic
// leagues are scanned and filtered to the team whitelist.
const COMPETITIONS_ALL_FIXTURES = ['CL', 'EL', 'UCL', 'CLI'];
const COMPETITIONS_TEAM_FILTER  = ['PD', 'PL', 'SA', 'BL1'];

// Map football-data competition code → canonical league slug used by
// the frontend sidebar. Keep in sync with the slugs used in
// PointsCategoryPage.jsx.
const COMPETITION_TO_LEAGUE = {
  CL:  'uefa-cl',
  EL:  'uefa-europa-league',
  UCL: 'uefa-conference-league',
  CLI: 'copa-libertadores',
  PD:  'la-liga',
  PL:  'premier-league',
  SA:  'serie-a',
  BL1: 'bundesliga',
};

const COMPETITION_TO_ESPN_PATH = {
  CL:  'soccer/uefa.champions',
  EL:  'soccer/uefa.europa',
  UCL: 'soccer/uefa.europa.conf',
  CLI: 'soccer/conmebol.libertadores',
  PD:  'soccer/esp.1',
  PL:  'soccer/eng.1',
  SA:  'soccer/ita.1',
  BL1: 'soccer/ger.1',
};

const ONE_LEGGED_FINAL_COMPETITIONS = new Set(['CL', 'EL', 'UCL', 'CLI']);
const TOURNAMENT_COMPETITIONS = new Set(['CL', 'EL', 'UCL', 'CLI']);

const API_BASE = 'https://api.football-data.org/v4';

const UEFA_FINAL_FALLBACKS = {
  EL: {
    id: 'uefa-2026-europa-final',
    utcDate: '2026-05-20T19:00:00.000Z',
    stage: 'FINAL',
    matchday: 'final',
    competition: { name: 'UEFA Europa League' },
    source: 'uefa.com',
    manualResolution: true,
    homeTeam: {
      id: 'freiburg',
      name: 'SC Freiburg',
      shortName: 'Freiburg',
      tla: 'SCF',
      crest: 'https://a.espncdn.com/i/teamlogos/soccer/500/126.png',
    },
    awayTeam: {
      id: 'aston-villa',
      name: 'Aston Villa FC',
      shortName: 'Aston Villa',
      tla: 'AVL',
      crest: 'https://a.espncdn.com/i/teamlogos/soccer/500/362.png',
    },
  },
  UCL: {
    id: 'uefa-2026-conference-final',
    utcDate: '2026-05-27T19:00:00.000Z',
    stage: 'FINAL',
    matchday: 'final',
    competition: { name: 'UEFA Conference League' },
    source: 'uefa.com',
    manualResolution: true,
    homeTeam: {
      id: 'crystal-palace',
      name: 'Crystal Palace FC',
      shortName: 'Crystal Palace',
      tla: 'CRY',
      crest: 'https://a.espncdn.com/i/teamlogos/soccer/500/384.png',
    },
    awayTeam: {
      id: 'rayo-vallecano',
      name: 'Rayo Vallecano de Madrid',
      shortName: 'Rayo Vallecano',
      tla: 'RAY',
      crest: 'https://a.espncdn.com/i/teamlogos/soccer/500/101.png',
    },
  },
};

function formatDate(d) {
  // football-data.org wants YYYY-MM-DD. Use UTC consistently so daylight
  // saving and the user's local tz don't shift the range boundary.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateInRange(dateValue, dateFrom, dateTo) {
  const date = formatDate(new Date(dateValue));
  return date >= dateFrom && date <= dateTo;
}

function fallbackFinalMatchesForCompetition(competitionCode, dateFrom, dateTo) {
  const fallback = UEFA_FINAL_FALLBACKS[competitionCode];
  if (!fallback || !dateInRange(fallback.utcDate, dateFrom, dateTo)) return [];
  return [{ ...fallback }];
}

function isChampionsLeagueFinal(match, competitionCode) {
  if (competitionCode !== 'CL') return false;
  return isOneLeggedCupFinal(match, competitionCode);
}

function isOneLeggedCupFinal(match, competitionCode) {
  if (!ONE_LEGGED_FINAL_COMPETITIONS.has(competitionCode)) return false;
  const stage = String(match?.stage || match?.group || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return stage === 'FINAL';
}

// Parse the rate-limit headers that football-data.org returns on every
// response. Their free tier is 10 req/min; if `remaining` falls low we
// wait for the reset window before issuing the next request.
function parseRateLimit(res) {
  const reset = Number(res.headers.get('X-RequestCounter-Reset'));
  const remaining = Number(res.headers.get('X-Requests-Available-Minute'));
  return {
    resetSec: Number.isFinite(reset) ? reset : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
  };
}

/**
 * Fetch JSON from football-data.org with auth + rate-limit awareness.
 *   - Pre-throttles if the previous response reported low remaining budget
 *     (we keep a module-scoped cache of the last-seen reset).
 *   - On 429, reads Retry-After (or X-RequestCounter-Reset) and retries once.
 */
let lastSeenRate = { resetSec: null, remaining: null, when: 0 };

async function fetchJson(url, apiKey) {
  // If the previous call reported ≤1 request left, wait until the counter
  // resets before firing another one. Caps at 65s as a safety net.
  if (lastSeenRate.remaining !== null
      && lastSeenRate.remaining <= 1
      && lastSeenRate.resetSec !== null) {
    const elapsedMs = Date.now() - lastSeenRate.when;
    const waitMs = Math.max(0, lastSeenRate.resetSec * 1000 - elapsedMs) + 250;
    if (waitMs > 0) await sleep(Math.min(65_000, waitMs));
  }

  let res = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey, 'Accept': 'application/json' },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After'))
                    || parseRateLimit(res).resetSec
                    || 30;
    console.warn('[market-gen/soccer] 429 rate-limited; sleeping', { retryAfter });
    await sleep(Math.min(65_000, retryAfter * 1000 + 250));
    res = await fetch(url, {
      headers: { 'X-Auth-Token': apiKey, 'Accept': 'application/json' },
    });
  }

  const rate = parseRateLimit(res);
  lastSeenRate = { ...rate, when: Date.now() };

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`football-data ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Fetch scheduled matches in a date window for one competition.
 * Returns the raw `matches` array from the API (or [] on failure).
 */
async function fetchCompetitionMatches(apiKey, competitionCode, dateFrom, dateTo) {
  const url = `${API_BASE}/competitions/${competitionCode}/matches`
    + `?dateFrom=${dateFrom}&dateTo=${dateTo}&status=SCHEDULED`;
  try {
    const data = await fetchJson(url, apiKey);
    return Array.isArray(data?.matches) ? data.matches : [];
  } catch (e) {
    // Log but keep going with other competitions; one bad request
    // shouldn't drop the whole batch.
    console.error('[market-gen/soccer] competition fetch failed', {
      competition: competitionCode,
      message: e?.message,
      status: e?.status,
    });
    return [];
  }
}

/**
 * Build the primary match-winner market spec from a football-data.org match object.
 * Shape matches points_pending_markets columns so the caller can insert
 * directly.
 */
function matchToMarketSpec(match, competitionCode) {
  const homeName = match?.homeTeam?.shortName
                || match?.homeTeam?.name
                || 'Local';
  const awayName = match?.awayTeam?.shortName
                || match?.awayTeam?.name
                || 'Visitante';
  const kickoffUtc = match?.utcDate;
  if (!kickoffUtc) return null;
  // Trading stays open through 90 min + halftime + stoppage + buffer.
  // 3h padding past kickoff covers all of those plus a goalless extra
  // time edge case. Auto-resolver benign-skips until football-data
  // returns status=FINISHED so this is just the hard close.
  // 90 min + halftime + stoppage + buffer = ~2h. Auto-resolver
  // benign-skips until football-data returns status=FINISHED, so the
  // end_time is just the hard close if the results feed stalls.
  const kickoffMs = new Date(kickoffUtc).getTime();
  const winnerOnly = isOneLeggedCupFinal(match, competitionCode);
  const manualResolution = match?.manualResolution === true;
  const matchTypeLabel = TOURNAMENT_COMPETITIONS.has(competitionCode) ? 'TORNEO' : null;
  const startTime = new Date(kickoffMs).toISOString();
  const endTime   = new Date(kickoffMs + (winnerOnly ? 4 : 2) * 3600_000).toISOString();
  const league    = COMPETITION_TO_LEAGUE[competitionCode] || null;
  const espnLeaguePath = COMPETITION_TO_ESPN_PATH[competitionCode] || null;
  const resolverConfig = manualResolution && espnLeaguePath
    ? {
      source: 'espn',
      leaguePath: espnLeaguePath,
      eventId: null,
      dateYmd: startTime.slice(0, 10),
      homeName,
      awayName,
      shape: winnerOnly ? 'binary' : 'draw3',
    }
    : manualResolution
    ? null
    : {
      source: 'football-data',
      matchId: match.id,
      shape: winnerOnly ? 'binary' : 'draw3',
    };

  // Team crests aligned with the 3-way W/D/L outcomes. Draw has no
  // image. `crest` is the canonical field on football-data.org team
  // objects (SVG / PNG depending on the club).
  const homeCrest = match?.homeTeam?.crest || null;
  const awayCrest = match?.awayTeam?.crest || null;

  return {
    source: match?.source || 'football-data.org',
    source_event_id: String(match.id),
    sport: 'soccer',
    league,
    // Title format intentionally omits the "¿Quién gana ... ?" wrapper
    // — teams + vs is enough, user-tested preference.
    question: `${homeName} vs ${awayName}`,
    category: 'deportes',
    icon: null,
    outcomes: winnerOnly ? [homeName, awayName] : [homeName, 'Empate', awayName],
    outcome_images: winnerOnly ? [homeCrest, awayCrest] : [homeCrest, null, awayCrest],
    seed_liquidity: 1000,
    start_time: startTime,
    end_time: endTime,
    amm_mode: 'unified',
    resolver_type: resolverConfig ? 'sports_api' : null,
    resolver_config: resolverConfig,
    source_data: {
      matchId: match.id,
      competitionCode,
      competitionName: match?.competition?.name,
      matchday: match?.matchday,
      matchTypeLabel,
      kickoffUtc,
      manualResolution,
      home: { name: homeName, tla: match?.homeTeam?.tla, id: match?.homeTeam?.id },
      away: { name: awayName, tla: match?.awayTeam?.tla, id: match?.awayTeam?.id },
      knockoutFinal: winnerOnly,
    },
  };
}

function championFinalSideMarketSpecs(primarySpec, match, competitionCode) {
  if (!primarySpec || !isChampionsLeagueFinal(match, competitionCode)) return [];
  const matchId = match?.id;
  const baseSourceData = primarySpec.source_data || {};
  return [
    {
      ...primarySpec,
      source_event_id: `${matchId}:goals-over-2-5`,
      question: '¿La final tendrá más de 2.5 goles?',
      outcomes: ['Sí', 'No'],
      outcome_images: [null, null],
      resolver_type: 'sports_api',
      resolver_config: {
        source: 'football-data',
        matchId,
        shape: 'total-goals-over',
        threshold: 2.5,
      },
      source_data: {
        ...baseSourceData,
        marketType: 'total-goals-over',
        parentMatchId: matchId,
        threshold: 2.5,
      },
    },
    {
      ...primarySpec,
      source_event_id: `${matchId}:forward-mvp`,
      question: '¿Un delantero gana el MVP de la final?',
      outcomes: ['Sí', 'No'],
      outcome_images: [null, null],
      resolver_type: null,
      resolver_config: null,
      source_data: {
        ...baseSourceData,
        marketType: 'final-forward-mvp',
        parentMatchId: matchId,
        manualResolution: true,
      },
    },
  ];
}

function matchToMarketSpecs(match, competitionCode) {
  const primary = matchToMarketSpec(match, competitionCode);
  if (!primary) return [];
  return [
    primary,
    ...championFinalSideMarketSpecs(primary, match, competitionCode),
  ];
}

/**
 * Run the soccer generator. Returns an array of market specs ready to be
 * upserted into points_pending_markets.
 *
 * Deduplication: we generate a spec per unique match.id. If a Real
 * Madrid fixture appears in both CL and PD (impossible — different
 * competitions), it would only produce one spec since match.id is
 * globally unique across football-data.org.
 */
export async function generateSoccerMarkets({ horizonDays = 14 } = {}) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    console.warn('[market-gen/soccer] FOOTBALL_DATA_API_KEY not set — skipping');
    return [];
  }
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const dateFrom = formatDate(now);
  const dateTo   = formatDate(horizon);

  const seenMatchIds = new Set();
  const specs = [];

  // UCL — every fixture in-window
  for (const code of COMPETITIONS_ALL_FIXTURES) {
    let matches = await fetchCompetitionMatches(apiKey, code, dateFrom, dateTo);
    if (matches.length === 0) {
      matches = fallbackFinalMatchesForCompetition(code, dateFrom, dateTo);
    }
    for (const m of matches) {
      if (seenMatchIds.has(m.id)) continue;
      seenMatchIds.add(m.id);
      specs.push(...matchToMarketSpecs(m, code));
    }
  }

  // Team-filtered leagues — only whitelisted clubs
  for (const code of COMPETITIONS_TEAM_FILTER) {
    const matches = await fetchCompetitionMatches(apiKey, code, dateFrom, dateTo);
    for (const m of matches) {
      if (seenMatchIds.has(m.id)) continue;
      const homeTla = m?.homeTeam?.tla;
      const awayTla = m?.awayTeam?.tla;
      if (!TEAM_TLA_WHITELIST.has(homeTla) && !TEAM_TLA_WHITELIST.has(awayTla)) continue;
      seenMatchIds.add(m.id);
      specs.push(...matchToMarketSpecs(m, code));
    }
  }

  return specs;
}

// Exported for tests / unit introspection
export const _internal = {
  TEAM_TLA_WHITELIST,
  COMPETITIONS_ALL_FIXTURES,
  COMPETITIONS_TEAM_FILTER,
  TOURNAMENT_COMPETITIONS,
  isChampionsLeagueFinal,
  isOneLeggedCupFinal,
  fallbackFinalMatchesForCompetition,
  matchToMarketSpec,
  matchToMarketSpecs,
  formatDate,
};
