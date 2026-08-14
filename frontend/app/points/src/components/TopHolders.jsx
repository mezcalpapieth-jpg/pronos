/**
 * Top-holders widget for the market detail sidebar.
 *
 * Fetches /api/points/top-holders?marketId=X and renders the biggest
 * shareholders ranked by current mark-to-market value. Compact — the
 * panel sits alongside "Tu posición" + "Odds actuales" / the trade buttons.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { fetchTopHolders } from '../lib/pointsApi.js';
import { useT } from '@app/lib/i18n.js';

export default function TopHolders({ marketId, refreshKey }) {
  const t = useT();
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const maxValue = useMemo(() => Math.max(
    1,
    ...holders.map(h => Number(h.value || 0)).filter(Number.isFinite),
  ), [holders]);

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
        {t('points.top.title')}
      </div>

      {loading ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          {t('points.top.loading')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {holders.map((h, i) => {
            const value = Number(h.value || 0);
            const costBasis = Number(h.costBasis);
            const payoutValue = Number(h.payoutValue);
            const hasPayout = Number.isFinite(payoutValue);
            const beforeValue = hasPayout && Number.isFinite(costBasis) ? costBasis : value;
            const beforeLabel = Math.round(beforeValue).toLocaleString('es-MX');
            const payoutLabel = hasPayout ? Math.round(payoutValue).toLocaleString('es-MX') : '';
            const width = Math.max(4, Math.min(100, (value / maxValue) * 100));
            return (
              <div
                key={`${h.username}-${i}`}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'grid',
                  gridTemplateColumns: '18px minmax(0, 1fr) auto',
                  alignItems: 'baseline',
                  gap: 6,
                  padding: '8px 8px',
                  borderRadius: 8,
                  background: i === 0 ? 'rgba(0,232,122,0.06)' : 'var(--surface2)',
                  border: `1px solid ${i === 0 ? 'rgba(0,232,122,0.25)' : 'var(--border)'}`,
                }}
              >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${width}%`,
                  background: i === 0 ? 'rgba(0,232,122,0.13)' : 'rgba(255,85,0,0.08)',
                  pointerEvents: 'none',
                }}
              />
              <span style={{
                position: 'relative',
                zIndex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: i === 0 ? 'var(--green)' : 'var(--text-muted)',
                fontWeight: 700,
              }}>
                {i + 1}
              </span>
              <div style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
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
                position: 'relative',
                zIndex: 1,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                textAlign: 'right',
              }}>
              {hasPayout ? `${beforeLabel} MXNP -> ${payoutLabel} MXNP` : beforeLabel}
            </span>
            </div>
          );
        })}
        </div>
      )}
    </section>
  );
}
