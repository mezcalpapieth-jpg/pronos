/**
 * Open-Meteo weather reader.
 *
 * Keyless REST API. Used by:
 *   - market-gen/weather.js   → fetch forecast high for end-of-window
 *   - points-auto-resolve.js  → fetch recorded high for the forecast
 *                               date and pick the winning bucket
 *
 * API: https://open-meteo.com/en/docs
 */

const BASE = 'https://api.open-meteo.com/v1/forecast';

// Ensemble of models we query in parallel. Open-Meteo's default
// `best_match` often under-forecasts Mexican afternoons by 2-4°C
// vs. what the user sees on their phone; pulling the other majors
// and taking the MAX across them gets us closer to the realistic
// high a trader would anchor on.
const MODELS = ['best_match', 'gfs_seamless', 'ecmwf_ifs025', 'icon_seamless'];

/**
 * Fetch daily max temperature (°C) for `date` (YYYY-MM-DD) at a given
 * lat/lng.
 *
 * Returns the HIGHEST daily max predicted by any available model —
 * meant for market-generation where we want buckets that cover the
 * realistic high, not the timid median forecast. Auto-resolver uses
 * the same fetch and takes the same max, so the value that centers
 * the buckets is the same one used to settle.
 *
 * Throws on network / empty response across all models.
 */
export async function fetchMaxTempC({ lat, lng, dateYmd, timezone = 'America/Mexico_City' }) {
  const url = `${BASE}`
    + `?latitude=${encodeURIComponent(lat)}`
    + `&longitude=${encodeURIComponent(lng)}`
    + `&daily=temperature_2m_max`
    + `&timezone=${encodeURIComponent(timezone)}`
    + `&start_date=${encodeURIComponent(dateYmd)}`
    + `&end_date=${encodeURIComponent(dateYmd)}`
    + `&models=${encodeURIComponent(MODELS.join(','))}`;

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`);
  const data = await res.json();

  // When multiple models are requested, Open-Meteo returns keys like
  // `temperature_2m_max_best_match`, `temperature_2m_max_gfs_seamless`,
  // etc. Collect every value available for the requested date and
  // take the MAX. Some models may be missing data for a specific
  // location; we ignore those and require at least one to succeed.
  const daily = data?.daily || {};
  const values = [];
  for (const m of MODELS) {
    const arr = daily[`temperature_2m_max_${m}`];
    if (Array.isArray(arr) && Number.isFinite(arr[0])) values.push(Number(arr[0]));
  }
  // Default-model fallback (single-model response shape).
  if (values.length === 0 && Array.isArray(daily.temperature_2m_max)) {
    const v = daily.temperature_2m_max[0];
    if (Number.isFinite(v)) values.push(Number(v));
  }
  if (values.length === 0) {
    throw new Error(`open-meteo: missing temp for ${dateYmd}`);
  }
  const max = Math.max(...values);
  console.log('[weather] fetchMaxTempC', {
    dateYmd, lat, lng,
    modelValues: values,
    chosenMax: max,
  });
  return max;
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

export function weatherResolutionCriteriaForBuckets(buckets = []) {
  const labels = buckets.map(b => String(b?.label || '').trim()).filter(Boolean);
  if (labels.length === 4) {
    const base = Number(buckets[1]?.minC);
    const next = Number(buckets[2]?.minC);
    const hot = Number(buckets[3]?.minC);
    if (Number.isFinite(base) && Number.isFinite(next) && Number.isFinite(hot)) {
      return `Se resuelve con la temperatura máxima diaria de Open-Meteo para la fecha y ciudad del mercado. ${labels[0]} gana con cualquier valor menor a ${base.toFixed(2)}°C; ${labels[1]} gana desde ${base.toFixed(2)}°C hasta ${(base + 0.99).toFixed(2)}°C; ${labels[2]} gana desde ${next.toFixed(2)}°C hasta ${(next + 0.99).toFixed(2)}°C; ${labels[3]} gana con ${hot.toFixed(2)}°C o más.`;
    }
  }
  return WEATHER_MAX_TEMP_RESOLUTION_CRITERIA;
}
