/**
 * Turnkey delegated-signing consent sheet (M2).
 *
 * Opens once per user (or when a policy expires and they re-auth).
 * Plain Spanish copy explains exactly what they're authorizing:
 *   - Backend can sign buy / sell / redeem / MXNB.approve
 *   - Only to whitelisted contracts (MarketFactory + Market clones)
 *   - Up to 200,000 MXNB/day
 *   - Valid 180 days, then re-authorize via email
 *   - Withdrawals to external wallets ALWAYS require fresh signature
 *
 * On confirm, POSTs /api/points/turnkey/authorize-delegation and
 * calls `onAuthorized` with the response so the caller can proceed
 * with whatever trade the user was trying to do.
 *
 * Rendered via createPortal so the sheet overlays cleanly regardless
 * of where in the tree it's mounted (market detail, drawer, etc.)
 */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { authorizeDelegation } from '../lib/pointsApi.js';

const BULLETS = [
  {
    icon: '✓',
    title: 'Compras y ventas automáticas',
    body: 'Firmamos cada compra, venta, y cobro de ganancias sin pedirte confirmar una y otra vez.',
  },
  {
    icon: '💰',
    title: 'Límite: 200,000 MXNB por día',
    body: 'Una protección dura — aunque nuestro backend fuera comprometido, no puede gastar más que esto por cuenta.',
  },
  {
    icon: '🔒',
    title: 'Solo a contratos de Pronos',
    body: 'La firma vive encerrada: únicamente para los contratos de los mercados. No puede enviar fondos a ningún otro lado.',
  },
  {
    icon: '🚪',
    title: 'Los retiros siguen en tus manos',
    body: 'Para mover MXNB fuera de Pronos vas a confirmar con un correo. Eso no cambia.',
  },
  {
    icon: '📅',
    title: 'Vigencia: 180 días',
    body: 'Después de medio año te volvemos a pedir autorización. Puedes revocar antes desde tu perfil.',
  },
];

export default function PointsDelegationModal({ open, onClose, onAuthorized }) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  if (!open) return null;

  async function handleAuthorize() {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await authorizeDelegation();
      onAuthorized?.(r);
    } catch (e) {
      setErr(e.detail || e.code || e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const overlay = (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.();
        e.stopPropagation();
      }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: 'min(520px, 92vw)',
        maxHeight: '90vh',
        overflowY: 'auto',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '28px 28px 24px',
        fontFamily: 'var(--font-body)',
      }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.16em',
            color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6,
          }}>
            Autorización única · Turnkey
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 24,
            color: 'var(--text-primary)', margin: 0,
          }}>
            Firma una vez. Apuesta sin interrupciones.
          </h2>
        </div>

        <p style={{
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6,
          margin: '0 0 18px',
        }}>
          Cada apuesta en blockchain requiere una firma criptográfica. Para que
          no tengas que aprobar cada clic, autorizas una vez a Pronos a firmar
          dentro de límites estrictos. Así funciona:
        </p>

        <ul style={{
          listStyle: 'none', padding: 0, margin: '0 0 20px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          {BULLETS.map(b => (
            <li key={b.title} style={{
              display: 'flex', gap: 12, alignItems: 'flex-start',
              padding: '10px 12px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1.2, flexShrink: 0 }}>{b.icon}</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)', marginBottom: 3 }}>
                  {b.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {b.body}
                </div>
              </div>
            </li>
          ))}
        </ul>

        {err && (
          <div style={{
            padding: '10px 12px', marginBottom: 14,
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: 'var(--red, #ef4444)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
          }}>
            No pudimos autorizar: {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={() => { if (!submitting) onClose?.(); }}
            disabled={submitting}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleAuthorize}
            disabled={submitting}
            className="btn-primary"
            style={{
              padding: '10px 18px',
              fontSize: 12,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Autorizando…' : '✓ Autorizar'}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlay, document.body)
    : overlay;
}
