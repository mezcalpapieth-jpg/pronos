/**
 * Landing for /r/:username — someone arrived via a referral link.
 *
 * Stashes the referrer in localStorage, bounces to the home page, and
 * opens the signup modal. When the user finishes picking a username,
 * PointsAuthProvider calls /api/points/referrals/claim-pending with
 * the stashed value so the referrer gets their MXNP credit.
 */
import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const REFERRER_KEY = 'pronos-points-pending-referrer';

// Mirror the backend username rules so we don't cache garbage.
const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export function stashReferrer(username) {
  try {
    if (!USERNAME_RE.test(String(username || '').toLowerCase())) return false;
    localStorage.setItem(REFERRER_KEY, String(username).toLowerCase());
    return true;
  } catch {
    return false;
  }
}

export function consumePendingReferrer() {
  try {
    const v = localStorage.getItem(REFERRER_KEY);
    if (!v) return null;
    localStorage.removeItem(REFERRER_KEY);
    return USERNAME_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function peekPendingReferrer() {
  try {
    return localStorage.getItem(REFERRER_KEY) || null;
  } catch {
    return null;
  }
}

export default function PointsReferralLanding({ onOpenLogin }) {
  const { username } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    stashReferrer(username);
    onOpenLogin?.();
    // Replace so pressing back doesn't loop them back to /r/*
    navigate('/', { replace: true });
  }, [username, navigate, onOpenLogin]);

  // Render something friendly during the brief mount/navigate window.
  return (
    <main style={{
      padding: '80px 48px',
      textAlign: 'center',
      fontFamily: 'var(--font-mono)',
      color: 'var(--text-muted)',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 32,
        color: 'var(--text-primary)',
        marginBottom: 12,
      }}>
        @{username} te invitó 🎁
      </div>
      <p>Abriendo formulario de registro…</p>
    </main>
  );
}
