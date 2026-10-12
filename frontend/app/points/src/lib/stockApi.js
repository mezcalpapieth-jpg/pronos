import { getJson, postJson, publicErrorMessage } from './pointsApi.js';

const env = import.meta.env || {};
export const stocksEnabled = env.VITE_POINTS_STOCKS_ENABLED === 'true'
  || (env.DEV && env.VITE_POINTS_STOCKS_ENABLED !== 'false');
const base = '/api/points/stocks';
const timeout = () => ({ signal: AbortSignal.timeout(12000) });
export const fetchStockAssets = ticker => getJson(`${base}/assets${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ''}`, timeout());
export const fetchStockCandles = (ticker, range) => getJson(`${base}/candles?ticker=${encodeURIComponent(ticker)}&range=${range}`, timeout());
export const fetchStockPortfolio = (cycle = 'current') => getJson(`${base}/positions?cycle=${cycle}`, timeout());
export const fetchStockHoldings = () => getJson(`${base}/positions?cycle=current&view=holdings`, timeout());
export const quoteStock = body => postJson(`${base}/quote`, body, timeout());
export const tradeStock = (side, body) => postJson(`${base}/${side}`, body, timeout());
const errors = {
  stock_preview_only: ['Este ETF está disponible como vista previa; aún no admite operaciones con puntos.', 'This ETF is a preview; points trading is not enabled yet.'],
  stocks_disabled: ['Acciones estará disponible pronto.', 'Stocks will be available soon.'],
  stock_trading_paused: ['Las operaciones de acciones están pausadas temporalmente.', 'Stock trading is temporarily paused.'],
  stock_price_unavailable: ['Precio no disponible. Intenta de nuevo en unos segundos.', 'Price unavailable. Try again in a few seconds.'],
  stock_fx_unavailable: ['Tipo de cambio no disponible. Intenta más tarde.', 'Exchange rate unavailable. Try later.'],
  stock_minimum_amount: ['La compra mínima es de 100 MXNP.', 'The minimum buy is 100 MXNP.'],
  stock_quote_expired: ['La cotización expiró. Solicita una nueva.', 'Quote expired. Request a new one.'],
  stock_cycle_closed: ['Las operaciones están pausadas o el ciclo está cerrado.', 'Trading is paused or the cycle is closed.'],
  stock_insufficient_liquidity: ['No hay suficiente liquidez para este monto. Prueba con menos.', 'Insufficient liquidity. Try a smaller amount.'],
  stock_order_too_small: ['El monto no alcanza para la fracción mínima del activo.', 'Amount is below the asset’s minimum fraction.'],
  insufficient_stock_quantity: ['No tienes suficientes unidades de este activo.', 'You do not hold enough units.'],
  stock_position_changed: ['Tu posición cambió. Solicita otra cotización.', 'Your position changed. Request a new quote.'],
  stock_quote_used: ['Esta cotización ya fue utilizada. Revisa tu portafolio.', 'This quote was already used. Check your portfolio.'],
  stock_not_found: ['Activo no disponible.', 'Asset unavailable.'],
};
export function stockErrorMessage(error, lang = 'es') {
  return errors[error?.code]?.[lang === 'en' ? 1 : 0] || publicErrorMessage(error, lang);
}

// Sum independent PnL samples by carrying the most recent observation. Wallet
// deposits and points rewards are excluded from both source series.
export function mergePnlSeries(a = [], b = [], days = 0, now = Date.now()) {
  const events = [...a.map(point => ({ ...point, source: 0 })), ...b.map(point => ({ ...point, source: 1 }))]
    .filter(point => Number.isFinite(Number(point.t)) && Number.isFinite(Number(point.v)))
    .sort((x, y) => Number(x.t) - Number(y.t));
  const values = [0, 0];
  const result = [];
  const cutoff = days ? now / 1000 - days * 86400 : -Infinity;
  for (const point of events) {
    values[point.source] = Number(point.v);
    if (Number(point.t) < cutoff) continue;
    const combined = { t: Number(point.t), v: values[0] + values[1] };
    if (result.at(-1)?.t === combined.t) result[result.length - 1] = combined;
    else result.push(combined);
  }
  return result;
}
