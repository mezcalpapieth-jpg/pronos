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

// Placement lanes across the plot area. Kept left of ~62% so a label never
// runs off the right edge or collides with the current-price readout. One
// lane per simultaneously-visible flare, so a full screen still can't put two
// labels in the same column.
const LANES = MAX_VISIBLE;
const LANE_LEFT = 8;
const LANE_WIDTH = 7.5;

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
  // Next lane to place a label in. Purely random placement let two labels
  // land on the same spot and render as one unreadable smear ("+$1,197"
  // stacked on "+$1"), so they now cycle through fixed columns instead.
  const laneRef = useRef(0);

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
        // Lanes, not scatter. MAX_VISIBLE labels share the width, each one
        // takes the next lane, and a small jitter inside the lane keeps the
        // result from looking like a grid. Consecutive orders can no longer
        // collide, which is what produced overlapping amounts before.
        const lane = laneRef.current % LANES;
        laneRef.current += 1;

        fresh.push({
          id: (idRef.current += 1),
          side: trade.side,
          size: trade.size,
          left: LANE_LEFT + lane * LANE_WIDTH + Math.random() * (LANE_WIDTH * 0.35),
          // The vertical band is deliberately narrow: this overlay spans the
          // whole chart card, and anything lower than ~40% lands on top of
          // the ACTIVIDAD / VOLUMEN tiles underneath the plot. Staggering by
          // lane keeps neighbours on different rows as they drift up.
          bottom: 42 + (lane % 3) * 8 + Math.random() * 5,
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
            // NOT --green: in this palette that token is the brand orange
            // (#FF5500), which rendered buys and sells in near-identical
            // warm tones. --success is the real green, the one the SÍ
            // button and the price line use.
            color: flare.side === 'buy' ? 'var(--success, #00C96B)' : 'var(--red, #FF4545)',
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
