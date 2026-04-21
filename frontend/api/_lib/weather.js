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

export function bucketIndexFor(tempC) {
  for (let i = 0; i < BUCKETS.length; i++) {
    const b = BUCKETS[i];
    if (tempC >= b.minC && tempC < b.maxC) return i;
  }
  return -1;
}

/**
 * Build four adaptive buckets centered on the forecast high. Given
 * a forecast F (rounded to an integer), the buckets are:
 *
 *   ≤ F-4°C          — cool tail (open-ended low)
 *   F-3 to F-2°C     — one step below forecast
 *   F-1 to F°C       — forecast window (this is where F lands)
 *   ≥ F+1°C          — hot tail (open-ended high)
 *
 * Example: F=31 (today's Guadalajara max) → buckets are ≤27°C /
 * 28–29°C / 30–31°C / ≥32°C. The top bucket sits one degree above
 * the forecast, not wider — any surprise heat (F+2, F+5, …) still
 * lands in the top bucket thanks to the open-ended tail.
 *
 * minC is inclusive, maxC is exclusive — the auto-resolver uses
 * `temp >= b.minC && temp < b.maxC` to pick the winning bucket.
 */
export function adaptiveBuckets(forecastC) {
  const F = Math.round(Number(forecastC) || 0);
  return [
    { label: `≤ ${F - 4}°C`,           minC: -999,   maxC: F - 3 },
    { label: `${F - 3}–${F - 2}°C`,    minC: F - 3,  maxC: F - 1 },
    { label: `${F - 1}–${F}°C`,        minC: F - 1,  maxC: F + 1 },
    { label: `≥ ${F + 1}°C`,           minC: F + 1,  maxC: 999 },
  ];
}
