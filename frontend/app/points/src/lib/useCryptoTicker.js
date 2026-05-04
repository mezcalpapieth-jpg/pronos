/**
 * useCryptoTicker — live-price hook for the 5-min crypto market UI.
 *
 * Opens a WebSocket to Coinbase's public ticker feed
 * (wss://ws-feed.exchange.coinbase.com), subscribes to one product
 * (BTC-USD or ETH-USD), and keeps a sliding window of recent prices
 * for the chart. Each Coinbase trade pushes a ticker message — usually
 * 1-5 messages per second on liquid assets, so history fills quickly.
 *
 * The Chainlink Data Feed remains the canonical source for SETTLEMENT
 * (read by the cron at boundaries). Coinbase WS is for the LIVE TICKER
 * UX only — fast updates are nice-to-have here, not authoritative.
 *
 * Usage:
 *   const { currentPrice, history, status } = useCryptoTicker('BTC-USD');
 *   // history = [{ t: 1714521600000, price: 98247.10 }, ...]
 *   // status  = 'connecting' | 'open' | 'closed' | 'error'
 *
 * The hook handles:
 *   - WebSocket open + subscribe + close on prop change / unmount
 *   - Reconnect with capped exponential backoff on disconnect
 *   - Sliding window pruning (keeps at most ~5 min of history)
 *   - SSR safety (no-op when window is undefined)
 *   - Tab visibility: when the page is hidden, we don't accumulate
 *     unbounded history; when it returns we trim to the window.
 */

import { useEffect, useRef, useState } from 'react';

const WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const HISTORY_WINDOW_MS = 6 * 60_000; // keep ~6 min so chart has padding past the 5-min window
const MAX_HISTORY_POINTS = 600;       // hard upper bound regardless of timing

const RECONNECT_BACKOFFS_MS = [500, 1000, 2000, 4000, 8000, 15_000, 30_000];

export function useCryptoTicker(productId) {
  const [currentPrice, setCurrentPrice] = useState(null);
  const [history, setHistory] = useState([]);
  const [status, setStatus] = useState('connecting');

  // Refs so we don't tear down + re-establish on every state change.
  const wsRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !productId) return undefined;
    cancelledRef.current = false;

    function connect() {
      if (cancelledRef.current) return;
      let ws;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      setStatus('connecting');

      ws.onopen = () => {
        if (cancelledRef.current) { try { ws.close(); } catch { /* */ } return; }
        reconnectAttemptsRef.current = 0;
        setStatus('open');
        // Subscribe to the ticker channel for this product.
        try {
          ws.send(JSON.stringify({
            type: 'subscribe',
            product_ids: [productId],
            channels: ['ticker'],
          }));
        } catch { /* will surface as onclose */ }
      };

      ws.onmessage = (ev) => {
        if (cancelledRef.current) return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg?.type !== 'ticker' || msg.product_id !== productId) return;
        const price = Number(msg.price);
        if (!Number.isFinite(price) || price <= 0) return;
        const t = Date.now(); // use local clock; Coinbase's `time` would
                              // also work but local-clock keeps the chart
                              // smooth across small server-time jitter
        setCurrentPrice(price);
        setHistory(prev => {
          // Append + prune. Keep the last HISTORY_WINDOW_MS worth, with
          // a hard cap on point count to bound work in case of bursts.
          const next = [...prev, { t, price }];
          const cutoff = t - HISTORY_WINDOW_MS;
          let i = 0;
          while (i < next.length && next[i].t < cutoff) i++;
          const trimmed = i > 0 ? next.slice(i) : next;
          if (trimmed.length > MAX_HISTORY_POINTS) {
            return trimmed.slice(trimmed.length - MAX_HISTORY_POINTS);
          }
          return trimmed;
        });
      };

      ws.onerror = () => {
        if (cancelledRef.current) return;
        setStatus('error');
        // Don't call close() here — onclose fires next and handles the
        // reconnect path. Closing twice is benign but noisy in logs.
      };

      ws.onclose = () => {
        if (cancelledRef.current) return;
        setStatus('closed');
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (cancelledRef.current) return;
      const attempt = reconnectAttemptsRef.current;
      const delay = RECONNECT_BACKOFFS_MS[Math.min(attempt, RECONNECT_BACKOFFS_MS.length - 1)];
      reconnectAttemptsRef.current = attempt + 1;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelledRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'unsubscribe', channels: ['ticker'], product_ids: [productId] })); } catch { /* */ }
      }
      try { ws?.close(); } catch { /* */ }
      wsRef.current = null;
    };
  }, [productId]);

  return { currentPrice, history, status };
}
