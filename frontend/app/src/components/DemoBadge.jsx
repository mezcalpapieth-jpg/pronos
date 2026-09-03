/**
 * DemoBadge — persistent "this is simulated" marker for demo mode, with a
 * one-click reset so the demo can be rehearsed and put back to its starting
 * state before the real run.
 */
import React, { useState } from 'react';
import { resetDemo } from '../lib/demo.js';

export default function DemoBadge() {
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{
      position: 'fixed',
      left: 16,
      bottom: 16,
      zIndex: 150,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      maxWidth: 'calc(100vw - 32px)',
      padding: '8px 12px',
      borderRadius: 999,
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.1em',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: 'var(--gold, #F5C842)', flexShrink: 0,
      }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        Demo · datos simulados
      </span>
      <button
        onClick={() => {
          if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 3000); return; }
          resetDemo();
          setConfirming(false);
        }}
        style={{
          background: 'none',
          border: '1px solid var(--border)',
          borderRadius: 999,
          padding: '3px 10px',
          color: confirming ? 'var(--gold, #F5C842)' : 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {confirming ? '¿Seguro?' : 'Reiniciar'}
      </button>
    </div>
  );
}
