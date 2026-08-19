/**
 * Aviation Edge departure-delay reader for AICM markets.
 *
 * The airport's own board (see aicm-board.js) flags DEMORADO on roughly 0.8%
 * of departures while the real late rate is ~99%, so it cannot back a market.
 * Aviation Edge publishes a per-flight `delay` in minutes and is used instead.
 *
 * Two endpoints, two roles:
 *   - flightsHistory: authoritative, but only for dates at least 3 days old.
 *   - timetable:      live, current day only, used for a provisional count.
 *
 * Only flightsHistory resolves markets. The timetable count is advisory until
 * the two have been reconciled against each other over real windows.
 */

export const AICM_AE_SOURCE = 'aviation-edge-flights-history';
export const AICM_AE_BASE_URL = 'https://aviation-edge.com/v2/public';

// flightsHistory refuses any date newer than this many days.
export const AICM_AE_HISTORY_LAG_DAYS = 3;

export const AICM_AE_DEFAULT_THRESHOLD_MIN = 30;

/**
 * Delay-count buckets for a Thursday+Friday (48 h) window, derived from the
 * quartiles of 13 real jue+vie windows: mean 284, range 248-336.
 */
export const AICM_AE_48H_DELAY_BUCKETS = [
  { label: '0-263', minCount: 0, maxCount: 263 },
  { label: '264-280', minCount: 264, maxCount: 280 },
  { label: '281-305', minCount: 281, maxCount: 305 },
  { label: '306+', minCount: 306, maxCount: null },
];

function toInt(value) {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function shiftYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function countAicmAeDaysInclusive(fromDateYmd, toDateYmd) {
  if (!fromDateYmd || !toDateYmd) return 0;
  const [fy, fm, fd] = String(fromDateYmd).split('-').map(Number);
  const [ty, tm, td] = String(toDateYmd).split('-').map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.round((to - from) / 86_400_000) + 1;
}

export function aicmAeMaxAvailableYmd(now = new Date()) {
  const dt = new Date(now.getTime());
  dt.setUTCDate(dt.getUTCDate() - AICM_AE_HISTORY_LAG_DAYS);
  return dt.toISOString().slice(0, 10);
}

export function aicmAeHistoryReady({ toDateYmd, now = new Date() } = {}) {
  if (!toDateYmd) return false;
  return toDateYmd <= aicmAeMaxAvailableYmd(now);
}

export function buildAicmAeHistoryUrl({
  fromDateYmd,
  toDateYmd,
  apiKey,
  airportCode = 'MEX',
  direction = 'departure',
  baseUrl = AICM_AE_BASE_URL,
} = {}) {
  if (!fromDateYmd || !toDateYmd) throw new Error('aicm_ae_requires_date_range');
  if (!apiKey) throw new Error('aicm_ae_requires_api_key');
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/flightsHistory`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('code', airportCode);
  url.searchParams.set('type', direction);
  // The date filter is applied on UTC while scheduledTime comes back in airport
  // local time, so the edge days arrive truncated. Widening the request by a
  // day on each side and filtering locally is what makes the window complete.
  url.searchParams.set('date_from', shiftYmd(fromDateYmd, -1));
  url.searchParams.set('date_to', shiftYmd(toDateYmd, 1));
  return url.toString();
}

/**
 * Reduce a raw flightsHistory payload to the market's count.
 *
 * `delay` is read straight from the feed rather than computed from
 * actualTime - scheduledTime: heavily delayed flights carry no actualTime at
 * all (0 of 65 flights past 60 min had one in the sample), so computing it
 * silently drops exactly the flights the market is about.
 */
export function summarizeAicmAeDelays(payload, {
  fromDateYmd,
  toDateYmd,
  thresholdMinutes = AICM_AE_DEFAULT_THRESHOLD_MIN,
} = {}) {
  const rows = Array.isArray(payload) ? payload : [];
  const perDay = new Map();
  let totalRows = 0;
  let operatorFlights = 0;
  let cancelled = 0;
  let withoutDelay = 0;
  let count = 0;

  for (const row of rows) {
    totalRows += 1;
    // Every codeshare repeats a flight already listed under its operator;
    // two thirds of the feed is these duplicates.
    if (row?.codeshared) continue;
    const departure = row?.departure || {};
    const scheduled = departure.scheduledTime;
    if (typeof scheduled !== 'string' || scheduled.length < 10) continue;
    const dayYmd = scheduled.slice(0, 10);
    if (fromDateYmd && dayYmd < fromDateYmd) continue;
    if (toDateYmd && dayYmd > toDateYmd) continue;

    operatorFlights += 1;
    if (!perDay.has(dayYmd)) perDay.set(dayYmd, { flights: 0, late: 0 });
    const bucket = perDay.get(dayYmd);
    bucket.flights += 1;

    if (String(row?.status || '').toLowerCase() === 'cancelled') {
      cancelled += 1;
      continue;
    }
    const delay = toInt(departure.delay);
    if (delay == null) {
      // No delay field means the feed saw no delay for that flight.
      withoutDelay += 1;
      continue;
    }
    if (delay > thresholdMinutes) {
      count += 1;
      bucket.late += 1;
    }
  }

  return {
    source: AICM_AE_SOURCE,
    fromDateYmd: fromDateYmd || null,
    toDateYmd: toDateYmd || null,
    thresholdMinutes,
    count,
    totalRows,
    operatorFlights,
    cancelled,
    withoutDelay,
    daysCovered: [...perDay.keys()].sort(),
    perDay: [...perDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dateYmd, v]) => ({ dateYmd, flights: v.flights, late: v.late })),
  };
}

export function aicmAeBucketIndexFor(count, buckets = AICM_AE_48H_DELAY_BUCKETS) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0 || !Array.isArray(buckets)) return -1;
  return buckets.findIndex((bucket) => {
    const min = Number(bucket?.minCount ?? bucket?.min ?? 0);
    const rawMax = bucket?.maxCount ?? bucket?.max ?? null;
    const max = rawMax == null ? null : Number(rawMax);
    if (!Number.isFinite(min)) return false;
    if (max != null && !Number.isFinite(max)) return false;
    return n >= min && (max == null || n <= max);
  });
}

export async function readAicmAeDelayCount({
  fromDateYmd,
  toDateYmd,
  thresholdMinutes = AICM_AE_DEFAULT_THRESHOLD_MIN,
  apiKey = process.env.AVIATION_EDGE_KEY,
  airportCode = 'MEX',
  direction = 'departure',
  baseUrl = AICM_AE_BASE_URL,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  if (!aicmAeHistoryReady({ toDateYmd, now })) {
    const err = new Error('aicm_ae_history_not_ready');
    err.benign = true;
    err.info = {
      source: AICM_AE_SOURCE,
      toDateYmd,
      maxAvailableYmd: aicmAeMaxAvailableYmd(now),
      lagDays: AICM_AE_HISTORY_LAG_DAYS,
    };
    throw err;
  }

  const url = buildAicmAeHistoryUrl({
    fromDateYmd, toDateYmd, apiKey, airportCode, direction, baseUrl,
  });
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(`aicm_ae_http_${response?.status || 'error'}`);
  }
  const payload = await response.json();
  if (payload && !Array.isArray(payload) && payload.error) {
    throw new Error(`aicm_ae_api_error: ${String(payload.error).slice(0, 160)}`);
  }

  return summarizeAicmAeDelays(payload, { fromDateYmd, toDateYmd, thresholdMinutes });
}
