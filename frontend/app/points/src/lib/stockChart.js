// Candle timestamps are interval starts from Hyperliquid. Never interpolate a
// price between candles: the readout must describe a real returned sample.
export function nearestStockCandle(candles, time) {
  if (!candles.length || !Number.isFinite(time)) return -1;
  let low = 0;
  let high = candles.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (candles[middle].t < time) low = middle + 1;
    else high = middle;
  }
  return low > 0 && time - candles[low - 1].t <= candles[low].t - time ? low - 1 : low;
}

export function candleTimeLabel(time, lang = 'es') {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX', {
    timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(time)) + ' UTC';
}

export function priceTimeLabel(time, lang = 'es') {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-MX', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(time)) + ' UTC';
}
