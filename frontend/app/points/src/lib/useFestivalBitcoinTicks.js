import { useEffect, useState } from 'react';
import { FESTIVAL_CHART_LEAD_MS } from '../../../../shared/trading-festival.js';
import { preloadCryptoTicker, readCryptoTickerSnapshot } from './useCryptoTicker.js';

const EMPTY = { history: [], status: 'connecting' };
const REFRESH_MS = 250;
const sessions = new Map();

function captureTicks(capture) {
  const now = Date.now();
  const { history, status } = readCryptoTickerSnapshot(capture.productId);
  const from = Math.min(now, capture.start) - FESTIVAL_CHART_LEAD_MS;
  let firstNew = history.length;
  while (firstNew > 0 && history[firstNew - 1].t > capture.lastSeen && history[firstNew - 1].t >= from) firstNew--;

  for (const tick of history.slice(firstNew)) {
    if (tick.t >= capture.end) break;
    const second = Math.floor(tick.t / 1000) * 1000;
    const bucket = capture.seconds.get(second);
    if (!bucket) {
      capture.seconds.set(second, { first: tick, low: tick, high: tick, last: tick });
      continue;
    }
    if (tick.price < bucket.low.price) bucket.low = tick;
    if (tick.price > bucket.high.price) bucket.high = tick;
    bucket.last = tick;
  }
  const lastSeen = history.at(-1)?.t ?? capture.lastSeen;
  if (capture.lastSeen !== lastSeen || capture.snapshot.status !== status) {
    capture.lastSeen = lastSeen;
    for (const second of capture.seconds.keys()) {
      if (second + 1000 > from) break;
      capture.seconds.delete(second);
    }
    // Preserve the real high and low as well as the first and last tick in each
    // second so a busy 30-minute market stays renderable without flattening moves.
    const points = Array.from(capture.seconds.values(), ({ first, low, high, last }) => (
      [...new Set([first, low, high, last])].sort((left, right) => left.t - right.t)
    )).flat();
    capture.snapshot = { history: points, status };
    for (const notify of capture.subscribers) notify(capture.snapshot);
  }
  if (now >= capture.end) {
    clearInterval(capture.timer);
    capture.timer = null;
  }
}

export function useFestivalBitcoinTicks(productId, start, end) {
  const key = productId ? `${productId}:${start}:${end}` : null;
  const [value, setValue] = useState({ key: null, snapshot: EMPTY });

  useEffect(() => {
    if (!key) return undefined;
    let capture = sessions.get(key);
    if (!capture) {
      capture = {
        productId, start, end, seconds: new Map(), lastSeen: -Infinity,
        snapshot: EMPTY, timer: null, subscribers: new Set(),
      };
      sessions.set(key, capture);
    }
    const notify = snapshot => setValue({ key, snapshot });
    capture.subscribers.add(notify);
    if (!capture.timer && Date.now() < end) {
      preloadCryptoTicker(productId);
      capture.timer = setInterval(() => captureTicks(capture), REFRESH_MS);
      captureTicks(capture);
    }
    notify(capture.snapshot);
    // Keep capturing while this tab is on another festival chart.
    return () => capture.subscribers.delete(notify);
  }, [key, productId, start, end]);

  return value.key === key ? value.snapshot : EMPTY;
}
