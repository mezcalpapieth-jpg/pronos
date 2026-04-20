/**
 * Weather market generator (parallel binary per city).
 *
 * For each city in the whitelist we generate ONE parallel market per
 * day for tomorrow:
 *   Parent: "¿Temperatura máxima en {City} el {dd/mm/yyyy}?"
 *   Legs:   4 adaptive °C buckets centered on Open-Meteo's forecasted
 *           high — e.g. forecast 33°C → [≤29°C / 30–31°C / 32–33°C /
 *           ≥34°C]. Tighter spread means more balanced odds per leg
 *           than the old fixed 6°C bands.
 *
 * Why parallel (not unified): matches the Polymarket weather pattern
 * Fran screenshotted earlier — each bucket is its own Sí/No market so
 * users can bet on multiple outcomes independently with deeper
 * per-bucket liquidity.
 *
 * resolver_type='weather_api' on the parent. The points auto-resolve
 * cron reads Open-Meteo for the forecast date, picks the matching
 * bucket, and cascades to every leg (winning bucket → Sí, others → No).
 */
import { CITIES, adaptiveBuckets, fetchMaxTempC } from '../weather.js';

function formatDateYmd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function formatDateEs(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export async function generateWeatherMarkets() {
  const specs = [];
  // Forecast date = tomorrow (UTC). Give the market a full day of
  // trading before Open-Meteo's observed-high field lands.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const forecastDateYmd = formatDateYmd(tomorrow);
  const forecastDateEs  = formatDateEs(tomorrow);

  // Trading closes at 23:59 UTC of the forecast day (≈ evening local in
  // MX), when the day's measured high is locked in. Auto-resolver picks
  // up shortly after.
  const end = new Date(tomorrow);
  end.setUTCHours(23, 59, 0, 0);
  const endIso = end.toISOString();

  for (const city of CITIES) {
    // Fetch the forecast both to probe availability AND to feed the
    // adaptive bucket builder. Skip the city if Open-Meteo errors.
    let forecastHighC;
    try {
      forecastHighC = await fetchMaxTempC({
        lat: city.lat,
        lng: city.lng,
        dateYmd: forecastDateYmd,
        timezone: city.tz,
      });
    } catch (e) {
      console.error('[market-gen/weather] forecast probe failed', {
        city: city.key, message: e?.message,
      });
      continue;
    }

    const buckets = adaptiveBuckets(forecastHighC);

    specs.push({
      source: 'open-meteo',
      source_event_id: `weather:${city.key}:${forecastDateYmd}`,
      question: `¿Temperatura máxima en ${city.label} el ${forecastDateEs}?`,
      // Filed under 'mexico' so the tab on home surfaces these; the
      // 'general' category we used earlier doesn't map to any home
      // filter, so those markets only ever appeared under Trending.
      category: 'mexico',
      icon: '🌡️',
      outcomes: buckets.map(b => b.label),
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'parallel',       // one binary per bucket
      resolver_type: 'weather_api',
      resolver_config: {
        source: 'open-meteo',
        lat: city.lat,
        lng: city.lng,
        timezone: city.tz,
        forecastDateYmd,
        buckets: buckets.map(b => ({ label: b.label, minC: b.minC, maxC: b.maxC })),
        forecastAtGeneration: forecastHighC,
      },
      source_data: {
        cityKey: city.key,
        cityLabel: city.label,
        forecastDateYmd,
        forecastAtGeneration: forecastHighC,
        lat: city.lat,
        lng: city.lng,
      },
    });
  }

  return specs;
}
