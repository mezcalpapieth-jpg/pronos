/**
 * ESPN-backed soccer generator for Liga MX + MLS.
 *
 * Why not football-data.org: Liga MX and MLS are both paywalled on
 * their free tier, and the user specifically wants Liga MX (all
 * matches) and MLS (Inter Miami). ESPN's soccer scoreboard is a
 * keyless public JSON API with the same shape we use for MLB/NBA.
 *
 * Scope:
 *   - `mex.1` (Liga MX): every scheduled game inside the 14-day window
 *   - `usa.1` (MLS): filtered to a team whitelist. Today: Inter Miami
 *     only. Expand the MLS_WHITELIST constant to pick up more clubs.
 *
 * Outcome shape: 3-way W/D/L (draws are possible in soccer), matching
 * the football-data.org-backed generator — admin approves identical
 * market shapes regardless of which source found the game.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const HORIZON_DAYS = 14;

// MLS team whitelist — matches ESPN's displayName exactly. Add more
// teams here to auto-include their MLS fixtures in the queue.
const MLS_WHITELIST = new Set([
  'Inter Miami CF',
]);

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
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

/**
 * Convert an ESPN soccer event into the shared market-spec shape used
 * by points_pending_markets. Returns null for events we should skip.
 */
function eventToSpec(ev, { leagueCode, leagueLabel }) {
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

  // 2h padding past kickoff — 90' play + halftime + stoppage + buffer.
  // Auto-resolver waits for ESPN's `completed=true` anyway, so end_time
  // is just the hard close if the scoreboard stalls.
  const kickoffMs = new Date(kickoff).getTime();
  const startTime = new Date(kickoffMs).toISOString();
  const endTime   = new Date(kickoffMs + 2 * 3600_000).toISOString();
  const dateYmd   = new Date(kickoff).toISOString().slice(0, 10);
  const league    = leagueCode === 'mex.1' ? 'liga-mx'
                  : leagueCode === 'usa.1' ? 'mls'
                  : null;
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
    icon: '⚽',
    outcomes: [homeName, 'Empate', awayName],
    outcome_images: [homeLogo, null, awayLogo],
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
      shape: 'draw3',
    },
    source_data: {
      eventId: ev.id,
      leagueCode,
      leagueLabel,
      kickoffUtc: kickoff,
      home: { id: home?.team?.id, name: homeName, abbr: home?.team?.abbreviation },
      away: { id: away?.team?.id, name: awayName, abbr: away?.team?.abbreviation },
      venue: comp?.venue?.fullName || null,
    },
  };
}

export async function generateEspnSoccerMarkets() {
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const dateRange = `${formatDateCompact(now)}-${formatDateCompact(horizon)}`;

  const specs = [];

  // Liga MX: all scheduled games in the window.
  for (const ev of await fetchLeagueEvents('mex.1', dateRange)) {
    const spec = eventToSpec(ev, { leagueCode: 'mex.1', leagueLabel: 'Liga MX' });
    if (spec) specs.push(spec);
  }

  // MLS: filter to whitelist (Inter Miami today).
  for (const ev of await fetchLeagueEvents('usa.1', dateRange)) {
    const comp = Array.isArray(ev.competitions) ? ev.competitions[0] : null;
    const comps = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const names = comps.map(c => c?.team?.displayName).filter(Boolean);
    if (!names.some(n => MLS_WHITELIST.has(n))) continue;
    const spec = eventToSpec(ev, { leagueCode: 'usa.1', leagueLabel: 'MLS' });
    if (spec) specs.push(spec);
  }

  return specs;
}

// Exported for tests / manual inspection
export const _internal = {
  MLS_WHITELIST,
  eventToSpec,
  formatDateCompact,
};
