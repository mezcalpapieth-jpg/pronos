// MLB Advanced Media's official winter-league feed: league 132, sport 17.
export const LMP_LEAGUE_ID = 132;
export const LMP_SPORT_ID = 17;
export const LMP_STATS_BASE = 'https://statsapi.mlb.com/api/v1';
export async function fetchLmpSchedule({ fromDate, toDate, gamePk, fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({ sportId: String(LMP_SPORT_ID), leagueId: String(LMP_LEAGUE_ID), hydrate: 'team,linescore' });
  if (gamePk) params.set('gamePk', String(gamePk));
  else { params.set('startDate', fromDate); params.set('endDate', toDate); }
  const response = await fetchImpl(`${LMP_STATS_BASE}/schedule?${params}`, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`lmp_schedule_http_${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.dates)) throw new Error('lmp_invalid_schedule');
  return data.dates.flatMap(day => Array.isArray(day.games) ? day.games : []);
}
export function isLmpGame(game) {
  return [game?.teams?.home?.team, game?.teams?.away?.team].every(team =>
    team?.id && Number(team.league?.id) === LMP_LEAGUE_ID && Number(team.sport?.id) === LMP_SPORT_ID);
}
export function normalizeLmpResult(game, { eventId, homeId, awayId } = {}) {
  if (!game || String(game.gamePk) !== String(eventId) || !isLmpGame(game)
    || (homeId && String(homeId) !== String(game.teams.home.team.id))
    || (awayId && String(awayId) !== String(game.teams.away.team.id))) throw new Error('lmp_event_mismatch');
  const status = game.status || {};
  const interrupted = /suspend|postpon|cancel|delay/i.test(status.detailedState || '');
  const completed = status.codedGameState === 'F' && !interrupted;
  const runs = value => value == null || value === '' ? NaN : Number(value);
  const homeScore = runs(game.teams.home.score);
  const awayScore = runs(game.teams.away.score);
  const validScore = [homeScore, awayScore].every(n => Number.isInteger(n) && n >= 0);
  return { source: 'mlb-stats', eventId: String(game.gamePk), completed: completed && validScore && homeScore !== awayScore,
    state: completed ? 'post' : status.abstractGameState === 'Live' ? 'in' : status.abstractGameState === 'Preview' ? 'pre' : null,
    interrupted, winner: completed && validScore && homeScore !== awayScore ? homeScore > awayScore ? 'home' : 'away' : null,
    homeScore: validScore ? homeScore : null, awayScore: validScore ? awayScore : null,
    homeName: game.teams.home.team.name, awayName: game.teams.away.team.name,
    homeTeam: game.teams.home.team.name, awayTeam: game.teams.away.team.name };
}
export async function readLmpEvent(config, { fetchImpl = fetch } = {}) {
  if (!/^\d+$/.test(String(config?.eventId || ''))) throw new Error('lmp_missing_event_id');
  const games = await fetchLmpSchedule({ gamePk: config.eventId, fetchImpl });
  const game = games.find(g => String(g.gamePk) === String(config.eventId));
  if (!game) throw new Error('lmp_event_not_found');
  return normalizeLmpResult(game, config);
}
