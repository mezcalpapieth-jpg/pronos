/**
 * Welcome modal — shown once right after a user claims their username.
 *
 * The goal is to make the "what is Pronos?" moment feel considered:
 *   1. Hero with a concise headline + the 1,500 MXNP bonus call-out.
 *   2. "What Pronos is TODAY" — off-chain competition, 2-week cycles,
 *      cash prizes for the top of the leaderboard.
 *   3. "What's coming NEXT" - on-chain Pesos markets, priority access
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
import { useLang } from '@app/lib/i18n.js';

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
  const lang = useLang();
  const isEn = lang === 'en';

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
          {/* Hero */}
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
            {isEn ? 'Welcome to the beta' : 'Bienvenido a la beta'}
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
            {isEn ? 'Hi' : 'Hola'}{username ? <>, <span style={{ color: 'var(--green)' }}>@{username}</span></> : null}
          </h1>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            color: 'var(--text-secondary)',
            lineHeight: 1.55,
            margin: 0,
          }}>
            {isEn ? (
              <>You already have <strong style={{ color: 'var(--green)' }}>1,500 MXNP</strong> as a welcome bonus to start predicting.</>
            ) : (
              <>Ya tienes <strong style={{ color: 'var(--green)' }}>1,500 MXNP</strong> de bienvenida para empezar a predecir.</>
            )}
          </p>
        </div>

        {/* Sections */}
        <div style={{ padding: '26px 36px 12px' }}>
          <WelcomeSection
            accent="var(--green)"
            eyebrow={isEn ? 'What Pronos is today' : 'Qué es Pronos hoy'}
            body={
              isEn ? (
                <>
                  A <strong>prediction competition</strong>. You buy shares on
                  real events (sports, politics, crypto, entertainment) with MXNP -
                  the competition points. Prices move with demand, like a real
                  market.
                  <br /><br />
                  The next tournament starts on August 12. The Top 5 win cash prizes,
                  and the leaderboard is scored by market PnL.
                </>
              ) : (
                <>
                  Una <strong>competencia de predicciones</strong>. Compras acciones
                  en eventos reales (deportes, política, crypto, entretenimiento) con MXNP,
                  los puntos de la competencia. Los precios se mueven con la
                  demanda, como en un mercado real.
                  <br /><br />
                  El próximo torneo empieza el 12 de agosto. El Top 5 gana premios
                  en efectivo, y el leaderboard se mide por PnL de mercados.
                </>
              )
            }
            bullets={isEn ? [
              { icon: '01', text: 'Tournament', value: 'Aug 12' },
              { icon: '02', text: 'Markets', value: 'open' },
              { icon: '03', text: 'Starting balance', value: '1,500 MXNP' },
            ] : [
              { icon: '01', text: 'Torneo', value: '12 ago' },
              { icon: '02', text: 'Mercados', value: 'abiertos' },
              { icon: '03', text: 'Balance inicial', value: '1,500 MXNP' },
            ]}
          />

          <WelcomeSection
            accent="#ff5500"
            eyebrow={isEn ? 'What comes next' : 'Qué viene después'}
            body={
              isEn ? (
                <>
                  We are building the first <strong>on-chain prediction
                  market</strong> designed for Latin America. What you use now
                  with MXNP is the warm-up - soon you will be able to trade{' '}
                  <strong>Pesos</strong> on real events, with automatic
                  settlement and no intermediaries.
                  <br /><br />
                  Active competitors today will get <strong style={{ color: 'var(--orange)' }}>
                  priority access</strong> when we open Peso trading.
                </>
              ) : (
                <>
                  Estamos construyendo el primer <strong>mercado de predicciones
                  on-chain</strong> diseñado para Latinoamérica. Lo que usas ahora
                  con MXNP es el calentamiento; pronto podrás invertir{' '}
                  <strong>Pesos</strong> sobre eventos reales, con liquidación
                  automática y sin intermediarios.
                  <br /><br />
                  Los competidores activos hoy tendrán <strong style={{ color: 'var(--orange)' }}>
                  acceso prioritario</strong> cuando abramos trading en Pesos.
                </>
              )
            }
          />

          <WelcomeSection
            accent="var(--text-muted)"
            eyebrow={isEn ? 'How to earn MXNP without spending it' : 'Cómo ganar MXNP sin gastarlo'}
            bullets={isEn ? [
              { icon: '01', text: 'Daily claim', value: '150 + 15/day streak' },
              { icon: '02', text: 'Each friend you invite', value: '+375 MXNP' },
              { icon: '03', text: 'Approved social tasks', value: '+300 to +750 MXNP' },
            ] : [
              { icon: '01', text: 'Reclamo diario', value: '150 + 15/día racha' },
              { icon: '02', text: 'Cada amigo que invites', value: '+375 MXNP' },
              { icon: '03', text: 'Tareas sociales aprobadas', value: '+300 a +750 MXNP' },
            ]}
          />
        </div>

        {/* CTAs */}
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
            {isEn ? 'Claim my first MXNP' : 'Reclamar mis primeros MXNP'}
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
            {isEn ? 'Explore markets' : 'Explorar mercados'}
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
          {isEn
            ? 'MXNP are competition points - they do not have direct economic value. Tournament prizes are paid in cash.'
            : 'MXNP son puntos de la competencia, no tienen valor económico directo. Los premios del torneo se pagan en efectivo.'}
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
