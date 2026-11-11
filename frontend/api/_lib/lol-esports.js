import { isDeepStrictEqual } from 'node:util';

const SCHEDULE_BASE = 'https://lolesports.com/en-US/leagues/';
export const LOL_LEAGUES = ['worlds'];
const schedules = new WeakMap();
const idValid = value => /^[1-9]\d*$/.test(String(value || ''));

export function lolScheduleUrl(leagueSlug = 'worlds') {
  if (!LOL_LEAGUES.includes(leagueSlug)) throw new Error('lolesports: unsupported league');
  return `${SCHEDULE_BASE}${leagueSlug}`;
}

// Read JSON from Riot's server-rendered Apollo data. Never evaluate page scripts.
function jsonArrayEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return i + 1;
  }
  throw new Error('lolesports: incomplete schedule data');
}

export function parseLolSchedule(html, leagueSlug = 'worlds') {
  const events = new Map();
  let foundSchedule = false;
  for (const [, script] of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!script.includes('ApolloSSRDataTransport')) continue;
    const marker = /"__typename"\s*:\s*"EsportsData"\s*,\s*"events"\s*:\s*(\[)/g;
    let match;
    while ((match = marker.exec(script))) {
      foundSchedule = true;
      const start = marker.lastIndex - 1;
      const end = jsonArrayEnd(script, start);
      for (const event of JSON.parse(script.slice(start, end))) {
        if (event?.__typename !== 'EventMatch' || event.type !== 'match' || event.league?.slug !== leagueSlug) continue;
        if (!idValid(event.id) || String(event.match?.id) !== String(event.id)) {
          throw new Error('lolesports: invalid match identity');
        }
        const previous = events.get(String(event.id));
        if (previous && !isDeepStrictEqual(previous, event)) {
          throw new Error('lolesports: conflicting match data');
        }
        events.set(String(event.id), event);
      }
      marker.lastIndex = end;
    }
  }
  if (!foundSchedule) throw new Error('lolesports: structured schedule unavailable');
  return [...events.values()];
}

export async function fetchLolSchedule({ leagueSlug = 'worlds', fetchImpl = fetch, cacheMs = 20_000 } = {}) {
  const url = lolScheduleUrl(leagueSlug);
  const cache = schedules.get(fetchImpl) || new Map();
  schedules.set(fetchImpl, cache);
  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < cacheMs) return cached.promise;
  const entry = { at: Date.now() };
  entry.promise = (async () => {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'text/html' }, cache: 'no-store', signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`lolesports: HTTP ${response.status}`);
      return parseLolSchedule(await response.text(), leagueSlug);
    } catch (error) {
      if (cache.get(url) === entry) cache.delete(url);
      throw error;
    }
  })();
  cache.set(url, entry);
  return entry.promise;
}

export function isConfirmedLolMatch(event) {
  const teams = event?.matchTeams;
  const strategy = event?.match?.strategy;
  return idValid(event?.id) && String(event.match?.id) === String(event.id)
    && idValid(event.tournament?.id) && event.match.type === 'normal'
    && strategy?.type === 'bestOf' && [1, 3, 5].includes(strategy.count)
    && Array.isArray(teams) && teams.length === 2
    && teams.every(team => idValid(team.teamId) && team.name?.trim() && !/^(tbd|tba|unknown)$/i.test(team.name.trim()))
    && String(teams[0].teamId) !== String(teams[1].teamId);
}

export function normalizeLolEvent(event, config) {
  const base = { completed: false, winner: null };
  if (!event) return { ...base, notFound: true };
  const identityValid = isConfirmedLolMatch(event)
    && String(event.id) === String(config.eventId)
    && event.league?.slug === config.leagueSlug
    && String(event.tournament.id) === String(config.tournamentId)
    && event.match.strategy.count === Number(config.bestOf);
  const home = event.matchTeams?.find(team => String(team.teamId) === String(config.homeId));
  const away = event.matchTeams?.find(team => String(team.teamId) === String(config.awayId));
  if (!identityValid || !home || !away || String(config.homeId) === String(config.awayId)) {
    return { ...base, invalidResult: true, reason: 'lolesports_identity_mismatch' };
  }
  if (event.state !== event.match.state) {
    return { ...base, invalidResult: true, reason: 'lolesports_state_mismatch' };
  }
  const state = { unstarted: 'pre', inProgress: 'in', completed: 'post' }[event.state] || null;
  const homeScore = home.result?.gameWins;
  const awayScore = away.result?.gameWins;
  const needed = Math.floor(Number(config.bestOf) / 2) + 1;
  const validScore = [homeScore, awayScore].every(score => Number.isInteger(score) && score >= 0 && score <= needed)
    && Math.min(homeScore, awayScore) < needed;
  if (!validScore || (state === 'pre' && homeScore + awayScore !== 0)) return { ...base, invalidResult: true, reason: 'lolesports_invalid_score' };
  const result = {
    ...base, state, interrupted: !state, tradingClosed: Math.max(homeScore, awayScore) === needed,
    eventId: String(event.id), homeScore, awayScore, homeTeam: home.name, awayTeam: away.name,
    home: { id: String(home.teamId), name: home.name, score: homeScore, logo: home.image?.replace(/^http:/, 'https:') || null },
    away: { id: String(away.teamId), name: away.name, score: awayScore, logo: away.image?.replace(/^http:/, 'https:') || null },
    bestOf: Number(config.bestOf), sourceUrl: lolScheduleUrl(config.leagueSlug),
    observedAt: new Date().toISOString(),
  };
  if (state !== 'post') return result;
  const homeWon = homeScore === needed && home.result?.outcome === 'win' && away.result?.outcome === 'loss';
  const awayWon = awayScore === needed && away.result?.outcome === 'win' && home.result?.outcome === 'loss';
  if (!homeWon && !awayWon) return { ...result, invalidResult: true, reason: 'lolesports_unconfirmed_winner' };
  return { ...result, completed: true, winner: homeWon ? 'home' : 'away' };
}

export async function readLolEvent(config, options = {}) {
  if (!['eventId', 'tournamentId', 'homeId', 'awayId'].every(key => idValid(config[key]))
    || ![1, 3, 5].includes(Number(config.bestOf)) || config.shape !== 'binary') {
    throw new Error('lolesports: incomplete match configuration');
  }
  const events = await fetchLolSchedule({ ...options, leagueSlug: config.leagueSlug });
  return normalizeLolEvent(events.find(event => String(event.id) === String(config.eventId)), config);
}

export async function readLolLiveScore(config) {
  const result = await readLolEvent({ ...config, shape: 'binary' });
  if (result.notFound || result.invalidResult || result.interrupted) return null;
  return {
    source: 'lolesports', sport: 'esports', leaguePath: 'esports/lol', eventId: result.eventId,
    state: result.state, completed: result.completed, home: result.home, away: result.away,
    statusLabel: result.completed ? 'Final' : `Bo${result.bestOf}`, periods: [],
    lastUpdatedAt: result.observedAt,
  };
}
