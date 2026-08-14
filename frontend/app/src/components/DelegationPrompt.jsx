/**
 * Turnkey delegated-signing prompt — MVP on-chain signing consent:
 *
 *   1. PointsLoginModal — shown only by the MVP signup path after
 *      a new user claims their username, so the on-chain trade flow
 *      does not pop a confirmation modal on every buy.
 *
 *   2. Portfolio banner — shown to LEGACY accounts that signed up in
 *      the points-app (where this prompt didn't exist) and so missed
 *      step 1. The banner self-hides once the user authorizes.
 *
 * Two render modes via the `variant` prop:
 *   variant='inline'  — used inside PointsLoginModal; no overlay,
 *                       just a vertical stack of explanation +
 *                       buttons that fits the modal's content area.
 *   variant='banner'  — used on Portfolio; a single dismissable card
 *                       with title, one-line copy, and the auth
 *                       buttons. Compact for portfolio context.
 *
 * Callbacks:
 *   onAuthorized()    — fired on successful authorization.
 *   onSkip()          — fired when user chooses "Maybe later".
 *                       Banner consumers should remember the dismiss
 *                       in localStorage so it doesn't keep popping.
 */
import React, { useState } from 'react';
import { authorizeDelegation } from '@app/lib/pointsAuth.js';

const BULLETS = [
  { icon: '01', title: 'Compras sin interrupciones', body: 'Pronos firma tus compras y ventas on-chain sin pedirte confirmar cada vez.' },
  { icon: '02', title: 'Sin retiros automáticos', body: 'La autorización no permite enviar MXNB a wallets externas ni exportar llaves.' },
  { icon: '03', title: 'Solo contratos de Pronos', body: 'La firma queda limitada a Arbitrum, contratos permitidos y funciones de trading autorizadas.' },
  { icon: '04', title: 'Tus retiros siguen en tus manos', body: 'Para mover MXNB fuera de Pronos vas a confirmar con tu correo. Eso no cambia.' },
  { icon: '05', title: 'Vigencia: 180 días', body: 'Después de medio año te volvemos a pedir autorización. Puedes revocar antes desde tu perfil.' },
];

const AUTHORIZATION_ERROR = 'No pudimos completar la autorización. Intenta más tarde o continúa sin autorizar por ahora.';

export default function DelegationPrompt({ variant = 'inline', onAuthorized, onSkip }) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function handleAuthorize() {
    setSubmitting(true);
    setErr(null);
    try {
      const r = await authorizeDelegation();
      onAuthorized?.(r);
    } catch (e) {
      console.warn('[delegation-prompt] authorization failed', {
        code: e?.code,
        message: e?.message,
      });
      setErr(AUTHORIZATION_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  if (variant === 'banner') {
    return (
      <div style={{
        padding: '20px 22px',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em',
          color: 'var(--green)', textTransform: 'uppercase',
        }}>
          Firma delegada · una vez
        </div>
        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: 22,
          color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}>
          Habilita mercados en blockchain
        </h3>
        <p style={{
          fontSize: 14, color: 'var(--text-secondary)',
          lineHeight: 1.55, margin: 0,
        }}>
          Autoriza a Pronos una sola vez a firmar tus órdenes on-chain.
          Vigencia de 6 meses, solo en Arbitrum y solo contra contratos y
          funciones de trading autorizadas. Tus retiros siguen requiriendo tu firma.
        </p>
        {err && (
          <div style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>
            {err}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={handleAuthorize}
            disabled={submitting}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: 'var(--green)',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.65 : 1,
            }}
          >
            {submitting ? 'Autorizando…' : 'Autorizar'}
          </button>
          <button
            onClick={() => onSkip?.()}
            disabled={submitting}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            Más tarde
          </button>
        </div>
      </div>
    );
  }

  // variant === 'inline' — sits inside the login modal's content frame.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{
        fontSize: 13, color: 'var(--text-secondary)',
        lineHeight: 1.5, margin: 0,
      }}>
        Un último paso. Autoriza a Pronos una sola vez a firmar tus órdenes
        on-chain — así no tienes que confirmar cada compra.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {BULLETS.map((b, i) => (
          <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{
              flexShrink: 0,
              width: 22,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              lineHeight: '20px',
              color: 'var(--green)',
              textAlign: 'center',
              letterSpacing: '0.04em',
            }}>
              {b.icon}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
                {b.title}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                {b.body}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {err && (
        <div style={{ fontSize: 12, color: 'var(--red, #ef4444)' }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          onClick={handleAuthorize}
          disabled={submitting}
          style={{
            flex: 1,
            padding: '12px 16px',
            background: 'var(--green)',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.65 : 1,
          }}
        >
          {submitting ? 'Autorizando…' : 'Autorizar'}
        </button>
        <button
          onClick={() => onSkip?.()}
          disabled={submitting}
          style={{
            padding: '12px 16px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          Más tarde
        </button>
      </div>
    </div>
  );
}
