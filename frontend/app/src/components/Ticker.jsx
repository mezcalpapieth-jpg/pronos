import React from 'react';

const TICKER_ITEMS = [
  { label: 'POWERED BY', val: 'POLYMARKET' },
  { label: 'MERCADOS ACTIVOS', val: '60+', green: true },
  { label: 'LIQUIDITY', val: '$1.2B+ USDC' },
  { label: 'PRÓXIMO DESTACADO', val: 'México vs Sudáfrica · 11 Jun 2026' },
  { label: 'RED', val: 'POLYGON · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · GOOGLE · WALLET' },
  { label: 'COMISIÓN', val: '2%' },
  { label: 'POWERED BY', val: 'POLYMARKET' },
  { label: 'MERCADOS ACTIVOS', val: '60+', green: true },
  { label: 'LIQUIDITY', val: '$1.2B+ USDC' },
  { label: 'PRÓXIMO DESTACADO', val: 'México vs Sudáfrica · 11 Jun 2026' },
  { label: 'RED', val: 'POLYGON · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · GOOGLE · WALLET' },
  { label: 'COMISIÓN', val: '2%' },
];

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
