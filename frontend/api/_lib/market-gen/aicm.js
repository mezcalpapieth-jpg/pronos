import {
  AICM_SOURCE,
} from '../aicm-board.js';
import {
  AICM_AE_DEFAULT_THRESHOLD_MIN,
  buildAicmAeDelayBucketsForDays,
  countAicmAeDaysInclusive,
} from '../aicm-aviation-edge.js';
import { AICM_TT_SOURCE } from '../aicm-timetable.js';
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

export const AICM_DAILY_THRESHOLD_MIN = AICM_AE_DEFAULT_THRESHOLD_MIN;
export const AICM_DAILY_TIMETABLE_URL = 'https://aviation-edge.com/v2/public/timetable';

function ymdParts(ymd) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  return { year, month, day };
}

function targetLocalDate(now, daysAhead = 1) {
  return new Date(now.getTime() + Number(daysAhead || 0) * 86_400_000);
}

function shiftDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 86_400_000);
}

export function aicmDelayResolutionCriteria({
  airport = AICM_AIRPORT,
  directionLabel = 'salidas',
  fromDateYmd,
  toDateYmd = fromDateYmd,
  thresholdMinutes = AICM_DAILY_THRESHOLD_MIN,
  resolveAfterLocal = '04:00 del día siguiente',
} = {}) {
  const sameDay = fromDateYmd && fromDateYmd === toDateYmd;
  const windowText = sameDay
    ? `programadas el ${fromDateYmd}`
    : `del ${fromDateYmd} al ${toDateYmd}`;
  return [
    `Cuenta vuelos comerciales de ${directionLabel} del ${airport.label} ${windowText}`,
    `que hayan salido con más de ${thresholdMinutes} minutos de retraso, según el campo de retraso publicado por Aviation Edge.`,
    'Se cuenta una sola vez cada vuelo operado: los códigos compartidos no suman.',
    'Los vuelos cancelados no cuentan como demorados.',
    `El conteo se toma del timetable en vivo de Aviation Edge, muestreado durante toda la ventana, y no se considera final hasta las ${resolveAfterLocal}, para que los últimos vuelos acumulen su demora real.`,
    'Si el muestreo no cubre el día completo, el mercado queda para revisión manual.',
  ].join(' ');
}

export async function generateAicmMarkets({
  now = new Date(),
  daysAhead = 1,
  thresholdMinutes = AICM_DAILY_THRESHOLD_MIN,
  seedLiquidity = 1000,
} = {}) {
  const target = targetLocalDate(now, daysAhead);
  const targetYmd = formatMexicoDateYmd(target);
  const targetEs = formatMexicoDateEs(target);
  const end = dateAtMexicoCityTime({ ...ymdParts(targetYmd), hour: 23, minute: 59, second: 59 });
  const resolveAfterYmd = formatMexicoDateYmd(shiftDays(new Date(`${targetYmd}T12:00:00Z`), 1));
  const resolveAfter = dateAtMexicoCityTime({
    ...ymdParts(resolveAfterYmd), hour: 4, minute: 0, second: 0,
  });
  const dayCount = countAicmAeDaysInclusive(targetYmd, targetYmd);
  const buckets = buildAicmAeDelayBucketsForDays(dayCount).map(bucket => ({ ...bucket }));
  const criteria = aicmDelayResolutionCriteria({
    fromDateYmd: targetYmd,
    toDateYmd: targetYmd,
    thresholdMinutes,
  });

  return [{
    // Keep the original source identity so reruns update existing pending daily
    // AICM rows in place. The actual resolver source is stored below.
    source: AICM_SOURCE,
    source_event_id: `aicm:${AICM_AIRPORT.code}:departure:day:${targetYmd}`,
    question: `¿Cuántas salidas del AICM se retrasarán más de ${thresholdMinutes} minutos el ${targetEs}?`,
    category: 'infraestructura',
    icon: '✈️',
    outcomes: buckets.map(bucket => bucket.label),
    seed_liquidity: seedLiquidity,
    end_time: end.toISOString(),
    amm_mode: 'parallel',
    resolver_type: 'aicm_delay_minutes_live',
    resolver_config: {
      source: AICM_TT_SOURCE,
      shape: 'delay-bucket',
      airportKey: AICM_AIRPORT.key,
      airportCode: AICM_AIRPORT.code,
      airportIcao: AICM_AIRPORT.icao,
      airportLabel: AICM_AIRPORT.label,
      timezone: AICM_AIRPORT.timezone,
      direction: 'departure',
      window: 'day',
      fromDateYmd: targetYmd,
      toDateYmd: targetYmd,
      thresholdMinutes,
      resolveAfterUtc: resolveAfter.toISOString(),
      minOperatorFlights: 250,
      minOkPolls: 6,
      buckets,
      criteria,
      evidenceUrl: AICM_DAILY_TIMETABLE_URL,
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
      thresholdMinutes,
      sourceUrl: AICM_DAILY_TIMETABLE_URL,
      resolutionSource: 'Aviation Edge — timetable en vivo (MEX, salidas)',
      resolvesAt: resolveAfter.toISOString(),
      resolutionCriteria: criteria,
      tags: {
        categoryTags: ['infraestructura', 'mexico'],
        geoTags: ['mexico'],
        topicTags: ['aeropuertos'],
      },
    },
  }];
}
