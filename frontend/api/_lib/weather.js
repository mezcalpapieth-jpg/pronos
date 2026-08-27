/**
 * Open-Meteo weather reader.
 *
 * Keyless REST API. Used by:
 *   - market-gen/weather.js   -> fetch best_match forecast high for buckets
 *   - points-auto-resolve.js  -> fetch archive hourly high for the forecast
 *                                date and pick the winning bucket
 *
 * API: https://open-meteo.com/en/docs
 */

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';
const DEFAULT_TIMEZONE = 'America/Mexico_City';
export const WEATHER_MODEL_AUDIT_THRESHOLD_C = 1.5;

// Forecast models we keep for market generation/auditing. New markets anchor
// buckets on best_match, then audit the archive result against this set before
// paying automatically.
export const WEATHER_FORECAST_MODELS = ['best_match', 'gfs_seamless', 'ecmwf_ifs025', 'icon_seamless'];

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return url.toString();
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function weatherDeferredError(message, info = {}) {
  const err = new Error(message);
  err.benign = true;
  err.info = info;
  return err;
}

function forecastModelValuesFromDaily(daily = {}) {
  const valuesByModel = {};
  for (const model of WEATHER_FORECAST_MODELS) {
    const value = finiteNumber(daily?.[`temperature_2m_max_${model}`]?.[0]);
    if (value != null) valuesByModel[model] = value;
  }
  const fallback = finiteNumber(daily?.temperature_2m_max?.[0]);
  if (fallback != null && valuesByModel.best_match == null) {
    valuesByModel.best_match = fallback;
  }
  return valuesByModel;
}

export async function fetchForecastModelMaxTempsC({
  lat,
  lng,
  dateYmd,
  timezone = DEFAULT_TIMEZONE,
} = {}) {
  const url = buildUrl(FORECAST_BASE, {
    latitude: lat,
    longitude: lng,
    daily: 'temperature_2m_max',
    timezone,
    start_date: dateYmd,
    end_date: dateYmd,
    models: WEATHER_FORECAST_MODELS,
  });

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`);
  const data = await res.json();

  const valuesByModel = forecastModelValuesFromDaily(data?.daily || {});
  const values = Object.values(valuesByModel).filter(Number.isFinite);
  if (values.length === 0) {
    throw new Error(`open-meteo: missing temp for ${dateYmd}`);
  }

  const maxC = Math.max(...values);
  const bestMatchC = Number.isFinite(valuesByModel.best_match)
    ? valuesByModel.best_match
    : maxC;

  console.log('[weather] fetchForecastModelMaxTempsC', {
    dateYmd,
    lat,
    lng,
    bestMatchC,
    maxC,
    modelValues: valuesByModel,
  });

  return {
    source: 'open-meteo-forecast',
    dateYmd,
    lat,
    lng,
    timezone,
    valuesByModel,
    bestMatchC,
    maxC,
  };
}

/**
 * Fetch daily max temperature (°C) for `date` (YYYY-MM-DD) at a given
 * lat/lng.
 *
 * Legacy behavior: returns the HIGHEST daily max predicted by any
 * available forecast model. Keep this for already-created markets whose
 * resolution criteria promised the four-model max behavior.
 *
 * Throws on network / empty response across all models.
 */
export async function fetchMaxTempC(opts) {
  const forecast = await fetchForecastModelMaxTempsC(opts);
  return forecast.maxC;
}

export async function fetchBestMatchForecastMaxTempC(opts) {
  const forecast = await fetchForecastModelMaxTempsC(opts);
  return forecast.bestMatchC;
}

export function localDateYmdForTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function isWeatherArchiveDateComplete({
  dateYmd,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
} = {}) {
  if (!dateYmd) return false;
  return String(dateYmd) < localDateYmdForTimezone(now, timezone);
}

export async function fetchObservedMaxTempC({
  lat,
  lng,
  dateYmd,
  timezone = DEFAULT_TIMEZONE,
  now = new Date(),
} = {}) {
  if (!isWeatherArchiveDateComplete({ dateYmd, timezone, now })) {
    throw weatherDeferredError('weather_archive_waiting_for_day_close', {
      source: 'open-meteo-archive',
      forecastDateYmd: dateYmd,
      timezone,
      localDateYmd: localDateYmdForTimezone(now, timezone),
    });
  }

  const url = buildUrl(ARCHIVE_BASE, {
    latitude: lat,
    longitude: lng,
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max',
    timezone,
    start_date: dateYmd,
    end_date: dateYmd,
    models: 'best_match',
  });

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`open-meteo-archive: HTTP ${res.status}`);
  const data = await res.json();

  const times = Array.isArray(data?.hourly?.time) ? data.hourly.time : [];
  const temps = Array.isArray(data?.hourly?.temperature_2m) ? data.hourly.temperature_2m : [];
  const hourly = times
    .map((time, index) => ({ time, tempC: finiteNumber(temps[index]) }))
    .filter(row => row.time && row.tempC != null);

  if (hourly.length < 24) {
    throw weatherDeferredError('weather_archive_hourly_incomplete', {
      source: 'open-meteo-archive',
      forecastDateYmd: dateYmd,
      timezone,
      hourlyCount: hourly.length,
    });
  }

  const hourlyMaxC = Math.max(...hourly.map(row => row.tempC));
  const dailyMaxC = finiteNumber(data?.daily?.temperature_2m_max?.[0]);
  const maxC = dailyMaxC != null ? dailyMaxC : hourlyMaxC;
  const peakHours = hourly
    .filter(row => Math.abs(row.tempC - maxC) < 0.0001)
    .map(row => row.time);

  console.log('[weather] fetchObservedMaxTempC', {
    dateYmd,
    lat,
    lng,
    timezone,
    dailyMaxC,
    hourlyMaxC,
    peakHours,
  });

  return {
    source: 'open-meteo-archive',
    dateYmd,
    lat,
    lng,
    timezone,
    maxC,
    dailyMaxC,
    hourlyMaxC,
    peakHours,
    hourly,
  };
}

export function buildWeatherModelAudit({
  observedMaxC,
  forecastAudit,
  buckets = [],
  mismatchThresholdC = WEATHER_MODEL_AUDIT_THRESHOLD_C,
} = {}) {
  const observedBucketIndex = weatherBucketIndexFor(observedMaxC, buckets);
  const valuesByModel = forecastAudit?.valuesByModel || {};
  const bestMatchC = finiteNumber(valuesByModel.best_match);
  const comparisons = WEATHER_FORECAST_MODELS
    .map((model) => {
      const maxC = finiteNumber(valuesByModel[model]);
      if (maxC == null) return null;
      return {
        model,
        maxC,
        bucketIndex: weatherBucketIndexFor(maxC, buckets),
        diffFromObservedC: Number(Math.abs(maxC - observedMaxC).toFixed(2)),
        diffFromBestMatchC: bestMatchC == null
          ? null
          : Number(Math.abs(maxC - bestMatchC).toFixed(2)),
      };
    })
    .filter(Boolean);
  const modelValues = comparisons.map(row => row.maxC);
  const modelSpreadC = modelValues.length > 1
    ? Number((Math.max(...modelValues) - Math.min(...modelValues)).toFixed(2))
    : 0;
  const mismatchedBucketModels = comparisons
    .filter(row => row.bucketIndex >= 0 && row.bucketIndex !== observedBucketIndex)
    .map(row => row.model);
  const bigMismatch = comparisons.some(row =>
    row.diffFromObservedC >= mismatchThresholdC
    || (row.diffFromBestMatchC != null && row.diffFromBestMatchC >= mismatchThresholdC),
  );
  const requiresManualReview = observedBucketIndex >= 0
    && mismatchedBucketModels.length > 0
    && bigMismatch;

  return {
    observedBucketIndex,
    bestMatchC,
    bestMatchBucketIndex: bestMatchC == null ? null : weatherBucketIndexFor(bestMatchC, buckets),
    modelSpreadC,
    mismatchThresholdC,
    comparisons,
    mismatchedBucketModels,
    requiresManualReview,
  };
}

export async function resolveObservedWeatherMaxTempC({
  lat,
  lng,
  dateYmd,
  timezone = DEFAULT_TIMEZONE,
  buckets = [],
  mismatchThresholdC = WEATHER_MODEL_AUDIT_THRESHOLD_C,
  now = new Date(),
} = {}) {
  const observed = await fetchObservedMaxTempC({ lat, lng, dateYmd, timezone, now });
  const winningIdx = weatherBucketIndexFor(observed.maxC, buckets);
  if (winningIdx < 0) {
    throw new Error(`temp ${observed.maxC}°C didn't fit any bucket`);
  }

  let forecastAudit = null;
  let auditError = null;
  try {
    forecastAudit = await fetchForecastModelMaxTempsC({ lat, lng, dateYmd, timezone });
  } catch (e) {
    auditError = e?.message || 'forecast_audit_failed';
  }

  const audit = forecastAudit
    ? buildWeatherModelAudit({
        observedMaxC: observed.maxC,
        forecastAudit,
        buckets,
        mismatchThresholdC,
      })
    : {
        observedBucketIndex: winningIdx,
        requiresManualReview: false,
        auditError,
      };

  return {
    tempC: observed.maxC,
    winningIdx,
    requiresManualReview: Boolean(audit.requiresManualReview),
    finalScore: `${Number(observed.maxC).toFixed(1)}°C máx`,
    resolverInfo: {
      recordedMaxC: observed.maxC,
      observedMaxC: observed.maxC,
      source: observed.source,
      forecastDateYmd: dateYmd,
      timezone,
      dailyMaxC: observed.dailyMaxC,
      hourlyMaxC: observed.hourlyMaxC,
      peakHours: observed.peakHours,
      hourlyTemperatures: observed.hourly,
      weatherAudit: audit,
    },
    resolverConfigPatch: {
      resolutionSource: 'open-meteo-archive',
      forecastAuditModels: forecastAudit?.valuesByModel || null,
      weatherAudit: audit,
    },
  };
}

// ─── Cities ─────────────────────────────────────────────────────────────────
// Kept small on purpose — each city = one parallel market with 4 legs per
// day. Expanding the list multiplies the queue fast.
export const CITIES = [
  { key: 'cdmx', label: 'CDMX',        lat: 19.4326, lng: -99.1332, tz: 'America/Mexico_City' },
  { key: 'mty',  label: 'Monterrey',   lat: 25.6866, lng: -100.3161, tz: 'America/Monterrey' },
  { key: 'gdl',  label: 'Guadalajara', lat: 20.6597, lng: -103.3496, tz: 'America/Mexico_City' },
];

export const WEATHER_MAX_TEMP_RESOLUTION_CRITERIA =
  'Se resuelve con la temperatura máxima diaria de Open-Meteo para la fecha y ciudad del mercado. Los grados no se redondean: una opción como 25°C gana desde 25.00°C hasta 25.99°C; <25°C gana con cualquier valor menor a 25.00°C; ≥27°C gana con 27.00°C o más.';

export const WEATHER_ACTUAL_MAX_TEMP_RESOLUTION_CRITERIA =
  'Se resuelve con la temperatura máxima horaria registrada por Open-Meteo Archive en best_match para la fecha y ciudad del mercado. Los grados no se redondean: una opción como 25°C gana desde 25.00°C hasta 25.99°C; <25°C gana con cualquier valor menor a 25.00°C; ≥27°C gana con 27.00°C o más. El mercado cierra antes del cierre del día para evitar operar cuando el resultado ya es evidente. Si la auditoría de modelos cambia la opción ganadora o muestra una diferencia grande, pasa a revisión manual.';

// ─── Bucket scheme ──────────────────────────────────────────────────────────
// Each bucket is a half-open range on °C: [minC, maxC). Markets use
// adaptive buckets built at generation time from the forecast — see
// adaptiveBuckets() below. BUCKETS + bucketIndexFor are kept for
// legacy rows (before adaptive buckets were the default) so the
// auto-resolver can still settle them if needed.
export const BUCKETS = [
  { label: '≤ 20°C',    minC: -50, maxC: 20.0001 },
  { label: '21–26°C',   minC: 20.0001, maxC: 26.0001 },
  { label: '27–32°C',   minC: 26.0001, maxC: 32.0001 },
  { label: '≥ 33°C',    minC: 32.0001, maxC: 999 },
];

export function weatherBucketIndexFor(tempC, buckets = BUCKETS) {
  const value = Number(tempC);
  if (!Number.isFinite(value)) return -1;
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i] || {};
    const minC = Number(b.minC);
    const maxC = Number(b.maxC);
    if (!Number.isFinite(minC) || !Number.isFinite(maxC)) continue;
    if (value >= minC && value < maxC) return i;
  }
  return -1;
}

export function bucketIndexFor(tempC) {
  return weatherBucketIndexFor(tempC, BUCKETS);
}

/**
 * Build four adaptive one-degree buckets anchored on the forecast high.
 * Given a forecast F (floored to the whole degree it sits in), the buckets are:
 *
 *   < F°C            — cool tail
 *   F°C              — [F.00, F.99]
 *   F+1°C            — [F+1.00, F+1.99]
 *   ≥ F+2°C          — hot tail
 *
 * Example: forecast 25.6°C → F=25, so buckets are <25°C / 25°C /
 * 26°C / ≥27°C. Actual 25.6°C resolves to 25°C; 26.9°C resolves
 * to 26°C; 27.0°C resolves to ≥27°C.
 *
 * minC is inclusive, maxC is exclusive — the auto-resolver uses
 * `temp >= b.minC && temp < b.maxC` to pick the winning bucket.
 */
export function adaptiveBuckets(forecastC) {
  const numeric = Number(forecastC);
  const F = Number.isFinite(numeric) ? Math.floor(numeric) : 0;
  return [
    { label: `< ${F}°C`,       minC: -999,  maxC: F },
    { label: `${F}°C`,         minC: F,     maxC: F + 1 },
    { label: `${F + 1}°C`,     minC: F + 1, maxC: F + 2 },
    { label: `≥ ${F + 2}°C`,   minC: F + 2, maxC: 999 },
  ];
}

export function weatherResolutionCriteriaForBuckets(buckets = [], { resolutionSource = null } = {}) {
  const labels = buckets.map(b => String(b?.label || '').trim()).filter(Boolean);
  const usesArchive = resolutionSource === 'open-meteo-archive';
  if (labels.length === 4) {
    const base = Number(buckets[1]?.minC);
    const next = Number(buckets[2]?.minC);
    const hot = Number(buckets[3]?.minC);
    if (Number.isFinite(base) && Number.isFinite(next) && Number.isFinite(hot)) {
      const intro = usesArchive
        ? 'Se resuelve con la temperatura máxima horaria registrada por Open-Meteo Archive en best_match para la fecha y ciudad del mercado.'
        : 'Se resuelve con la temperatura máxima diaria de Open-Meteo para la fecha y ciudad del mercado.';
      const review = usesArchive
        ? ' El mercado cierra antes del cierre del día para evitar operar cuando el resultado ya es evidente. Si la auditoría de modelos cambia la opción ganadora o muestra una diferencia grande, pasa a revisión manual.'
        : '';
      return `${intro} ${labels[0]} gana con cualquier valor menor a ${base.toFixed(2)}°C; ${labels[1]} gana desde ${base.toFixed(2)}°C hasta ${(base + 0.99).toFixed(2)}°C; ${labels[2]} gana desde ${next.toFixed(2)}°C hasta ${(next + 0.99).toFixed(2)}°C; ${labels[3]} gana con ${hot.toFixed(2)}°C o más.${review}`;
    }
  }
  return usesArchive
    ? WEATHER_ACTUAL_MAX_TEMP_RESOLUTION_CRITERIA
    : WEATHER_MAX_TEMP_RESOLUTION_CRITERIA;
}
