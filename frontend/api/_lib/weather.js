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
// Each bucket is a half-open range on °C: [minC, maxC). The last bucket
// has maxC = null to cover the "and above" tail. Picked so mild / warm /
// hot days each land in a different bucket across typical MX highs.
export const BUCKETS = [
  { label: '≤ 20°C',    minC: -50, maxC: 20.0001 },
  { label: '21–26°C',   minC: 20.0001, maxC: 26.0001 },
  { label: '27–32°C',   minC: 26.0001, maxC: 32.0001 },
  { label: '≥ 33°C',    minC: 32.0001, maxC: 999 },
];

/**
 * Which bucket does a given temperature fall into?
 * Returns the index in BUCKETS, or -1 if nothing matches (shouldn't
 * happen given the tail bucket's ceiling).
 */
export function bucketIndexFor(tempC) {
  for (let i = 0; i < BUCKETS.length; i++) {
    const b = BUCKETS[i];
    if (tempC >= b.minC && tempC < b.maxC) return i;
  }
  return -1;
}
