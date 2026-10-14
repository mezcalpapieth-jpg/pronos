import React, { useEffect, useRef, useState } from 'react';
import { adminAddMarketLiquidity, adminPreviewMarketLiquidity } from '../lib/pointsApi.js';

const number = value => Number(value).toLocaleString('es-MX', { maximumFractionDigits: 2 });
const percent = value => `${number(value * 100)}%`;
const errors = {
  funding_preview_stale: 'El mercado cambió. Simula de nuevo antes de confirmar.',
  invalid_funding_amount: 'Ingresa un aporte entre 1 y 10,000,000 MXNP.',
  funded_reserve_too_large: 'El aporte supera el límite de reservas.',
  market_expired: 'El mercado ya cerró.',
  market_not_active: 'El mercado ya no está activo.',
  funding_failed: 'No se pudo confirmar el aporte. Puedes reintentar sin duplicarlo.',
};

export default function MarketLiquidityPanel({ marketId, onFunded }) {
  const [preview, setPreview] = useState(null);
  const [amount, setAmount] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [complete, setComplete] = useState(null);
  const requestId = useRef(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setBusy(true);
    adminPreviewMarketLiquidity(marketId).then(result => {
      if (current !== generation.current) return;
      setPreview(result);
      setAmount(result.recommendedAmount > 0 ? String(result.recommendedAmount) : '');
    }).catch(err => {
      if (current === generation.current) setError(errors[err.message] || 'No se pudo consultar la liquidez.');
    }).finally(() => {
      if (current === generation.current) setBusy(false);
    });
    return () => { generation.current += 1; };
  }, [marketId]);

  async function simulate() {
    setBusy(true);
    setError(null);
    setConfirmed(false);
    requestId.current = null;
    try {
      const result = await adminPreviewMarketLiquidity(marketId, Number(amount));
      setPreview(result);
      setAmount(String(result.plan.collateral));
      requestId.current = crypto.randomUUID();
    } catch (err) {
      setPreview(previous => previous ? { ...previous, plan: null, impactsAfter: null } : null);
      setError(errors[err.message] || 'No se pudo simular el aporte.');
    } finally { setBusy(false); }
  }

  async function fund() {
    if (!confirmed || !preview?.plan || !requestId.current || Number(amount) !== preview.plan.collateral) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adminAddMarketLiquidity({ marketId, amount: preview.plan.collateral,
        expectedReserves: preview.reserves, requestId: requestId.current });
      setComplete(result);
    } catch (err) {
      if (err.message === 'funding_preview_stale') {
        setPreview(previous => ({ ...previous, plan: null, impactsAfter: null }));
        setConfirmed(false);
        requestId.current = null;
      }
      setError(errors[err.message] || 'No se pudo confirmar el aporte.');
    } finally { setBusy(false); }
  }

  const planReady = preview?.plan && Number(amount) === preview.plan.collateral;
  const inputStyle = { width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '10px 12px',
    border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface1)', color: 'var(--text-primary)', fontSize: 14 };
  const buttonStyle = { ...inputStyle, width: 'auto', cursor: 'pointer', fontWeight: 600 };

  return (
    <section aria-label="Liquidez del AMM" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 20 }}>
      <h3 style={{ fontSize: 16, margin: '0 0 12px', color: 'var(--text-primary)' }}>Liquidez del AMM</h3>
      {complete ? (
        <div role="status" style={{ color: 'var(--green)' }}>
          <p>Aporte registrado: {number(complete.collateral)} MXNP. Probabilidades conservadas.</p>
          <button type="button" style={buttonStyle} onClick={onFunded}>Actualizar mercado</button>
        </div>
      ) : (
        <>
          {preview && (
            <>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                <span>Compra de referencia: {number(preview.testBuy)} MXNP</span>
                <span>Objetivo: máximo {number(preview.targetImpactPts)} puntos de movimiento</span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 300, marginBottom: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>
                    <tr><th style={{ textAlign: 'left' }}>Opción</th><th>Actual</th><th>Tras compra</th><th>Con aporte</th></tr>
                  </thead>
                  <tbody>
                    {preview.impactsBefore.map((row, i) => (
                      <tr key={row.outcomeIndex} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 8px 8px 0', minWidth: 110, overflowWrap: 'anywhere' }}>{preview.outcomes[i]}</td>
                        <td style={{ textAlign: 'right', padding: 6, whiteSpace: 'nowrap' }}>{percent(row.priceBefore)}</td>
                        <td style={{ textAlign: 'right', padding: 6, whiteSpace: 'nowrap', color: row.impactPts > preview.targetImpactPts ? 'var(--orange)' : 'var(--text-primary)' }}>{percent(row.priceAfter)}</td>
                        <td style={{ textAlign: 'right', padding: 6, whiteSpace: 'nowrap', color: 'var(--green)' }}>{planReady ? percent(preview.impactsAfter[i].priceAfter) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }} htmlFor={`liquidity-${marketId}`}>Aporte del sistema (MXNP)</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                <input id={`liquidity-${marketId}`} type="number" min="1" max="10000000" step="1"
                  value={amount} disabled={busy} style={{ ...inputStyle, flex: '1 1 170px' }}
                  onChange={event => { setAmount(event.target.value); setConfirmed(false); }} />
                <button type="button" style={buttonStyle} disabled={busy || !amount} onClick={simulate}>Simular</button>
              </div>
              {preview.recommendedAmount > 0 && (
                <button type="button" style={{ ...buttonStyle, marginBottom: 10 }} disabled={busy}
                  onClick={() => { setAmount(String(preview.recommendedAmount)); setConfirmed(false); }}>
                  Usar recomendado: {number(preview.recommendedAmount)} MXNP
                </button>
              )}
              {preview.recommendedAmount === 0 && <p style={{ fontSize: 12, color: 'var(--green)' }}>La liquidez actual cumple el objetivo.</p>}
              {preview.recommendedAmount === null && <p style={{ fontSize: 12, color: 'var(--orange)' }}>El objetivo excede el límite de aporte.</p>}
              {planReady && (
                <>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Profundidad: {number(preview.plan.scaleFactor)}x. Las probabilidades actuales se conservan.</p>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
                    <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
                    Confirmo el aporte de {number(preview.plan.collateral)} MXNP del sistema. No es un depósito de MXNB; no cambia acciones ni saldos de usuarios.
                  </label>
                  <button type="button" style={{ ...buttonStyle, background: 'var(--green)', color: '#080808' }}
                    disabled={busy || !confirmed} onClick={fund}>Añadir liquidez</button>
                </>
              )}
            </>
          )}
          {busy && <p role="status" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Calculando...</p>}
          {error && <p role="alert" style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>{error}</p>}
        </>
      )}
    </section>
  );
}
