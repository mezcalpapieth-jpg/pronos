/**
 * Banxico SIE API reader.
 *
 * Reads economic time series (FX rate, interest rates, inflation) from
 * Banxico's public REST endpoint. Free but requires a token — register
 * at https://www.banxico.org.mx/SieAPIRest/service/v1/token and drop
 * the value in BANXICO_API_TOKEN.
 *
 * Used by:
 *   - market-gen/fx.js         → pick a strike for the weekly USD/MXN
 *                                over/under market
 *   - cron/points-auto-resolve → settle api_price markets with
 *                                source='banxico-fix' by re-reading
 *                                the FIX rate at close time
 *
 * The "oportuno" endpoint returns the single most-recent data point,
 * which is what we want for both strike-picking and resolution.
 */

const BASE = 'https://www.banxico.org.mx/SieAPIRest/service/v1';

// Well-known series we use. Each is fetched via latest ('oportuno')
// and returns a single { fecha, dato } pair.
//   SF43718  Tipo de Cambio FIX — canonical USD/MXN reference used by
//            every market commentator + most bank settlements
export const SERIES = {
  FX_USD_MXN: 'SF43718',
};

/**
 * Read the latest value from a Banxico SIE series.
 * Returns a JS number. Throws if the token isn't set or the response
 * is empty / malformed (caller decides whether to swallow or bubble).
 */
export async function readBanxicoLatest(seriesId) {
  const token = process.env.BANXICO_API_TOKEN;
  if (!token) throw new Error('banxico: BANXICO_API_TOKEN not set');
  if (!seriesId) throw new Error('banxico: seriesId required');

  const url = `${BASE}/series/${encodeURIComponent(seriesId)}/datos/oportuno?mediaType=json`;
  const res = await fetch(url, {
    headers: { 'Bmx-Token': token, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`banxico: HTTP ${res.status}`);
  const data = await res.json();
  const point = data?.bmx?.series?.[0]?.datos?.[0];
  const raw = point?.dato;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`banxico: empty value for ${seriesId} (got "${raw}")`);
  }
  return {
    value,
    fecha: point.fecha,  // "dd/mm/yyyy"
    title: data?.bmx?.series?.[0]?.titulo || seriesId,
  };
}
