/**
 * Aviation Edge live timetable reader for same-weekend AICM resolution.
 *
 * `flightsHistory` is authoritative but publishes each date three days late,
 * which pushes a Friday-close market to Monday. The `timetable` endpoint
 * carries the current day with the same per-flight `delay` field, so polling
 * it through the window and storing what it says lets the market resolve the
 * following morning instead.
 *
 * The trade-off is real and unmeasured: the two endpoints have never been
 * reconciled against each other, because the archive's lag means their
 * coverage never overlaps. Markets resolved from this source should be
 * re-checked against flightsHistory once the window publishes.
 */

export const AICM_TT_SOURCE = 'aviation-edge-timetable';
export const AICM_TT_BASE_URL = 'https://aviation-edge.com/v2/public';

function toInt(value) {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

export function buildAicmTimetableUrl({
  apiKey,
  airportCode = 'MEX',
  direction = 'departure',
  baseUrl = AICM_TT_BASE_URL,
} = {}) {
  if (!apiKey) throw new Error('aicm_tt_requires_api_key');
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/timetable`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('iataCode', airportCode);
  url.searchParams.set('type', direction);
  return url.toString();
}

/**
 * Reduce one timetable payload to per-flight observations.
 *
 * Codeshares repeat a flight already listed under its operator, so only rows
 * without `codeshared` are kept — the same rule the history reader uses.
 * Identity is the operator's own flight number plus its scheduled slot, which
 * stays stable as the delay grows across polls.
 */
export function parseAicmTimetable(payload, { observedAt = new Date().toISOString() } = {}) {
  const rows = Array.isArray(payload) ? payload : [];
  const observations = [];
  let totalRows = 0;
  let codeshares = 0;

  for (const row of rows) {
    totalRows += 1;
    if (row?.codeshared) { codeshares += 1; continue; }
    const departure = row?.departure || {};
    const scheduled = departure.scheduledTime;
    if (typeof scheduled !== 'string' || scheduled.length < 10) continue;
    const flightNumber = row?.flight?.iataNumber || row?.flight?.number;
    if (!flightNumber) continue;

    const flightDate = scheduled.slice(0, 10);
    observations.push({
      flightKey: `${flightDate}|${String(flightNumber).toLowerCase()}|${scheduled}`,
      flightDate,
      flightNumber: String(flightNumber).toLowerCase(),
      airlineIata: (row?.airline?.iataCode || '').toLowerCase() || null,
      arrivalIata: (row?.arrival?.iataCode || '').toLowerCase() || null,
      scheduledLocal: scheduled,
      actualLocal: departure.actualTime || null,
      delayMinutes: toInt(departure.delay),
      status: String(row?.status || 'unknown').toLowerCase(),
      observedAt,
    });
  }

  return { source: AICM_TT_SOURCE, observedAt, totalRows, codeshares, observations };
}

export async function fetchAicmTimetable({
  apiKey = process.env.AVIATION_EDGE_KEY,
  airportCode = 'MEX',
  direction = 'departure',
  baseUrl = AICM_TT_BASE_URL,
  fetchImpl = fetch,
  observedAt = new Date().toISOString(),
} = {}) {
  const url = buildAicmTimetableUrl({ apiKey, airportCode, direction, baseUrl });
  const response = await fetchImpl(url);
  if (!response?.ok) throw new Error(`aicm_tt_http_${response?.status || 'error'}`);
  const payload = await response.json();
  if (payload && !Array.isArray(payload) && payload.error) {
    throw new Error(`aicm_tt_api_error: ${String(payload.error).slice(0, 160)}`);
  }
  return parseAicmTimetable(payload, { observedAt });
}

/**
 * Store one poll's observations.
 *
 * A flight's delay grows while it sits on the ground, so a later poll must
 * overwrite an earlier one. The row keeps the newest reading and the earliest
 * time we ever saw the flight.
 */
export async function persistAicmTimetableObservations(sql, {
  observations = [],
  direction = 'departure',
} = {}) {
  if (!sql) throw new Error('aicm_tt_requires_sql');
  let written = 0;
  for (const o of observations) {
    await sql.query(`
      INSERT INTO points_aicm_timetable_observations (
        source, flight_key, direction, flight_date, flight_number, airline_iata,
        arrival_iata, scheduled_local, actual_local, delay_minutes, status,
        first_observed_at, last_observed_at
      ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      ON CONFLICT (flight_key) DO UPDATE SET
        actual_local     = COALESCE(EXCLUDED.actual_local, points_aicm_timetable_observations.actual_local),
        delay_minutes    = COALESCE(EXCLUDED.delay_minutes, points_aicm_timetable_observations.delay_minutes),
        status           = EXCLUDED.status,
        last_observed_at = EXCLUDED.last_observed_at
    `, [
      AICM_TT_SOURCE, o.flightKey, direction, o.flightDate, o.flightNumber,
      o.airlineIata, o.arrivalIata, o.scheduledLocal, o.actualLocal,
      o.delayMinutes, o.status, o.observedAt,
    ]);
    written += 1;
  }
  return { written };
}

export async function recordAicmTimetableRun(sql, {
  direction = 'departure',
  status,
  observedAt,
  totalRows = 0,
  operatorRows = 0,
  error = null,
} = {}) {
  if (!sql) return null;
  const rows = await sql.query(`
    INSERT INTO points_aicm_timetable_runs (
      source, direction, status, observed_at, total_rows, operator_rows, error
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id
  `, [AICM_TT_SOURCE, direction, status, observedAt, totalRows, operatorRows, error]);
  return rows?.rows?.[0]?.id ?? rows?.[0]?.id ?? null;
}

/**
 * Count stored flights in a window whose final observed delay passed the
 * threshold. Cancelled flights never departed, so they do not count.
 */
export async function readAicmTimetableDelayCount(sql, {
  fromDateYmd,
  toDateYmd,
  thresholdMinutes = 30,
  direction = 'departure',
} = {}) {
  if (!sql) throw new Error('aicm_tt_requires_sql');
  if (!fromDateYmd || !toDateYmd) throw new Error('aicm_tt_requires_date_range');

  const result = await sql.query(`
    WITH runs AS (
      SELECT
        COUNT(*)::int AS poll_count,
        COUNT(*) FILTER (WHERE status = 'ok')::int AS ok_poll_count,
        MAX(observed_at) AS last_poll_observed_at
      FROM points_aicm_timetable_runs
      WHERE direction = $4
        AND observed_at >= $1::date
        AND observed_at < ($2::date + INTERVAL '2 days')
    ),
    obs AS (
      SELECT
        COUNT(*)::int AS operator_flights,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (
          WHERE status <> 'cancelled' AND delay_minutes > $3
        )::int AS count,
        COUNT(DISTINCT flight_date)::int AS days_covered
      FROM points_aicm_timetable_observations
      WHERE direction = $4
        AND flight_date >= $1::date
        AND flight_date <= $2::date
    )
    SELECT o.count, o.operator_flights, o.cancelled, o.days_covered,
           r.poll_count, r.ok_poll_count, r.last_poll_observed_at
    FROM obs o CROSS JOIN runs r
  `, [fromDateYmd, toDateYmd, thresholdMinutes, direction]);

  const row = (result?.rows ?? result ?? [])[0] || {};
  return {
    source: AICM_TT_SOURCE,
    fromDateYmd,
    toDateYmd,
    thresholdMinutes,
    count: Number(row.count || 0),
    operatorFlights: Number(row.operator_flights || 0),
    cancelled: Number(row.cancelled || 0),
    daysCovered: Number(row.days_covered || 0),
    pollCount: Number(row.poll_count || 0),
    okPollCount: Number(row.ok_poll_count || 0),
    lastPollObservedAt: row.last_poll_observed_at || null,
  };
}
