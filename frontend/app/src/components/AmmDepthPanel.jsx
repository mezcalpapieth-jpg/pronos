import React, { useEffect, useState } from 'react';

const DEPTH_LEVELS = '10,25,50,100';

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function formatMxnb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2);
}

function formatShares(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n >= 100 ? n.toFixed(0) : n.toFixed(n >= 10 ? 1 : 2);
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${Math.round(n * 100)}¢`;
}

function formatImpact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1)} pts`;
}

function Row({ row, side }) {
  const isBuy = side === 'buy';
  const accent = isBuy ? 'var(--green)' : '#f59e0b';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '58px minmax(0, 1fr) 56px',
      alignItems: 'center',
      gap: 8,
      padding: '7px 0',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{formatMxnb(row?.notional)}</span>
      {row?.error ? (
        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          Sin cotización
        </span>
      ) : (
        <span style={{ minWidth: 0 }}>
          <span style={{ color: 'var(--text-primary)' }}>
            {isBuy ? `${formatShares(row?.sharesOut)} acc.` : `${formatMxnb(row?.collateralOut)} MXNB`}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
            {formatPrice(row?.avgPrice)}
          </span>
        </span>
      )}
      <span style={{
        color: row?.error ? 'var(--text-muted)' : accent,
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {row?.error ? '—' : formatImpact(row?.priceImpactPts)}
      </span>
    </div>
  );
}

function DepthSide({ title, rows, side }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '58px minmax(0, 1fr) 56px',
        gap: 8,
        marginBottom: 4,
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
      }}>
        <span>{title}</span>
        <span>{side === 'buy' ? 'Recibes' : 'Salida'}</span>
        <span style={{ textAlign: 'right' }}>Impacto</span>
      </div>
      {(rows || []).map((row, index) => (
        <Row key={`${side}-${row?.notional || index}`} row={row} side={side} />
      ))}
    </div>
  );
}

export default function AmmDepthPanel({
  marketId,
  outcomeIndex = 0,
  outcomeLabel = '',
  disabled = false,
}) {
  const [depth, setDepth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!marketId || disabled) {
      setDepth(null);
      setLoading(false);
      setError('');
      return undefined;
    }

    let cancelled = false;
    const params = new URLSearchParams({
      marketId: String(marketId),
      outcomeIndex: String(outcomeIndex || 0),
      levels: DEPTH_LEVELS,
    });

    setLoading(true);
    setError('');
    getJson(`/api/protocol/depth?${params.toString()}`)
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setDepth(null);
          setError(data?.error || 'depth_failed');
          return;
        }
        setDepth(data?.depth || null);
      })
      .catch((e) => {
        if (cancelled) return;
        setDepth(null);
        setError(e?.message || 'depth_failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [marketId, outcomeIndex, disabled]);

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      paddingTop: 14,
      marginTop: 2,
      marginBottom: 14,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          Liquidez AMM
        </div>
        {outcomeLabel && (
          <div style={{
            minWidth: 0,
            maxWidth: '55%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-secondary)',
          }}>
            {outcomeLabel}
          </div>
        )}
      </div>

      <p style={{
        margin: '0 0 10px',
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        lineHeight: 1.4,
        color: 'var(--text-muted)',
      }}>
        Profundidad estimada contra la curva del pool.
      </p>

      {disabled ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          Disponible solo mientras el mercado esté abierto.
        </div>
      ) : loading && !depth ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
          Cargando liquidez…
        </div>
      ) : error ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#f59e0b' }}>
          No se pudo cargar la liquidez.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 14,
        }}>
          <DepthSide title="Compra" rows={depth?.buy || []} side="buy" />
          <DepthSide title="Venta" rows={depth?.sell || []} side="sell" />
        </div>
      )}
    </div>
  );
}
