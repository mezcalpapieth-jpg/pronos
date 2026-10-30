import { fetchLmpSchedule, isLmpGame } from '../lmp-results.js';

export async function generateLmpMarkets({ now = new Date(), horizonDays = 4, fetchImpl = fetch } = {}) {
  const nowMs = new Date(now).getTime();
  const horizon = nowMs + horizonDays * 86400000;
  const games = await fetchLmpSchedule({ fromDate: new Date(nowMs).toISOString().slice(0, 10), toDate: new Date(horizon).toISOString().slice(0, 10), fetchImpl });
  const seen = new Set();
  return games.flatMap(game => {
    const start = Date.parse(game.gameDate);
    if (!isLmpGame(game) || game.status?.abstractGameState !== 'Preview' || game.status?.codedGameState !== 'S'
      || game.status?.startTimeTBD || !Number.isFinite(start) || start <= nowMs || start > horizon || seen.has(game.gamePk)) return [];
    seen.add(game.gamePk);
    const home = game.teams.home.team, away = game.teams.away.team;
    return [{ source: 'mlb-stats-lmp', source_event_id: String(game.gamePk), sport: 'baseball', league: 'lmp', category: 'deportes',
      question: `¿Quién gana ${away.name} @ ${home.name}?`, outcomes: [home.name, away.name],
      outcome_images: [home.id, away.id].map(id => `https://www.mlbstatic.com/team-logos/${id}.svg`),
      seed_liquidity: 1000, amm_mode: 'unified', start_time: new Date(start).toISOString(), end_time: new Date(start + 5 * 3600000).toISOString(),
      resolver_type: 'sports_api', resolver_config: { source: 'mlb-stats', shape: 'binary', eventId: String(game.gamePk), leagueId: 132, homeId: home.id, awayId: away.id, dateYmd: game.officialDate },
      source_data: { eventId: String(game.gamePk), kickoffUtc: game.gameDate, league: 'LMP', home: { id: home.id, name: home.name }, away: { id: away.id, name: away.name },
        sourceUrl: `https://statsapi.mlb.com/api/v1/schedule?gamePk=${game.gamePk}&sportId=17&leagueId=132&hydrate=team,linescore`,
        venue: game.venue, gameNumber: game.gameNumber,
        resolutionCriteria: 'Se resuelve con el marcador Final oficial de MLB Stats para este juego de LMP. Los partidos suspendidos o aplazados esperan el resultado definitivo.' }
    }];
  });
}
