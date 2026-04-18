/**
 * Top-holders widget for the market detail sidebar.
 *
 * Fetches /api/points/top-holders?marketId=X and renders the biggest
 * shareholders ranked by current mark-to-market value. Compact — the
 * panel sits alongside "Tu posición" + "Odds actuales" / the trade buttons.
 */
import React, { useEffect, useState } from 'react';
import { fetchTopHolders } from '../lib/pointsApi.js';

export default function TopHolders({ marketId, refreshKey }) {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marketId) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchTopHolders(marketId, { limit: 8 })
      .then(r => {
        if (cancelled) return;
        setHolders(Array.isArray(r?.holders) ? r.holders : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setHolders([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [marketId, refreshKey]);

  if (!loading && holders.length === 0) return null;

  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '18px 20px',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        marginBottom: 12,
      }}>
        Top holders
      </div>

      {loading ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          Cargando…
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {holders.map((h, i) => (
            <div
              key={`${h.username}-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px minmax(0, 1fr) auto',
                alignItems: 'baseline',
                gap: 6,
                padding: '6px 8px',
                borderRadius: 8,
                background: i === 0 ? 'rgba(0,232,122,0.06)' : 'var(--surface2)',
                border: `1px solid ${i === 0 ? 'rgba(0,232,122,0.25)' : 'var(--border)'}`,
              }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: i === 0 ? 'var(--green)' : 'var(--text-muted)',
                fontWeight: 700,
              }}>
                {i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {h.username}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {h.outcomeLabel}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                fontWeight: 600,
              }}>
                {Math.round(h.value).toLocaleString('es-MX')}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
