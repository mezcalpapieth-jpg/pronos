/**
 * Nav for the points-app.
 *
 * Reuses the landing page / MVP nav container (#nav class) so it visually
 * matches the rest of pronos.io. Replaces the Privy-specific bits with:
 *   - "Crear cuenta" CTA (opens PointsLoginModal) when logged-out
 *   - Green user pill showing balance + username when logged-in
 *   - Dropdown menu with Portfolio, Admin (if admin), Logout
 *
 * No wallet-chain UI, no RPC calls — this is an off-chain app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';

export default function PointsNav({ onOpenLogin, isAdmin }) {
  const navigate = useNavigate();
  const { authenticated, user, logout } = usePointsAuth();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return undefined;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  async function handleLogout() {
    setDropdownOpen(false);
    await logout();
    navigate('/');
  }

  const balance = Number(user?.balance || 0);

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      {/* Logo — matches the main pronos.io landing (plain PRONOS wordmark) */}
      <Link to="/" className="brand" style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        letterSpacing: '0.08em',
        color: 'var(--text-primary)',
        textDecoration: 'none',
      }}>
        PRONOS
      </Link>

      {/* Spacer pushes nav links + auth to the right */}
      <div style={{ flex: 1 }} />

      {/* Links visible to everyone */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginRight: 20 }}>
        <Link to="/" style={navLinkStyle}>Mercados</Link>
        {authenticated && (
          <Link to="/portfolio" style={navLinkStyle}>Portafolio</Link>
        )}
        <a href="#how-it-works" style={navLinkStyle}>Cómo funciona</a>
      </div>

      {/* Auth state */}
      {!authenticated ? (
        <button className="nav-signup-cta" onClick={onOpenLogin}>
          Crear cuenta
        </button>
      ) : (
        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button
            className="nav-user-pill-points"
            onClick={() => setDropdownOpen(o => !o)}
            aria-expanded={dropdownOpen}
          >
            <span className="dot" />
            <span className="balance">{balance.toLocaleString('es-MX')}</span>
            <span style={{ opacity: 0.7 }}>MXNP</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>▾</span>
          </button>

          {dropdownOpen && (
            <div className="nav-dropdown-points">
              <div className="info-row">
                {user?.username ? (
                  <>Sesión iniciada como <strong>@{user.username}</strong></>
                ) : (
                  <>Elige un usuario para completar tu cuenta.</>
                )}
              </div>
              <Link to="/portfolio" onClick={() => setDropdownOpen(false)}>
                Portafolio
              </Link>
              {isAdmin && (
                <Link to="/admin" onClick={() => setDropdownOpen(false)}>
                  Admin
                </Link>
              )}
              <button onClick={handleLogout}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

const navLinkStyle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.06em',
  color: 'var(--text-secondary)',
  textDecoration: 'none',
  textTransform: 'uppercase',
};
