/**
 * Intro modal — the "what is this?" pitch for someone who lands on Pronos
 * without an account.
 *
 * This is the copy that used to be the home hero. It moved here because the
 * hero pushed every market below the fold for people who already know what
 * Pronos is, while the people who actually needed the pitch — first-time,
 * logged-out visitors — are exactly who a modal can reach.
 *
 * Distinct from PointsWelcomeModal, which fires once AFTER a user claims a
 * username. This one fires BEFORE there is a user at all, so it can't key
 * off a username: it writes a device-level flag instead.
 *
 * Shown when all of these hold:
 *   - auth has resolved and nobody is signed in
 *   - this device hasn't dismissed it before
 *   - the visitor didn't deep-link somewhere specific (see App.jsx)
 *
 * Dismissing it — button, backdrop, or Esc — always sets the flag, so it
 * never nags. Signing up is optional; the markets stay browsable either way.
 */
import React, { useEffect, useState } from 'react';
import { useT } from '@app/lib/i18n.js';
import { fetchStats } from '../lib/pointsApi.js';

export const INTRO_SEEN_KEY = 'pronos-points-intro-seen';

export function hasSeenIntro() {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    // Storage blocked (private mode, embedded webview) → behave as if seen.
    // A modal that reappears on every navigation is worse than no modal.
    return true;
  }
}

export function markIntroSeen() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch { /* ignore */ }
}

export default function PointsIntroModal({ open, onClose, onCreateAccount }) {
  const t = useT();
  const [activeCount, setActiveCount] = useState(null);

  // Same number the hero used to show. Endpoint is edge-cached for 60s, and
  // the stat row renders without it, so a failure just omits the count.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    fetchStats()
      .then(s => { if (!cancelled) setActiveCount(s?.activeCount ?? null); })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [open]);

  const dismiss = React.useCallback(() => {
    markIntroSeen();
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  const stats = [
    { value: '500', unit: 'MXNP', label: t('points.hero.stats.welcomeBonus') },
    { value: '100', unit: '+20/día', label: t('points.hero.stats.dailyClaim') },
    ...(activeCount != null
      ? [{ value: String(activeCount), unit: '', label: t('points.hero.stats.activeMarkets') }]
      : []),
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="points-intro-title"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        overflowY: 'auto',
      }}
    >
      <div style={{
        width: 'min(560px, 100%)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 18,
        padding: '30px 28px 26px',
        boxShadow: '0 26px 80px rgba(0,0,0,0.5)',
        position: 'relative',
      }}>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('points.intro.dismiss')}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 20,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 4,
          }}
        >
          ×
        </button>

        <div className="hero-badge" style={{ marginBottom: 18 }}>
          <span className="dot" />
          <span>{t('points.hero.badge')}</span>
        </div>

        <h2
          id="points-intro-title"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(34px, 8vw, 52px)',
            lineHeight: 0.95,
            letterSpacing: '0.01em',
            color: 'var(--text-primary)',
            textTransform: 'uppercase',
            margin: '0 0 16px',
          }}
        >
          {t('points.hero.headline.a')}<br />
          <span style={{ color: 'var(--orange)' }}>{t('points.hero.headline.b')}</span>,<br />
          {t('points.hero.headline.c')}
        </h2>

        {/* Subtitle splits on {strong} sentinels so the emphasized runs
            render as <strong> without dangerouslySetInnerHTML. */}
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--fs-md)',
          lineHeight: 1.55,
          color: 'var(--text-secondary)',
          margin: '0 0 22px',
        }}>
          {t('points.hero.sub').split(/\{\/?strong\}/g).map((chunk, i) => (
            i % 2 === 1
              ? <strong key={i} style={{ color: 'var(--text-primary)' }}>{chunk}</strong>
              : <React.Fragment key={i}>{chunk}</React.Fragment>
          ))}
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => { markIntroSeen(); onClose?.(); onCreateAccount?.(); }}
            style={{ flex: '1 1 180px', padding: '13px 18px' }}
          >
            {t('points.hero.cta.createAccount')}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={dismiss}
            style={{ flex: '1 1 140px', padding: '13px 18px' }}
          >
            {t('points.intro.browse')}
          </button>
        </div>

        <div style={{
          display: 'flex',
          gap: 18,
          flexWrap: 'wrap',
          paddingTop: 18,
          borderTop: '1px solid var(--border)',
        }}>
          {stats.map(s => (
            <div key={s.label} style={{ minWidth: 90 }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-lg)',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: 3,
              }}>
                <span style={{ color: 'var(--orange)' }}>{s.value}</span>
                {s.unit ? ` ${s.unit}` : ''}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-2xs)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                lineHeight: 1.4,
              }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
