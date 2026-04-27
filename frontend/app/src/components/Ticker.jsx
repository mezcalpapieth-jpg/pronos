import React from 'react';

// Pronos / MVP ticker. Items are duplicated once so the CSS-driven
// horizontal scroll can loop seamlessly without a visible reset.
// Re-branded from the Privy/USDC/Polygon era to the Turnkey/MXNB/
// Arbitrum stack the MVP actually runs on now.
const ITEMS = [
  { label: 'POWERED BY', val: 'PRONOS' },
  { label: 'MERCADOS ACTIVOS', val: '60+', green: true },
  { label: 'COLATERAL', val: 'MXNB · Bitso' },
  { label: 'PRÓXIMO DESTACADO', val: 'México vs Sudáfrica · 11 Jun 2026' },
  { label: 'RED', val: 'ARBITRUM · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · TURNKEY · FIRMA DELEGADA' },
  { label: 'COMISIÓN', val: '≤2.5%' },
];
const TICKER_ITEMS = [...ITEMS, ...ITEMS];

export default function Ticker() {
  return (
    <div id="ticker">
      <div className="ticker-badge">
        <span className="dot-live" />
        <span>EN VIVO</span>
      </div>
      <div className="ticker-track-wrapper">
        <div className="ticker-track">
          {TICKER_ITEMS.map((item, i) => (
            <div className="ticker-item" key={i}>
              <span className="label">{item.label}</span>
              <span className="sep" />
              <span className={item.green ? 'val' : ''}>{item.val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
