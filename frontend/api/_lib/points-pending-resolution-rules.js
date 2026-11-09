import { nationalTeamMarketTranslations } from './national-team-labels.js';

const ESPN_WINNER_PATHS = {
  'espn-ncaaf': 'football/college-football',
  'espn-nfl': 'football/nfl',
  'espn-nba': 'basketball/nba',
  'espn-ncaamb': 'basketball/mens-college-basketball',
  'espn-ncaawb': 'basketball/womens-college-basketball',
  'espn-mlb': 'baseball/mlb',
};

const numericId = value => /^[1-9]\d*$/.test(String(value));
const teamName = value => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value);

export function pendingResolutionCriteria(config, sourceData) {
  return [
    config?.criteria, config?.resolutionCriteria, sourceData?.resolutionCriteria, sourceData?.criteria,
  ].find(value => typeof value === 'string' && value.trim())?.trim() || null;
}

// Draft only from a recognized generator and the exact match identity it saved.
// The written rules describe the existing resolver's outcome mapping.
export function pendingApprovalResolutionRules(row) {
  const config = row.resolver_config;
  const sourceData = row.source_data;
  const criteria = pendingResolutionCriteria(config, sourceData);
  if (criteria) return { criteria, generated: false };
  if (row.amm_mode !== 'unified' || row.resolver_type !== 'sports_api' || config?.source !== 'espn') return null;

  const { eventId, leaguePath, shape } = config;
  const { home, away, kickoffUtc, leagueCode } = sourceData || {};
  const kickoff = Date.parse(kickoffUtc);
  if (!numericId(eventId) || String(eventId) !== String(sourceData?.eventId)
    || !numericId(home?.id) || !numericId(away?.id) || String(home.id) === String(away.id)
    || !teamName(home.name) || !teamName(away.name) || home.name === away.name
    || (config.homeName && config.homeName !== home.name) || (config.awayName && config.awayName !== away.name)
    || !Number.isFinite(kickoff) || kickoff !== new Date(row.start_time).getTime()
    || !(new Date(row.end_time).getTime() > kickoff)
    || config.dateYmd !== new Date(kickoff).toISOString().slice(0, 10)) return null;

  const soccer = row.source === 'espn-soccer';
  if (soccer) {
    if (shape !== 'draw3' || typeof leagueCode !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(leagueCode)
      || leaguePath !== `soccer/${leagueCode}` || row.source_event_id !== `${leagueCode}:${eventId}`) return null;
  } else if (shape !== 'binary' || !Object.hasOwn(ESPN_WINNER_PATHS, row.source)
    || leaguePath !== ESPN_WINNER_PATHS[row.source] || String(row.source_event_id) !== String(eventId)) return null;

  const translated = soccer ? nationalTeamMarketTranslations({
    leagueCode, homeName: home.name, awayName: away.name,
  })?.es : null;
  const matchup = `${away.name} @ ${home.name}`;
  const question = soccer ? translated?.question || `${home.name} vs ${away.name}`
    : row.source === 'espn-nfl' ? matchup : `¿Quién gana ${matchup}?`;
  const labels = translated?.outcomes || (soccer ? [home.name, 'Empate', away.name] : [home.name, away.name]);
  if (row.question !== question || !Array.isArray(row.outcomes) || row.outcomes.length !== labels.length
    || labels.some((label, index) => label !== row.outcomes[index])) return null;

  const sourceUrl = `https://site.api.espn.com/apis/site/v2/sports/${leaguePath}/summary?event=${eventId}`;
  const outcomeRule = soccer
    ? `Cuenta el marcador al término del tiempo reglamentario, incluido el añadido, sin prórroga ni penales. Gana ${labels[0]} si gana el local, Empate si terminan igualados y ${labels[2]} si gana el visitante.`
    : `Cuenta el ganador del resultado final, incluidos los periodos extra que se jueguen. Gana ${labels[0]} si gana el local y ${labels[1]} si gana el visitante.`;
  return {
    generated: true,
    sourceUrl,
    criteria: [
      `Se usa el resultado final publicado por ESPN para el evento ${eventId} (${leaguePath}), ${away.name} en visita a ${home.name}, programado para ${new Date(kickoff).toISOString()} (UTC).`,
      outcomeRule,
      'Si el partido se aplaza o suspende, se espera un resultado final verificable del mismo evento. Si ESPN no confirma un resultado que corresponda a una opción, el mercado pasa a revisión manual.',
    ].join(' '),
  };
}
