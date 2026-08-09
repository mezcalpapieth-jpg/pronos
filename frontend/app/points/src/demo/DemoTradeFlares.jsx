/**
 * Floating "+$120 / −$75" labels over the price chart.
 *
 * Polymarket-style order-flow annotations: each simulated trade surfaces for
 * a couple of seconds, drifts upward and fades. This is what lets the page
 * show a big total volume AND small human-sized amounts at the same time —
 * the volume figures are aggregates, these are individual orders.
 *
 * Demo-only. The real Pronos chart has no equivalent, so nothing here is
 * reachable outside a /points/video session.
 */
import React, { useEffect, useRef, useState } from 'react';
import { getDemoState, setFocusedMarket, subscribeDemoState } from './demoStore.js';

const LIFETIME_MS = 2600;
const MAX_VISIBLE = 7;

const KEYFRAMES = `
@keyframes demo-flare {
  0%   { opacity: 0; transform: translateY(6px) scale(0.94); }
  14%  { opacity: 1; transform: translateY(0) scale(1); }
  70%  { opacity: 1; transform: translateY(-26px) scale(1); }
  100% { opacity: 0; transform: translateY(-46px) scale(0.98); }
}`;

export default function DemoTradeFlares({ marketId }) {
  const [flares, setFlares] = useState([]);
  // Trades already turned into flares. Without this, every store notification
  // (once a second) would re-spawn the entire buffer.
  const seenRef = useRef(new Set());
  const idRef = useRef(0);

  useEffect(() => {
    seenRef.current = new Set();
    setFlares([]);
    // Tell the flow simulator this is the market on camera.
    setFocusedMarket(marketId);
    return () => setFocusedMarket(null);
  }, [marketId]);

  useEffect(() => {
    const unsubscribe = subscribeDemoState(() => {
      const target = Number(marketId);
      const trades = getDemoState().recentTrades || [];
      const fresh = [];

      // Walk backwards — anything older than the tail is already on screen
      // or long gone.
      for (let i = trades.length - 1; i >= Math.max(0, trades.length - 30); i -= 1) {
        const trade = trades[i];
        if (trade.marketId !== target) continue;
        const key = `${trade.t}:${trade.size}:${trade.side}:${i}`;
        if (seenRef.current.has(key)) continue;
        seenRef.current.add(key);
        fresh.push({
          id: (idRef.current += 1),
          side: trade.side,
          size: trade.size,
          // Scattered so consecutive orders don't stack into one column.
          // The vertical band is deliberately narrow: this overlay spans the
          // whole chart card, and anything lower than ~40% lands on top of
          // the ACTIVIDAD / VOLUMEN tiles underneath the plot.
          left: 9 + Math.random() * 44,
          bottom: 41 + Math.random() * 25,
        });
      }

      if (fresh.length === 0) return;
      setFlares(prev => [...prev, ...fresh].slice(-MAX_VISIBLE));

      for (const flare of fresh) {
        window.setTimeout(() => {
          setFlares(prev => prev.filter(item => item.id !== flare.id));
        }, LIFETIME_MS);
      }

      // The seen-set would grow for the length of a shoot otherwise.
      if (seenRef.current.size > 400) seenRef.current = new Set();
    });
    return unsubscribe;
  }, [marketId]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 3 }}>
      <style>{KEYFRAMES}</style>
      {flares.map(flare => (
        <span
          key={flare.id}
          style={{
            position: 'absolute',
            left: `${flare.left}%`,
            bottom: `${flare.bottom}%`,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            color: flare.side === 'buy' ? 'var(--green, #22c55e)' : 'var(--red, #ef4444)',
            textShadow: '0 1px 6px rgba(0,0,0,0.85)',
            animation: `demo-flare ${LIFETIME_MS}ms ease-out forwards`,
          }}
        >
          {flare.side === 'buy' ? '+' : '−'}${flare.size.toLocaleString('es-MX')}
        </span>
      ))}
    </div>
  );
}
