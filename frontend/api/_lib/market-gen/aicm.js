import {
  AICM_DAILY_DELAY_BUCKETS,
  AICM_DEFAULT_FLIGHTS_URL,
  AICM_SOURCE,
} from '../aicm-board.js';
import {
  MEXICO_CITY_TZ,
  dateAtMexicoCityTime,
  formatMexicoDateEs,
  formatMexicoDateYmd,
} from './mexico-time.js';

export const AICM_AIRPORT = {
  key: 'aicm',
  code: 'MEX',
  icao: 'MMMX',
  label: 'AICM',
  name: 'Aeropuerto Internacional de la Ciudad de México',
  city: 'Ciudad de México',
  timezone: MEXICO_CITY_TZ,
};

function ymdParts(ymd) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  return { year, month, day };
}

function targetLocalDate(now, daysAhead = 1) {
  return new Date(now.getTime() + Number(daysAhead || 0) * 86_400_000);
}

export function aicmDelayResolutionCriteria({
  airport = AICM_AIRPORT,
  directionLabel = 'salidas',
  fromDateYmd,
  toDateYmd = fromDateYmd,
} = {}) {
  const sameDay = fromDateYmd && fromDateYmd === toDateYmd;
  const windowText = sameDay
    ? `del ${fromDateYmd}`
    : `del ${fromDateYmd} al ${toDateYmd}`;
  return `Cuenta vuelos comerciales de ${directionLabel} del ${airport.label} ${windowText} que hayan sido observados al menos una vez con estatus DEMORADO en el tablero oficial del aeropuerto. Los vuelos cancelados no cuentan como demorados. Si no hay suficientes lecturas confiables del tablero, el mercado queda para revisión manual.`;
}

export async function generateAicmMarkets({ now = new Date(), daysAhead = 1 } = {}) {
  const target = targetLocalDate(now, daysAhead);
  const targetYmd = formatMexicoDateYmd(target);
  const targetEs = formatMexicoDateEs(target);
  const end = dateAtMexicoCityTime({ ...ymdParts(targetYmd), hour: 23, minute: 59, second: 0 });
  const buckets = AICM_DAILY_DELAY_BUCKETS.map(bucket => ({ ...bucket }));
  const criteria = aicmDelayResolutionCriteria({
    fromDateYmd: targetYmd,
    toDateYmd: targetYmd,
  });

  return [{
    source: AICM_SOURCE,
    source_event_id: `aicm:${AICM_AIRPORT.code}:departure:day:${targetYmd}`,
    question: `¿Cuántas salidas del AICM estarán demoradas el ${targetEs}?`,
    category: 'infraestructura',
    icon: '✈️',
    outcomes: buckets.map(bucket => bucket.label),
    seed_liquidity: 1000,
    end_time: end.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'aicm_delay_count',
    resolver_config: {
      source: AICM_SOURCE,
      shape: 'delay-bucket',
      airportKey: AICM_AIRPORT.key,
      airportCode: AICM_AIRPORT.code,
      airportIcao: AICM_AIRPORT.icao,
      airportLabel: AICM_AIRPORT.label,
      timezone: AICM_AIRPORT.timezone,
      direction: 'departure',
      statusNorm: 'delayed',
      window: 'day',
      fromDateYmd: targetYmd,
      toDateYmd: targetYmd,
      minObservedPolls: 36,
      minObservedFlights: 20,
      buckets,
      criteria,
      evidenceUrl: AICM_DEFAULT_FLIGHTS_URL,
    },
    source_data: {
      kind: 'aicm_delay_window',
      airportKey: AICM_AIRPORT.key,
      airportCode: AICM_AIRPORT.code,
      airportIcao: AICM_AIRPORT.icao,
      airportLabel: AICM_AIRPORT.label,
      airportName: AICM_AIRPORT.name,
      airportCity: AICM_AIRPORT.city,
      marketRegion: 'mexico',
      timezone: AICM_AIRPORT.timezone,
      direction: 'departure',
      directionLabel: 'salidas',
      window: 'day',
      fromDateYmd: targetYmd,
      toDateYmd: targetYmd,
      sourceUrl: AICM_DEFAULT_FLIGHTS_URL,
      resolutionSource: AICM_DEFAULT_FLIGHTS_URL,
      resolutionCriteria: criteria,
      tags: {
        categoryTags: ['infraestructura', 'mexico'],
        geoTags: ['mexico'],
        topicTags: ['aeropuertos'],
      },
    },
  }];
}
