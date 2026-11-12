export const FESTIVAL_SOURCE = 'trading-festival-2026';
export const FESTIVAL_SHAPE = 'festival-direction';
export const FESTIVAL_DASHBOARD_PATH = '/tradingfestival';
export const FESTIVAL_SIGNUP_URL = 'https://pronos.io/points/c/tradingfestival?signup=1';
export const FESTIVAL_TIME_ZONE = 'America/Mexico_City';
export const FESTIVAL_MINUTE = 60_000;
export const FESTIVAL_CHART_LEAD_MS = 12 * FESTIVAL_MINUTE;
export const FESTIVAL_CHART_SETTLEMENT_MS = 60 * FESTIVAL_MINUTE;

// The schedule uses Mexico City wall-clock times (UTC−06).
export const FESTIVAL_SCHEDULE = [
  {
    key: 'btc', name: 'Bitcoin', symbol: 'BTC/USD', currency: 'USD', decimals: 2,
    category: 'crypto', provider: 'Coinbase', ticker: 'BTC-USD',
    startTime: '2026-11-12T19:55:00.000Z', endTime: '2026-11-12T20:25:00.000Z',
  },
  {
    key: 'usdmxn', name: 'Dólar / peso', symbol: 'USD/MXN', currency: 'MXN', decimals: 5,
    category: 'finanzas', provider: 'Vunelix', ticker: 'FX:USDMXN', presentationTicker: 'FX:USDMXN',
    startTime: '2026-11-12T22:35:00.000Z', endTime: '2026-11-12T23:05:00.000Z',
  },
  {
    key: 'btc-fri', name: 'Bitcoin', symbol: 'BTC/USD', currency: 'USD', decimals: 2,
    category: 'crypto', provider: 'Coinbase', ticker: 'BTC-USD',
    startTime: '2026-11-13T19:15:00.000Z', endTime: '2026-11-13T19:45:00.000Z',
  },
  {
    key: 'spx', name: 'S&P 500', symbol: 'SPX', currency: null, decimals: 2,
    category: 'finanzas', provider: 'Vunelix', ticker: 'SP:SPX', presentationTicker: 'SP:SPX',
    startTime: '2026-11-13T20:15:00.000Z', endTime: '2026-11-13T20:45:00.000Z',
  },
  {
    key: 'ndx', name: 'Nasdaq-100', symbol: 'NDX', currency: null, decimals: 2,
    category: 'finanzas', provider: 'Vunelix', ticker: 'NASDAQ:NDX', presentationTicker: 'NASDAQ:NDX',
    startTime: '2026-11-13T22:05:00.000Z', endTime: '2026-11-13T22:35:00.000Z',
    replay: { startTime: '2026-11-13T20:29:00.000Z', endTime: '2026-11-13T20:59:00.000Z' },
  },
];

export function isFestivalBitcoin(slot) {
  return slot.provider === 'Coinbase' && slot.ticker === 'BTC-USD';
}

export function isFestivalChartMarket(slot) {
  return slot.provider === 'Vunelix' && !slot.replay;
}

export function isFestivalDashboard(location) {
  return location.pathname.replace(/\/$/, '') === FESTIVAL_DASHBOARD_PATH;
}
