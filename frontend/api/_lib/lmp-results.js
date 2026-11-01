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
// Postponements can appear twice with the SAME gamePk in the schedule.
// Follow only the feed's explicit reschedule links; array order is not chronology.
export function selectLmpGame(games, config) {
  const matches = games.filter(game => String(game.gamePk) === String(config.eventId));
  if (!matches.length) throw new Error('lmp_event_not_found');
  const identity = { ...config,
    homeId: config.homeId || matches[0]?.teams?.home?.team?.id,
    awayId: config.awayId || matches[0]?.teams?.away?.team?.id };
  const groups = new Map();
  for (const game of matches) {
    normalizeLmpResult(game, identity); // Every record must agree on league and participants.
    const at = Date.parse(game.gameDate);
    if (!Number.isFinite(at)) throw new Error('lmp_invalid_game_date');
    const group = groups.get(at) || [];
    group.push(game);
    groups.set(at, group);
  }
  const dates = [...groups.keys()].sort((a, b) => a - b);
  for (let i = 1; i < dates.length; i++) {
    const previous = dates[i - 1], current = dates[i];
    const linked = groups.get(previous).some(game => Date.parse(game.rescheduleDate) === current)
      || groups.get(current).some(game => Date.parse(game.rescheduledFrom) === previous);
    if (!linked) throw new Error('lmp_ambiguous_reschedule');
    if (groups.get(previous).some(game => normalizeLmpResult(game, config).completed)) {
      throw new Error('lmp_conflicting_final');
    }
  }
  const current = groups.get(dates.at(-1));
  const normalized = current.map(game => ({ game, result: normalizeLmpResult(game, config) }));
  const finals = normalized.filter(row => row.result.completed);
  if (finals.length) {
    const first = finals[0].result;
    if (normalized.some(row => row.result.interrupted)
      || finals.some(({ result }) => result.homeScore !== first.homeScore || result.awayScore !== first.awayScore)) {
      throw new Error('lmp_conflicting_final');
    }
    return finals[0].game;
  }
  // Ambiguous non-final records must not accidentally expose a winner either.
  return current[0];
}
export async function readLmpEvent(config, { fetchImpl = fetch } = {}) {
  if (!/^\d+$/.test(String(config?.eventId || ''))) throw new Error('lmp_missing_event_id');
  const games = await fetchLmpSchedule({ gamePk: config.eventId, fetchImpl });
  const game = selectLmpGame(games, config);
  return { ...normalizeLmpResult(game, config), gameDate: game.gameDate,
    rescheduledFrom: game.rescheduledFrom || null };
}
