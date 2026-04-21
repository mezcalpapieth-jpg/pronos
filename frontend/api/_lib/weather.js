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

/**
 * Fetch daily max temperature (°C) for `date` (YYYY-MM-DD) at a given
 * lat/lng. Returns a number. Throws on network / empty response.
 *
 * Open-Meteo can return either a forecast value (if the date is in the
 * future) or the recorded value (if today or past with historical API).
 * We use the forecast endpoint up to ~16 days out and the archive one
 * past that — but for our weekly cadence, forecast covers everything.
 */
export async function fetchMaxTempC({ lat, lng, dateYmd, timezone = 'America/Mexico_City' }) {
  const url = `${BASE}`
    + `?latitude=${encodeURIComponent(lat)}`
    + `&longitude=${encodeURIComponent(lng)}`
    + `&daily=temperature_2m_max`
    + `&timezone=${encodeURIComponent(timezone)}`
    + `&start_date=${encodeURIComponent(dateYmd)}`
    + `&end_date=${encodeURIComponent(dateYmd)}`;

  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`open-meteo: HTTP ${res.status}`);
  const data = await res.json();
  const temp = data?.daily?.temperature_2m_max?.[0];
  if (!Number.isFinite(temp)) {
    throw new Error(`open-meteo: missing temp for ${dateYmd}`);
  }
  return Number(temp);
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
 * Build four adaptive buckets centered around (and slightly biased
 * warmer than) the forecast high. Given a forecast F (rounded), the
 * buckets are:
 *
 *   ≤ F-3°C          — cool tail
 *   F-2 to F°C       — forecast zone (this is where F lands)
 *   F+1 to F+4°C     — warm zone (Mexican afternoons routinely land here)
 *   ≥ F+5°C          — heat-wave tail
 *
 * Example: F=27 → ≤24°C / 25–27°C / 28–31°C / ≥32°C. An actual high
 * of 31°C falls in the third bucket; a surprise 35°C still resolves
 * cleanly to the top bucket instead of landing outside the market.
 *
 * The older scheme (±1 around F) left too little room for upside
 * drift — when the morning forecast underpredicted by 3-4°C (common
 * in Mexico) the top bucket ended up below the actual high, which
 * confused users looking at a market whose "highest" bucket was
 * already baked in.
 *
 * minC is inclusive, maxC is exclusive — the auto-resolver uses
 * `temp >= b.minC && temp < b.maxC` to pick the winning bucket.
 */
export function adaptiveBuckets(forecastC) {
  const F = Math.round(Number(forecastC) || 0);
  return [
    { label: `≤ ${F - 3}°C`,           minC: -999,   maxC: F - 2 },
    { label: `${F - 2}–${F}°C`,        minC: F - 2,  maxC: F + 1 },
    { label: `${F + 1}–${F + 4}°C`,    minC: F + 1,  maxC: F + 5 },
    { label: `≥ ${F + 5}°C`,           minC: F + 5,  maxC: 999 },
  ];
}
