/**
 * Ticker strip at the top of the points-app home page.
 *
 * Copies the exact structure + CSS classes from the main pronos.io
 * landing (#ticker / .ticker-*) so the look-and-feel matches. Content
 * is MXNP-focused instead of the MVP's Polymarket/USDC pitch.
 */
import React from 'react';

const ITEMS = [
  { label: 'BETA',             val: 'PRONOS POINTS', green: true },
  { label: 'MONEDA',           val: 'MXNP · PUNTOS' },
  { label: 'BONO INICIAL',     val: '500 MXNP',       green: true },
  { label: 'CICLO',            val: '2 SEMANAS' },
  { label: 'PREMIO 1° LUGAR',  val: '$5,000 MXN',     green: true },
  { label: 'PREMIO 2° LUGAR',  val: '$3,000 MXN' },
  { label: 'PREMIO 3° LUGAR',  val: '$2,000 MXN' },
  { label: 'PREMIO 4° – 10°',  val: '🎁 SORPRESA' },
  { label: 'COMISIÓN',         val: 'SOLO EN COMPRAS' },
  // Duplicated so the CSS animation is seamless (the track is twice the
  // width of the viewport).
  { label: 'BETA',             val: 'PRONOS POINTS', green: true },
  { label: 'MONEDA',           val: 'MXNP · PUNTOS' },
  { label: 'BONO INICIAL',     val: '500 MXNP',       green: true },
  { label: 'CICLO',            val: '2 SEMANAS' },
  { label: 'PREMIO 1° LUGAR',  val: '$5,000 MXN',     green: true },
];

export default function PointsTicker() {
  return (
    <div id="ticker">
      <div className="ticker-badge">
        <span className="dot-live" />
        <span>EN VIVO</span>
      </div>
      <div className="ticker-track-wrapper">
        <div className="ticker-track">
          {ITEMS.map((item, i) => (
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
