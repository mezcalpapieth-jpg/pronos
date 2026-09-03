import React from 'react';
import { IS_DEMO } from '../lib/demo.js';
import DEMO_MARKETS from '../lib/demoMarkets.js';

// In demo mode the strip advertises the demo instead of live Polymarket
// liquidity, and its featured market is pulled from the demo set so it can
// never show a date that has already passed.
const demoFeatured = DEMO_MARKETS.find(m => m.trending) || DEMO_MARKETS[0];
const DEMO_TICKER_ITEMS = [
  { label: 'MODO', val: 'DEMO · DATOS SIMULADOS' },
  { label: 'MERCADOS ACTIVOS', val: String(DEMO_MARKETS.length), green: true },
  { label: 'PRÓXIMO DESTACADO', val: `${demoFeatured.title} · ${demoFeatured.deadline}` },
  { label: 'RED', val: 'POLYGON · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · GOOGLE · WALLET' },
  { label: 'COMISIÓN', val: '2%' },
];

const TICKER_ITEMS = [
  { label: 'POWERED BY', val: 'POLYMARKET' },
  { label: 'MERCADOS ACTIVOS', val: '60+', green: true },
  { label: 'LIQUIDITY', val: '$1.2B+ USDC' },
  { label: 'PRÓXIMO DESTACADO', val: 'México vs Sudáfrica · 11 Jun 2026' },
  { label: 'RED', val: 'POLYGON · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · GOOGLE · WALLET' },
  { label: 'COMISIÓN', val: '≤2.5%' },
  { label: 'POWERED BY', val: 'POLYMARKET' },
  { label: 'MERCADOS ACTIVOS', val: '60+', green: true },
  { label: 'LIQUIDITY', val: '$1.2B+ USDC' },
  { label: 'PRÓXIMO DESTACADO', val: 'México vs Sudáfrica · 11 Jun 2026' },
  { label: 'RED', val: 'POLYGON · SIN GAS', green: true },
  { label: 'AUTH', val: 'EMAIL · GOOGLE · WALLET' },
  { label: 'COMISIÓN', val: '≤2.5%' },
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
          {(IS_DEMO ? [...DEMO_TICKER_ITEMS, ...DEMO_TICKER_ITEMS] : TICKER_ITEMS).map((item, i) => (
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
