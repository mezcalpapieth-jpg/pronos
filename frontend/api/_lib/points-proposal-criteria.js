import { FUEL_TYPES, fuelLabel } from './fuel.js';
import { normalizeResolverLabel } from './sports-resolver-policy.js';

const hasId = value => /^[1-9]\d*$/.test(String(value));
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const drawLabels = ['empate', 'draw', 'tie'];
const yesNo = labels => labels.length === 2 && labels.includes('si') && labels.includes('no');

export function hasWrittenCriteria(config, sourceData) {
  return [config.criteria, config.resolutionCriteria, sourceData.criteria, sourceData.resolutionCriteria].some(hasText);
}

function fixtureCriteria(config, labels) {
  const { source, shape, eventId, matchId, leaguePath } = config;
  const soccer = source === 'football-data' || (source === 'espn' && typeof leaguePath === 'string' && leaguePath.startsWith('soccer/'));
  let fixture;
  if (source === 'espn' && hasId(eventId) && /^(?:baseball|basketball|football|hockey|soccer)\/[\w.-]+$/.test(leaguePath)) {
    fixture = `el partido de ESPN (evento ${eventId})`;
  } else if (source === 'football-data' && hasId(matchId)) {
    fixture = `el partido de football-data.org (partido ${matchId})`;
  } else if (source === 'mlb-stats' && hasId(eventId)) {
    fixture = `el juego de la LMP en MLB Stats (juego ${eventId})`;
  } else if (source === 'espn-mma' && hasId(eventId) && hasId(config.fightId)) {
    fixture = `el combate de ESPN (evento ${eventId}, combate ${config.fightId})`;
  } else if (source === 'espn-atp-match' && hasId(eventId) && hasText(String(matchId ?? ''))) {
    fixture = `el partido de tenis de ESPN (evento ${eventId}, partido ${matchId})`;
  } else {
    return null;
  }

  const regulation = 'Se cuentan los 90 minutos reglamentarios y el tiempo añadido. La prórroga y la tanda de penales quedan fuera.';
  if (soccer && shape === 'draw3' && labels.length === 3 && drawLabels.includes(labels[1])) {
    return `Se usa el marcador de ${fixture} una vez que la fuente lo marca como finalizado. Gana la opción del equipo con más goles o Empate si ambos equipos terminan igualados. ${regulation}`;
  }
  const threshold = Number(config.threshold ?? 2.5);
  if (soccer && shape === 'total-goals-over' && labels[0] === 'si' && yesNo(labels) && Number.isFinite(threshold) && threshold >= 0) {
    return `Se suman los goles de ambos equipos en ${fixture} una vez que la fuente lo marca como finalizado. Gana Sí si el total supera ${threshold}. En cualquier otro caso gana No. ${regulation}`;
  }
  if (shape !== 'binary' || labels.length !== 2 || yesNo(labels) || labels.some(label => drawLabels.includes(label))) return null;

  return `Gana la opción del participante declarado ganador en ${fixture} una vez que la fuente registra el resultado final. ${soccer
    ? 'Se incluye la prórroga o la tanda de penales si definen al ganador. '
    : ''}Si la fuente todavía no registra un ganador, el mercado queda pendiente.`;
}

const priceOperators = { gt: 'mayor que', gte: 'mayor o igual que', lt: 'menor que', lte: 'menor o igual que' };

function thresholdCriteria(type, config, outcomes, labels) {
  const yesIndex = Number(config.yesOutcome);
  const threshold = Number(config.threshold);
  const operator = Object.hasOwn(priceOperators, config.op) ? priceOperators[config.op] : null;
  if (config.shape || !yesNo(labels) || config.yesOutcome == null || labels[yesIndex] !== 'si' || !operator
    || config.threshold == null || config.threshold === '' || !Number.isFinite(threshold)) return null;

  let reading;
  if (type === 'chainlink_price' && /^0x[0-9a-f]{40}$/i.test(config.feedAddress) && hasId(config.chainId)
    && hasText(config.symbol) && !config.closesAt) {
    reading = `el precio de ${config.symbol} de la última actualización de Chainlink disponible a la hora de cierre del mercado`;
  } else if (type === 'api_price' && config.source === 'finnhub' && hasText(config.symbol)) {
    reading = `la cotización de ${config.symbol} publicada por Finnhub en la consulta de resolución tras el cierre`;
  } else if (type === 'api_price' && config.source === 'cre-gasolina' && FUEL_TYPES.includes(config.fuelType)) {
    reading = `el precio promedio nacional de ${fuelLabel(config.fuelType)} según los precios reportados a la CRE en la consulta de resolución tras el cierre`;
  } else {
    return null;
  }

  return `Se usa ${reading}. Gana ${outcomes[yesIndex]} si el valor es ${operator} ${threshold}. En cualquier otro caso gana ${outcomes[1 - yesIndex]}.`;
}

function chartCriteria(config, outcomes) {
  const { legs, source } = config;
  if (!['apple-mx-songs', 'youtube-trending-mx'].includes(source) || !Array.isArray(legs)
    || legs.length !== outcomes.length || !legs.every((leg, i) => leg?.label === outcomes[i])) return null;

  const apple = source === 'apple-mx-songs';
  const hasIdentity = apple ? leg => hasText(leg.artist) : leg => hasText(leg.channelId) || hasText(leg.channel);
  const unmatched = legs.filter(leg => !hasIdentity(leg));
  if (unmatched.length !== 1 || unmatched[0].artist || unmatched[0].channel || unmatched[0].channelId) return null;

  const rankedEntry = apple ? 'el artista de la canción #1 en Apple Music México' : 'el canal del video #1 en Tendencias de YouTube México';
  return `Gana la opción que coincida con ${rankedEntry} en la consulta de resolución tras el cierre. Si no coincide con ninguna opción identificada, gana «${unmatched[0].label}».`;
}

export function generateProposalCriteria(type, config, sourceData, outcomes) {
  if (hasWrittenCriteria(config, sourceData) || !Array.isArray(outcomes)
    || outcomes.length < 2 || !outcomes.every(hasText)) return null;
  const labels = outcomes.map(normalizeResolverLabel);
  if (labels.some(label => !label) || new Set(labels).size !== labels.length) return null;

  if (type === 'sports_api') return fixtureCriteria(config, labels);
  if (type === 'api_price' || type === 'chainlink_price') return thresholdCriteria(type, config, outcomes, labels);
  if (type === 'api_chart') return chartCriteria(config, outcomes);
  return null;
}
