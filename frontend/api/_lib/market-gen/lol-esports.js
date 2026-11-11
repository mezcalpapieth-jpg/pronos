import { fetchLolSchedule, isConfirmedLolMatch, LOL_LEAGUES, lolScheduleUrl } from '../lol-esports.js';

export async function generateLolEsportsMarkets({ now = new Date(), horizonDays = 7, fetchImpl = fetch } = {}) {
  const nowMs = new Date(now).getTime();
  const horizonMs = nowMs + horizonDays * 86_400_000;
  const specs = [];
  for (const leagueSlug of LOL_LEAGUES) {
    const events = await fetchLolSchedule({ leagueSlug, fetchImpl });
    for (const event of events) {
      const startMs = Date.parse(event.startTime);
      if (!isConfirmedLolMatch(event) || event.state !== 'unstarted' || event.match.state !== 'unstarted'
        || event.matchTeams.some(team => team.result?.gameWins !== 0 || team.result?.outcome)
        || !Number.isFinite(startMs) || startMs <= nowMs || startMs > horizonMs) continue;
      const [home, away] = event.matchTeams;
      const bestOf = event.match.strategy.count;
      const sourceUrl = lolScheduleUrl(leagueSlug);
      const criteria = `Gana el equipo que Riot Games declare ganador de la serie completa de League of Legends en LoL Esports (partido ${event.id}, al mejor de ${bestOf}). El marcador corresponde a victorias de partidas de la serie. Solo se resuelve cuando Riot marca la serie como completada y confirma el ganador y el marcador. Aplazamientos, cancelaciones, cambios de participantes o resultados incompletos quedan pendientes de revisión.`;
      specs.push({
        source: 'lolesports', source_event_id: String(event.id),
        category: 'deportes', sport: 'esports', league: 'lol',
        question: `¿Quién gana ${home.name} vs ${away.name}?`,
        outcomes: [home.name, away.name],
        outcome_images: [home, away].map(team => team.image?.replace(/^http:/, 'https:') || null),
        seed_liquidity: 1000, amm_mode: 'unified',
        start_time: new Date(startMs).toISOString(), end_time: new Date(startMs + 7 * 3600_000).toISOString(),
        resolver_type: 'sports_api',
        resolver_config: {
          source: 'lolesports', shape: 'binary', eventId: String(event.id), leagueSlug,
          tournamentId: String(event.tournament.id), homeId: String(home.teamId), awayId: String(away.teamId),
          bestOf, criteria,
        },
        source_data: {
          eventId: String(event.id), kickoffUtc: event.startTime, sourceUrl,
          league: event.league.name, tournament: event.tournament.name, round: event.blockName, bestOf,
          home: { id: String(home.teamId), name: home.name, abbr: home.code },
          away: { id: String(away.teamId), name: away.name, abbr: away.code },
          resolutionCriteria: criteria,
        },
      });
    }
  }
  return specs;
}
