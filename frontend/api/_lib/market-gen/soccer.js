/**
 * Soccer market generator — football-data.org client.
 *
 * Returns an array of market specs for upcoming matches involving the
 * user-defined team whitelist, plus every UEFA Champions League fixture.
 * Only fixtures within the next `horizonDays` (default 14) are returned,
 * and only those with status=SCHEDULED (so finished/live matches don't
 * show up as "pending to create").
 *
 * API: https://www.football-data.org/documentation/quickstart
 *   Free tier: 10 req/min, 12 competitions. Key goes in X-Auth-Token.
 *
 * Free-tier competition codes we use:
 *   CL  — UEFA Champions League
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
  'CHE',   // Chelsea
  'MCI',   // Manchester City
  'MUN',   // Manchester United
  'JUV',   // Juventus
  'MIL',   // AC Milan
]);

// Competition codes to pull. CL is always included (every fixture — user
// wanted all UCL). PD/PL/SA are scanned and filtered to the team whitelist.
const COMPETITIONS_ALL_FIXTURES = ['CL'];
const COMPETITIONS_TEAM_FILTER  = ['PD', 'PL', 'SA'];

const API_BASE = 'https://api.football-data.org/v4';

function formatDate(d) {
  // football-data.org wants YYYY-MM-DD. Use UTC consistently so daylight
  // saving and the user's local tz don't shift the range boundary.
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
 * Build a single market spec from a football-data.org match object.
 * Shape matches points_pending_markets columns so the caller can insert
 * directly. Resolver stays 'manual' for soccer — the auto-resolve cron
 * will get a sports_api variant in a later phase.
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
  // Lock trading 2 minutes before kickoff so odds don't update mid-match
  // while the resolver race-checks the score.
  const endTime = new Date(new Date(kickoffUtc).getTime() - 2 * 60_000).toISOString();

  return {
    source: 'football-data.org',
    source_event_id: String(match.id),
    question: `¿Quién gana ${homeName} vs ${awayName}?`,
    category: 'deportes',
    icon: '⚽',
    outcomes: [homeName, 'Empate', awayName],
    seed_liquidity: 1000,
    end_time: endTime,
    amm_mode: 'unified',              // 3-way W/D/L → unified CPMM
    resolver_type: null,              // manual for now; sports_api later
    resolver_config: null,
    source_data: {
      matchId: match.id,
      competitionCode,
      competitionName: match?.competition?.name,
      matchday: match?.matchday,
      kickoffUtc,
      home: { name: homeName, tla: match?.homeTeam?.tla, id: match?.homeTeam?.id },
      away: { name: awayName, tla: match?.awayTeam?.tla, id: match?.awayTeam?.id },
    },
  };
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
    const matches = await fetchCompetitionMatches(apiKey, code, dateFrom, dateTo);
    for (const m of matches) {
      if (seenMatchIds.has(m.id)) continue;
      seenMatchIds.add(m.id);
      const spec = matchToMarketSpec(m, code);
      if (spec) specs.push(spec);
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
      const spec = matchToMarketSpec(m, code);
      if (spec) specs.push(spec);
    }
  }

  return specs;
}

// Exported for tests / unit introspection
export const _internal = {
  TEAM_TLA_WHITELIST,
  COMPETITIONS_ALL_FIXTURES,
  COMPETITIONS_TEAM_FILTER,
  matchToMarketSpec,
  formatDate,
};
