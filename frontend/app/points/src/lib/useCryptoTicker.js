/**
 * useCryptoTicker — live-price hook for the 5-min crypto market UI.
 *
 * SHARED MODULE-LEVEL STORE: one WebSocket per productId is kept alive
 * for the lifetime of the tab, regardless of whether any component is
 * currently subscribed. History accumulates continuously so revisiting
 * a crypto market shows the full live chart from the first frame —
 * before, the chart would reset to "a few points" each time the user
 * navigated away and back. The Crypto5MinDetail page already prepends
 * Coinbase candle backfill on top of this; together they cover both
 * the "never visited yet" and "left + came back" cases.
 *
 * Public API (unchanged):
 *   const { currentPrice, history, status } = useCryptoTicker('BTC-USD');
 *
 * history = [{ t: 1714521600000, price: 98247.10 }, ...]
 * status  = 'connecting' | 'open' | 'closed' | 'error'
 *
 * The hook handles:
 *   - WebSocket open + subscribe (singleton per productId)
 *   - Reconnect with capped exponential backoff on disconnect
 *   - Sliding window pruning (keeps ~10 min of history per product)
 *   - SSR safety (no-op when window is undefined)
 *
 * Coinbase WS is for the LIVE TICKER UX only — the Chainlink Data
 * Feed remains the canonical source for SETTLEMENT (read by the cron
 * at boundaries).
 */

import { useEffect, useState } from 'react';

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
// Keep ~10 minutes per product. The chart only renders the [openedAt,
// closesAt] window (5 min) but a wider buffer means a user who's been
// away for a few minutes still sees a meaningful chart on revisit.
const HISTORY_WINDOW_MS = 10 * 60_000;
const MAX_HISTORY_POINTS = 1200;

const RECONNECT_BACKOFFS_MS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000];

// Per-productId singleton state. Lives for the lifetime of the tab.
// Components subscribe via useCryptoTicker; we never tear the WS down
// when subscribers go to zero — the cost (one connection, sub-1 KB/s)
// is negligible vs. losing the accumulated history.
const stores = new Map();

// Map productId → server-side asset key. Kept in sync with the
// `ALLOWED_ASSETS` set in /api/points/crypto-tick.
const ASSET_BY_PRODUCT = {
  'BTC-USD': 'btc',
  'ETH-USD': 'eth',
};

// One POST every 5s per asset is the ceiling the server enforces via
// its 5-second bucket dedup. Going faster just costs invocations
// without adding new history.
const PERSIST_INTERVAL_MS = 5_000;

function getStore(productId) {
  let st = stores.get(productId);
  if (st) return st;
  st = {
    productId,
    currentPrice: null,
    history: [],
    status: 'connecting',
    ws: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    subscribers: new Set(), // each entry: () => void notifier
    persistTimer: null,
    lastPersistMs: 0,
  };
  stores.set(productId, st);
  connect(st);
  startPersistLoop(st);
  return st;
}

// Periodically POSTs the latest WS price to /api/points/crypto-tick
// so the server-side history table fills as a side-effect of any
// crypto-page being open. Replaces the standalone Vercel cron worker
// that used to do this on a schedule — we save the per-minute compute
// cost and only spend it while users are actually present.
//
// Fire-and-forget: server applies plausibility + bucket dedup; client
// doesn't need to react to the response.
function startPersistLoop(st) {
  if (typeof window === 'undefined') return;
  if (st.persistTimer) return;
  const asset = ASSET_BY_PRODUCT[st.productId];
  if (!asset) return;
  st.persistTimer = setInterval(() => {
    const price = st.currentPrice;
    if (!Number.isFinite(price) || price <= 0) return;
    const now = Date.now();
    if (now - st.lastPersistMs < PERSIST_INTERVAL_MS - 250) return;
    st.lastPersistMs = now;
    fetch('/api/points/crypto-tick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset, price }),
      keepalive: true, // survive page-unload races
      credentials: 'omit',
    }).catch(() => { /* fire-and-forget */ });
  }, PERSIST_INTERVAL_MS);
}

function notify(st) {
  for (const cb of st.subscribers) {
    try { cb(); } catch { /* */ }
  }
}

function connect(st) {
  if (typeof window === 'undefined') return;
  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect(st);
    return;
  }
  st.ws = ws;
  st.status = 'connecting';
  notify(st);

  ws.onopen = () => {
    st.reconnectAttempts = 0;
    st.status = 'open';
    notify(st);
    try {
      ws.send(JSON.stringify({
        type: 'subscribe',
        product_ids: [st.productId],
        channels: ['ticker'],
      }));
    } catch { /* surface via onclose */ }
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg?.type !== 'ticker' || msg.product_id !== st.productId) return;
    const price = Number(msg.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const t = Date.now();
    st.currentPrice = price;
    // Append + prune. New array each tick so React change-detection
    // for useState picks it up.
    const next = st.history.concat({ t, price });
    const cutoff = t - HISTORY_WINDOW_MS;
    let i = 0;
    while (i < next.length && next[i].t < cutoff) i++;
    const trimmed = i > 0 ? next.slice(i) : next;
    st.history = trimmed.length > MAX_HISTORY_POINTS
      ? trimmed.slice(trimmed.length - MAX_HISTORY_POINTS)
      : trimmed;
    notify(st);
  };

  ws.onerror = () => {
    st.status = 'error';
    notify(st);
  };

  ws.onclose = () => {
    st.status = 'closed';
    notify(st);
    scheduleReconnect(st);
  };
}

function scheduleReconnect(st) {
  if (typeof window === 'undefined') return;
  const attempt = st.reconnectAttempts;
  const delay = RECONNECT_BACKOFFS_MS[Math.min(attempt, RECONNECT_BACKOFFS_MS.length - 1)];
  st.reconnectAttempts = attempt + 1;
  if (st.reconnectTimer) clearTimeout(st.reconnectTimer);
  st.reconnectTimer = setTimeout(() => connect(st), delay);
}

export function useCryptoTicker(productId) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || !productId) return undefined;
    const st = getStore(productId);
    // Trigger a render whenever the singleton updates (price tick,
    // status change, new history slice).
    const cb = () => forceRender(n => (n + 1) % 1_000_000);
    st.subscribers.add(cb);
    // Force an initial render so the hook returns the current snapshot
    // immediately if the store already has data from a previous mount.
    cb();
    return () => {
      st.subscribers.delete(cb);
      // Intentionally do NOT tear down the WS — keep accumulating history
      // for the next visit.
    };
  }, [productId]);

  if (!productId || typeof window === 'undefined') {
    return { currentPrice: null, history: [], status: 'connecting' };
  }
  const st = getStore(productId);
  return {
    currentPrice: st.currentPrice,
    history: st.history,
    status: st.status,
  };
}

// Pre-warm the store for a product before any component subscribes.
// Useful from app bootstrap if you want history to start accumulating
// the moment the page loads, not the first time the user clicks into a
// crypto market.
export function preloadCryptoTicker(productId) {
  if (typeof window === 'undefined' || !productId) return;
  getStore(productId);
}
