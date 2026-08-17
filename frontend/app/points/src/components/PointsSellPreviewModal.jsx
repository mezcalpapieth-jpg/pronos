import React from 'react';

function fmt(n) {
  const v = Number(n) || 0;
  const sign = v >= 0 ? '' : '-';
  return `${sign}${Math.abs(v).toFixed(2)}`;
}

function signedFmt(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

export default function PointsSellPreviewModal({ state, onClose, onConfirm, onSharesChange }) {
  if (!state) return null;
  const { position, preview, loading, error, submitting } = state;
  const maxShares = Math.max(0, Number(preview?.maxShares ?? state.maxShares ?? position?.shares) || 0);
  const selectedShares = Math.max(0, Math.min(maxShares || 0, Number(state.selectedShares ?? preview?.shares ?? maxShares) || 0));
  const selectedPct = maxShares > 0 ? Math.round((selectedShares / maxShares) * 100) : 100;
  const salePositive = Number(preview?.salePnl || 0) >= 0;
  const impactNegative = Number(preview?.slippageMxnp || 0) < 0;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.68)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div style={{
        width: 'min(520px, 100%)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '26px 24px',
        boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--orange)',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              Venta anticipada
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              lineHeight: 1.1,
              margin: 0,
              color: 'var(--text-primary)',
            }}>
              {position?.outcomeLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 22,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            x
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45, margin: '0 0 18px' }}>
          {position?.question}
        </p>

        {maxShares > 0 && (
          <div style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '14px 14px 13px',
            marginBottom: 14,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'baseline',
              marginBottom: 10,
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}>
                Acciones a vender
              </span>
              <strong style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {fmt(selectedShares)} / {fmt(maxShares)}
              </strong>
            </div>
            <input
              type="range"
              min={Math.min(0.01, maxShares)}
              max={maxShares}
              step="0.01"
              value={selectedShares}
              disabled={submitting}
              onChange={(e) => onSharesChange?.(Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--orange)',
                cursor: submitting ? 'wait' : 'pointer',
              }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span>{selectedPct}%</span>
              <span>{loading ? 'Actualizando cotización...' : 'Cotización real del mercado'}</span>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{
            padding: '28px 0',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Calculando salida real...
          </div>
        ) : error ? (
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: 'var(--danger)',
            borderRadius: 12,
            padding: '14px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            No se pudo calcular la venta: {error}
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
              marginBottom: 14,
            }}>
              {[
                ['VALOR MARCADO', `${fmt(preview.markValue)} MXNP`, 'var(--text-primary)'],
                ['SALIDA REAL', `${fmt(preview.collateralOut)} MXNP`, 'var(--green)'],
                ['PNL MARCADO', `${signedFmt(preview.markPnl)} MXNP`, preview.markPnl >= 0 ? 'var(--success)' : 'var(--danger)'],
                ['PNL AL VENDER', `${signedFmt(preview.salePnl)} MXNP`, salePositive ? 'var(--success)' : 'var(--danger)'],
              ].map(([label, value, color]) => (
                <div key={label} style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '13px 14px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 16,
                    color,
                    fontWeight: 800,
                  }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              background: 'rgba(255,91,26,0.07)',
              border: '1px solid rgba(255,91,26,0.28)',
              borderRadius: 12,
              padding: '13px 14px',
              marginBottom: 18,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--orange)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 7,
              }}>
                IMPACTO POR LIQUIDEZ
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                La venta mueve el mercado de {fmt(preview.priceBeforePct)}% a {fmt(preview.priceAfterPct)}%.
                {' '}Recibes {signedFmt(preview.slippageMxnp)} MXNP contra el valor marcado
                {' '}({signedFmt(preview.slippagePct)}%).
              </div>
              {impactNegative && (
                <div style={{
                  marginTop: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}>
                  El PnL real usa la salida real del mercado, no el valor marcado antes de vender.
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '10px 14px', fontSize: 12 }}
          >
            Cancelar
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={!preview || loading || error || submitting}
            style={{ padding: '10px 16px', fontSize: 12, cursor: submitting ? 'wait' : 'pointer' }}
          >
            {submitting ? 'Vendiendo...' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </div>
  );
}
