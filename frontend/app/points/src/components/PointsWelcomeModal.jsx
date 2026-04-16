/**
 * Welcome modal — shown once right after a user claims their username.
 *
 * The goal is to make the "what is Pronos?" moment feel considered:
 *   1. Hero with a celebratory headline + the 500 MXNP bonus call-out.
 *   2. "What Pronos is TODAY" — off-chain competition, 2-week cycles,
 *      cash prizes for the top of the leaderboard.
 *   3. "What's coming NEXT" — on-chain USDC markets, priority access
 *      for the active competitors we have now.
 *   4. "How to earn without spending" — daily claim, referrals, social.
 *   5. CTA row: primary → claim today's daily, secondary → dismiss.
 *
 * Persistence: once dismissed, we write a per-username flag to
 * localStorage so we never re-show it on subsequent sessions. App.jsx
 * decides whether to open it by checking this flag.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';

export const WELCOMED_KEY_PREFIX = 'pronos-points-welcomed-';

export function markWelcomed(username) {
  if (!username) return;
  try {
    localStorage.setItem(WELCOMED_KEY_PREFIX + username.toLowerCase(), '1');
  } catch { /* ignore */ }
}

export function hasBeenWelcomed(username) {
  if (!username) return true; // no username → don't show yet
  try {
    return localStorage.getItem(WELCOMED_KEY_PREFIX + username.toLowerCase()) === '1';
  } catch {
    return true; // storage blocked → behave as if welcomed to avoid looping
  }
}

export default function PointsWelcomeModal({ open, username, onClose }) {
  const navigate = useNavigate();

  if (!open) return null;

  function close() {
    markWelcomed(username);
    onClose?.();
  }

  function goClaim() {
    close();
    navigate('/earn');
  }

  function goMarkets() {
    close();
    navigate('/');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        overflowY: 'auto',
      }}
    >
      <div style={{
        width: 'min(620px, 100%)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        boxShadow: '0 20px 80px rgba(0, 0, 0, 0.55)',
        overflow: 'hidden',
        fontFamily: 'var(--font-body)',
        color: 'var(--text-primary)',
        maxHeight: 'calc(100vh - 48px)',
        overflowY: 'auto',
      }}>
        {/* ── Hero ───────────────────────────────────────────── */}
        <div style={{
          padding: '40px 36px 28px',
          textAlign: 'center',
          background: 'linear-gradient(180deg, rgba(0,232,122,0.1) 0%, transparent 65%)',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            color: 'var(--green)',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            ⚡ Bienvenido a la beta
          </div>
          <h1
            id="welcome-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(28px, 4vw, 36px)',
              lineHeight: 1.1,
              margin: '0 0 12px',
              letterSpacing: '0.02em',
            }}
          >
            Hola{username ? <>, <span style={{ color: 'var(--green)' }}>@{username}</span></> : null}
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            margin: 0,
          }}>
            Ya tienes <strong style={{ color: 'var(--green)' }}>500 MXNP</strong> de
            bienvenida para empezar a predecir.
          </p>
        </div>

        {/* ── Sections ────────────────────────────────────────── */}
        <div style={{ padding: '26px 36px 12px' }}>
          <WelcomeSection
            accent="var(--green)"
            eyebrow="Qué es Pronos hoy"
            body={
              <>
                Una <strong>competencia de predicciones</strong>. Compras acciones
                en eventos reales (deportes, política, crypto, cultura) con MXNP
                — los puntos de la competencia. Los precios se mueven con la
                demanda, como en un mercado real.
                <br /><br />
                Cada <strong style={{ color: 'var(--green)' }}>2 semanas</strong>,
                los Top 3 del leaderboard ganan premios en efectivo:
              </>
            }
            bullets={[
              { icon: '🥇', text: '1° lugar', value: '$5,000 MXN' },
              { icon: '🥈', text: '2° lugar', value: '$3,000 MXN' },
              { icon: '🥉', text: '3° lugar', value: '$2,000 MXN' },
              { icon: '🎁', text: '4° – 10° lugar', value: 'premios sorpresa' },
            ]}
          />

          <WelcomeSection
            accent="#ff5500"
            eyebrow="Qué viene después"
            body={
              <>
                Estamos construyendo el primer <strong>mercado de predicciones
                on-chain</strong> diseñado para Latinoamérica. Lo que usas ahora
                con MXNP es el calentamiento — pronto podrás operar con{' '}
                <strong>USDC real</strong> sobre eventos reales, con liquidación
                automática y sin intermediarios.
                <br /><br />
                Los competidores activos hoy tendrán <strong style={{ color: '#ff5500' }}>
                acceso prioritario</strong> cuando abramos trading con USDC.
              </>
            }
          />

          <WelcomeSection
            accent="var(--text-muted)"
            eyebrow="Cómo ganar MXNP sin gastarlo"
            bullets={[
              { icon: '⚡', text: 'Reclamo diario', value: '100 + 20/día racha' },
              { icon: '🤝', text: 'Cada amigo que invites', value: '+100 MXNP' },
              { icon: '📲', text: 'Seguir a Pronos en redes', value: 'hasta +85 MXNP' },
            ]}
          />
        </div>

        {/* ── CTAs ────────────────────────────────────────────── */}
        <div style={{
          padding: '20px 36px 32px',
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}>
          <button
            onClick={goClaim}
            className="btn-primary"
            style={{
              flex: '1 1 220px',
              padding: '14px 20px',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Reclamar mis primeros MXNP
          </button>
          <button
            onClick={goMarkets}
            style={{
              flex: '1 1 180px',
              padding: '14px 20px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 10,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Explorar mercados
          </button>
        </div>

        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          textAlign: 'center',
          padding: '0 36px 28px',
          margin: 0,
          lineHeight: 1.6,
        }}>
          MXNP son puntos de la competencia — no tienen valor económico directo.
          Los premios del leaderboard se pagan en efectivo (MXN).
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function WelcomeSection({ eyebrow, body, bullets, accent = 'var(--green)' }) {
  return (
    <div style={{
      background: 'var(--surface2)',
      border: `1px solid ${accent === 'var(--text-muted)' ? 'var(--border)' : accent + '33'}`,
      borderRadius: 12,
      padding: '18px 20px',
      marginBottom: 14,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.14em',
        color: accent,
        textTransform: 'uppercase',
        fontWeight: 700,
        marginBottom: 10,
      }}>
        {eyebrow}
      </div>
      {body && (
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13.5,
          color: 'var(--text-secondary)',
          lineHeight: 1.65,
          margin: '0 0 ' + (bullets ? '14px' : '0'),
        }}>
          {body}
        </p>
      )}
      {bullets && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bullets.map((b, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}
            >
              <span>
                <span style={{ marginRight: 8 }}>{b.icon}</span>
                {b.text}
              </span>
              <span style={{ color: accent, fontWeight: 700 }}>{b.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
