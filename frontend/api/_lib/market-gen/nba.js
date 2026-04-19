/**
 * NBA market generator (binary, Home vs Away).
 *
 * Same pattern as mlb.js — ESPN public scoreboard, 3-day forward
 * window, one binary per game. NBA also has no draws so outcomes
 * stay [home, away].
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const HORIZON_DAYS = 3;

function formatDateCompact(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export async function generateNbaMarkets() {
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
    console.error('[market-gen/nba] scoreboard fetch failed', { message: e?.message });
    return [];
  }

  const events = Array.isArray(data?.events) ? data.events : [];
  const specs = [];
  for (const ev of events) {
    const status = ev?.status?.type?.state;
    if (status !== 'pre') continue;
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
      source: 'espn-nba',
      source_event_id: String(ev.id),
      question: `¿Quién gana ${away.team.displayName} @ ${home.team.displayName}?`,
      category: 'deportes',
      icon: '🏀',
      outcomes: [home.team.displayName, away.team.displayName],
      seed_liquidity: 1000,
      end_time: endTime,
      amm_mode: 'unified',
      resolver_type: null,
      resolver_config: null,
      source_data: {
        eventId: ev.id,
        kickoffUtc: kickoff,
        league: 'NBA',
        home: { id: home?.team?.id, name: home.team.displayName, abbr: home.team.abbreviation },
        away: { id: away?.team?.id, name: away.team.displayName, abbr: away.team.abbreviation },
        venue: comp?.venue?.fullName || null,
      },
    });
  }
  return specs;
}
