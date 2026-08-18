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

export const BANXICO_FIX_RESOLUTION_CRITERIA =
  'Se resuelve con el valor final publicado por Banxico para la serie SF43718 (Tipo de Cambio FIX) del día de cierre del mercado. Movimientos intradía no cuentan: si durante el día toca el umbral pero el valor final de Banxico no cumple el criterio, gana el otro lado.';

function pad(n) {
  return String(n).padStart(2, '0');
}

export function banxicoFechaToYmd(fecha) {
  const match = String(fecha || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${pad(match[2])}-${pad(match[1])}`;
}

export function mexicoDateYmdFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function banxicoFixTargetDateYmd({ resolverConfig = {}, sourceData = {}, endTime = null } = {}) {
  const cfg = resolverConfig || {};
  const data = sourceData || {};
  return cfg.resolveDateYmd
    || cfg.dateYmd
    || data.resolveDateYmd
    || data.endYmd
    || mexicoDateYmdFromIso(endTime);
}

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
