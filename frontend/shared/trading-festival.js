export const FESTIVAL_SOURCE = 'trading-festival-2026';
export const FESTIVAL_SHAPE = 'festival-direction';
export const FESTIVAL_DASHBOARD_PATH = '/tradingfestival';
export const FESTIVAL_SIGNUP_URL = 'https://pronos.io/points/c/tradingfestival?signup=1';
export const FESTIVAL_TIME_ZONE = 'America/Mexico_City';
export const FESTIVAL_MINUTE = 60_000;

// These are the event's confirmed wall-clock times in Mexico City (UTC−06).
export const FESTIVAL_SCHEDULE = [
  {
    key: 'btc', name: 'Bitcoin', symbol: 'BTC/USD', currency: 'USD', decimals: 2,
    category: 'crypto', provider: 'Coinbase', ticker: 'BTC-USD',
    startTime: '2026-11-12T19:55:00.000Z', endTime: '2026-11-12T20:25:00.000Z',
  },
  {
    key: 'usdmxn', name: 'Dólar / peso', symbol: 'USD/MXN', currency: 'MXN', decimals: 5,
    category: 'finanzas', provider: 'Massive', ticker: 'C:USDMXN',
    startTime: '2026-11-12T22:35:00.000Z', endTime: '2026-11-12T23:05:00.000Z',
  },
  {
    key: 'ndx', name: 'Nasdaq-100', symbol: 'NDX', currency: null, decimals: 2,
    category: 'finanzas', provider: 'Massive', ticker: 'I:NDX',
    startTime: '2026-11-13T22:05:00.000Z', endTime: '2026-11-13T22:35:00.000Z',
    requiresReschedule: true,
  },
];

export function isFestivalDashboard(location) {
  return location.pathname.replace(/\/$/, '') === FESTIVAL_DASHBOARD_PATH;
}
