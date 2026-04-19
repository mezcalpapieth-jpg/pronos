/**
 * MLB market generator (binary, Home vs Away).
 *
 * ESPN scoreboard API is public, no key required. We pull scheduled
 * games for a rolling 3-day window and build one binary market per
 * game — "¿Quién gana {Away} @ {Home}?" — with outcomes [home, away].
 * (Baseball can't end in a draw so we skip the 3-way shape.)
 *
 * Resolver stays manual for now. Admin resolves by looking at the
 * final score; a future `espn_scoreboard` resolver can auto-settle by
 * re-reading the scoreboard after the game and picking the winner.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const HORIZON_DAYS = 3;

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

    const endTime = new Date(new Date(kickoff).getTime() - 2 * 60_000).toISOString();
    specs.push({
      source: 'espn-mlb',
      source_event_id: String(ev.id),
      question: `¿Quién gana ${away.team.displayName} @ ${home.team.displayName}?`,
      category: 'deportes',
      icon: '⚾',
      outcomes: [home.team.displayName, away.team.displayName],
      seed_liquidity: 1000,
      end_time: endTime,
      amm_mode: 'unified',           // 2-way home/away → unified binary
      resolver_type: null,           // admin resolves manually for now
      resolver_config: null,
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
