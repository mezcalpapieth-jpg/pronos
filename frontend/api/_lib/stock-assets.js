// This catalogue describes simulated exposure, not ownership of securities.
export const STOCK_ASSETS = Object.freeze([
  ['AAPL', 'Apple', 'tecnologia', '#f0f0f0', 'A'],
  ['NVDA', 'Nvidia', 'tecnologia', '#76b900', 'N'],
  ['TSLA', 'Tesla', 'tecnologia', '#e82127', 'T'],
  ['GOOGL', 'Alphabet', 'tecnologia', '#4285f4', 'G'],
  ['META', 'Meta', 'tecnologia', '#0866ff', '∞'],
  ['AMZN', 'Amazon', 'tecnologia', '#ff9900', 'a'],
  ['MSFT', 'Microsoft', 'tecnologia', '#00a4ef', 'M'],
  ['SP500', 'S&P 500', 'indices', '#ff5500', '500'],
  ['GOLD', 'Oro', 'materias-primas', '#d4af37', 'Au'],
].map(([ticker, name, category, color, monogram], order) => Object.freeze({
  ticker, coin: `xyz:${ticker}`, name, category, color, monogram, order,
})));

export function stockAsset(ticker) {
  const value = String(ticker || '').trim().toUpperCase();
  return STOCK_ASSETS.find(asset => asset.ticker === value || asset.coin.toUpperCase() === value) || null;
}

export const STOCK_CHART_RANGES = Object.freeze({
  '4H': { interval: '5m', durationMs: 4 * 3600000 },
  '24H': { interval: '15m', durationMs: 24 * 3600000 },
  '7D': { interval: '1h', durationMs: 7 * 86400000 },
  '30D': { interval: '4h', durationMs: 30 * 86400000 },
});
