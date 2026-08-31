/**
 * Frankfurter FX reader.
 *
 * Frankfurter exposes free current and historical exchange-rate data at
 * api.frankfurter.dev with no API key. We use it for non-USD peso pairs
 * that Banxico FIX does not cover, like EUR/MXN, JPY/MXN, CHF/MXN.
 */

const FRANKFURTER_API_BASE_URL = 'https://api.frankfurter.dev/v2';

export const FRANKFURTER_SOURCE = 'frankfurter';
export const FRANKFURTER_RESOLUTION_CRITERIA =
  'Se resuelve con el tipo de cambio diario publicado por Frankfurter para el par indicado en el día de cierre del mercado. Movimientos intradía no cuentan: si el valor diario publicado no cumple el umbral, gana el otro lado.';

const MEXICO_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function cleanCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`frankfurter: invalid currency ${value}`);
  }
  return code;
}

function mexicoDateYmdFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    MEXICO_DATE_FORMAT
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return parts.year && parts.month && parts.day
    ? `${parts.year}-${parts.month}-${parts.day}`
    : null;
}

export function frankfurterTargetDateYmd({ resolverConfig = {}, sourceData = {}, endTime = null } = {}) {
  const cfg = resolverConfig || {};
  const data = sourceData || {};
  return cfg.resolveDateYmd
    || cfg.dateYmd
    || data.resolveDateYmd
    || data.endYmd
    || mexicoDateYmdFromIso(endTime);
}

export async function readFrankfurterRate({ base, quote = 'MXN', dateYmd = null } = {}) {
  const baseCode = cleanCurrencyCode(base);
  const quoteCode = cleanCurrencyCode(quote);
  const url = new URL(`${FRANKFURTER_API_BASE_URL}/rate/${baseCode}/${quoteCode}`);
  if (dateYmd) url.searchParams.set('date', String(dateYmd));

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`frankfurter: HTTP ${res.status}`);

  const data = await res.json();
  const value = Number(data?.rate);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`frankfurter: empty rate for ${baseCode}/${quoteCode}`);
  }

  return {
    value,
    date: data?.date || null,
    base: data?.base || baseCode,
    quote: data?.quote || quoteCode,
    title: `${baseCode}/${quoteCode}`,
  };
}
