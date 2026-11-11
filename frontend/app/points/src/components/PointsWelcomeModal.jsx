import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLang, useT } from '@app/lib/i18n.js';
import { TOURNAMENT_REWARDS } from '../../../../shared/points-rewards.js';

export const WELCOMED_KEY_PREFIX = 'pronos-points-welcomed-';

export function markWelcomed(username) {
  if (!username) return;
  try {
    localStorage.setItem(WELCOMED_KEY_PREFIX + username.toLowerCase(), '1');
  } catch { /* ignore */ }
}

export function hasBeenWelcomed(username) {
  if (!username) return true;
  try {
    return localStorage.getItem(WELCOMED_KEY_PREFIX + username.toLowerCase()) === '1';
  } catch {
    return true;
  }
}

export default function PointsWelcomeModal({ open, username, onClose }) {
  const navigate = useNavigate();
  const isEn = useLang() === 'en';
  const t = useT();
  const dialogRef = useRef(null);
  function close() {
    markWelcomed(username);
    onClose?.();
  }

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

  function goTo(path) {
    close();
    navigate(path);
  }

  const { signupBonus, dailyBase, dailyStep, dailyMax } = TOURNAMENT_REWARDS;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0, 0, 0, 0.72)', backdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center', padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          if (e.key !== 'Tab') return;
          const buttons = e.currentTarget.querySelectorAll('button');
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        style={{
          width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
          background: 'var(--surface1)', border: '1px solid var(--border)',
          borderRadius: 18, boxShadow: '0 20px 80px rgba(0, 0, 0, 0.55)',
          padding: '28px clamp(18px, 5vw, 32px) 24px', position: 'relative',
          color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
        }}
      >
        <button
          type="button"
          aria-label={t('points.intro.dismiss')}
          onClick={close}
          style={{
            position: 'absolute', top: 8, right: 8, width: 44, height: 44,
            border: 0, background: 'transparent', color: 'var(--text-secondary)',
            fontSize: 26, cursor: 'pointer',
          }}
        >
          ×
        </button>
        <h2
          id="welcome-title"
          style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 6vw, 36px)',
            margin: '0 32px 10px 0', overflowWrap: 'anywhere', lineHeight: 1.1,
          }}
        >
          {isEn ? 'Welcome' : 'Te damos la bienvenida'}, @{username}
        </h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 16px' }}>
          {isEn ? (
            <>You already have <strong style={{ color: 'var(--orange)' }}>{signupBonus} MXNP</strong> to make predictions on real events. MXNP are Pronos points with no cash value.</>
          ) : (
            <>Ya tienes <strong style={{ color: 'var(--orange)' }}>{signupBonus} MXNP</strong> para predecir eventos reales. Los MXNP son puntos de Pronos sin valor en efectivo.</>
          )}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn-primary" onClick={() => goTo('/')} style={actionStyle}>
            {isEn ? 'Explore markets' : 'Explorar mercados'}
          </button>
          <button
            type="button"
            onClick={() => goTo('/earn')}
            style={{
              ...actionStyle, border: '1px solid var(--border)', borderRadius: 10,
              background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer',
            }}
          >
            {isEn ? 'Earn MXNP' : 'Ganar MXNP'}
          </button>
        </div>
        <div style={{
          borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16,
          color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5,
        }}>
          <p style={{ margin: '0 0 10px' }}>
            {isEn
              ? 'Pronos runs month-long tournaments. When a tournament is active, see the rules and prizes on the tournament page.'
              : 'Los torneos de Pronos duran un mes. Cuando haya uno activo, consulta sus reglas y premios en la página del torneo.'}
          </p>
          <p style={{ margin: 0 }}>
            {isEn
              ? `Earn ${dailyBase} MXNP with your daily claim, plus ${dailyStep} per consecutive day up to ${dailyMax} MXNP. Eligible referrals and approved social tasks also earn points.`
              : `Reclama ${dailyBase} MXNP al día, con ${dailyStep} adicionales por día consecutivo hasta ${dailyMax} MXNP. También puedes ganar puntos con referidos válidos y tareas sociales aprobadas.`}
          </p>
        </div>
      </div>
    </div>
  );
}

const actionStyle = {
  flex: '1 1 150px',
  minHeight: 44,
  padding: '10px 14px',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 700,
};
