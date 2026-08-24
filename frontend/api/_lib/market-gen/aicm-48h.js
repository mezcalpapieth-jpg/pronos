import {
  AICM_AE_DEFAULT_THRESHOLD_MIN,
  buildAicmAeDelayBucketsForDays,
  countAicmAeDaysInclusive,
} from '../aicm-aviation-edge.js';
import { AICM_TT_SOURCE } from '../aicm-timetable.js';
import { AICM_AIRPORT } from './aicm.js';
import {
  dateAtMexicoCityTime,
  formatMexicoDateEs,
  formatMexicoDateYmd,
} from './mexico-time.js';

/**
 * Thursday+Friday 48-hour AICM departure-delay market.
 *
 * Counts departures delayed more than 30 minutes across two full local days,
 * read from Aviation Edge (see aicm-aviation-edge.js for why the airport's own
 * board cannot back this).
 *
 * The counted window deliberately starts the day *after* the market opens. A
 * market that counted the current day would let anyone query the feed for
 * delays that already happened and trade on a settled result.
 */

export const AICM_48H_THRESHOLD_MIN = AICM_AE_DEFAULT_THRESHOLD_MIN;

function ymdParts(ymd) {
  const [year, month, day] = String(ymd || '').split('-').map(Number);
  return { year, month, day };
}

function shiftDays(date, days) {
  return new Date(date.getTime() + Number(days || 0) * 86_400_000);
}

/** Next Thursday strictly after `now`; if today is Thursday, the one a week out. */
function nextThursday(now) {
  const todayYmd = formatMexicoDateYmd(now);
  for (let i = 1; i <= 7; i += 1) {
    const candidate = shiftDays(now, i);
    const ymd = formatMexicoDateYmd(candidate);
    if (ymd === todayYmd) continue;
    const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (dow === 4) return ymd;
  }
  return null;
}

export function aicm48hResolutionCriteria({
  airport = AICM_AIRPORT,
  fromDateYmd,
  toDateYmd,
  thresholdMinutes = AICM_48H_THRESHOLD_MIN,
} = {}) {
  return [
    `Cuenta las salidas comerciales del ${airport.label} programadas entre el ${fromDateYmd} 00:00 y el ${toDateYmd} 23:59:59 (hora de la Ciudad de México)`,
    `que hayan salido con más de ${thresholdMinutes} minutos de retraso, según el campo de retraso publicado por Aviation Edge.`,
    'Se cuenta una sola vez cada vuelo operado: los códigos compartidos no suman.',
    'Los vuelos cancelados no cuentan como demorados.',
    'El conteo se toma del tablero en vivo de Aviation Edge, muestreado durante toda la ventana, y se cierra el sábado a las 04:00 (hora de la Ciudad de México), cuando ya salió hasta el último vuelo programado del viernes.',
    'Si el muestreo no cubre los dos días completos, el mercado pasa a revisión manual.',
  ].join(' ');
}

export async function generateAicm48hMarkets({
  now = new Date(),
  fromDateYmd = null,
  thresholdMinutes = AICM_48H_THRESHOLD_MIN,
  seedLiquidity = 1000,
} = {}) {
  const thursdayYmd = fromDateYmd || nextThursday(now);
  if (!thursdayYmd) return [];

  const fridayYmd = formatMexicoDateYmd(
    shiftDays(new Date(`${thursdayYmd}T12:00:00Z`), 1),
  );

  // Trading closes when the counted window closes: Friday 23:59:59 local.
  const end = dateAtMexicoCityTime({
    ...ymdParts(fridayYmd), hour: 23, minute: 59, second: 59,
  });
  if (end.getTime() <= now.getTime()) return [];

  // Saturday 04:00 local: late Friday departures have all gone by then.
  const resolveAfter = dateAtMexicoCityTime({
    ...ymdParts(formatMexicoDateYmd(shiftDays(new Date(`${fridayYmd}T12:00:00Z`), 1))),
    hour: 4, minute: 0, second: 0,
  });

  const dayCount = countAicmAeDaysInclusive(thursdayYmd, fridayYmd);
  const buckets = buildAicmAeDelayBucketsForDays(dayCount).map(bucket => ({ ...bucket }));
  const criteria = aicm48hResolutionCriteria({
    fromDateYmd: thursdayYmd, toDateYmd: fridayYmd, thresholdMinutes,
  });
  const thursdayEs = formatMexicoDateEs(new Date(`${thursdayYmd}T12:00:00Z`));
  const fridayEs = formatMexicoDateEs(new Date(`${fridayYmd}T12:00:00Z`));

  return [{
    source: AICM_TT_SOURCE,
    source_event_id: `aicm:${AICM_AIRPORT.code}:departure:48h:${thursdayYmd}`,
    question: `¿Cuántas salidas del AICM se retrasarán más de ${thresholdMinutes} minutos el ${thursdayEs} y ${fridayEs}?`,
    category: 'infraestructura',
    icon: '✈️',
    outcomes: buckets.map(bucket => bucket.label),
    seed_liquidity: seedLiquidity,
    end_time: end.toISOString(),
    // First market resolved from the live timetable rather than the archive:
    // the method has not been reconciled against flightsHistory yet, and
    // traders should see that before committing points.
    is_test_market: true,
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
      window: '48h',
      fromDateYmd: thursdayYmd,
      toDateYmd: fridayYmd,
      thresholdMinutes,
      // Friday's last departures keep slipping past midnight — a 23:59 flight
      // at the 99th percentile of delay leaves around 03:39 — so the count is
      // only final at 04:00 Saturday local.
      resolveAfterUtc: resolveAfter.toISOString(),
      // Two full days must be covered or the window is incomplete. The floor of
      // 600 operator flights sits well under the ~857 a real jue+vie carries,
      // so it catches a thin poll log without tripping on a quiet week.
      minOperatorFlights: 600,
      minOkPolls: 12,
      buckets,
      criteria,
      evidenceUrl: 'https://aviation-edge.com/v2/public/timetable',
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
      window: '48h',
      fromDateYmd: thursdayYmd,
      toDateYmd: fridayYmd,
      thresholdMinutes,
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
