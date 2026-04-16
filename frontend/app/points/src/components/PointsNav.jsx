/**
 * Nav for the points-app.
 *
 * Visual parity with the main pronos.io landing:
 *   - `.nav-logo` wordmark with pulsing `.green-dot` next to it
 *   - `.nav-links` row with Markets, Portfolio (if signed-in), Cómo funciona
 *   - `.btn-theme-toggle` circular light/dark switcher
 *   - Green Crear cuenta CTA or balance pill + dropdown when signed-in
 *
 * No wallet-chain UI, no RPC, no Privy — this is an off-chain points app.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';

// Public info page on pronos.io that explains prediction markets. The MVP
// and old landing both link here — we match so the user journey is the same.
const COMO_FUNCIONA_URL = 'https://pronos.io/que-son-los-mercados-de-predicciones';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('pronos-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* ignore */ }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export default function PointsNav({ onOpenLogin, isAdmin }) {
  const navigate = useNavigate();
  const { authenticated, user, logout } = usePointsAuth();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const dropdownRef = useRef(null);

  // Apply theme to <html data-theme> so the shared CSS variables cascade.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pronos-theme', theme); } catch { /* ignore */ }
  }, [theme]);

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
      {/* Logo with pulsing green dot — matches .nav-logo .green-dot in
          frontend/css/components.css */}
      <Link to="/" className="nav-logo" style={{ textDecoration: 'none' }}>
        PRONOS<span className="green-dot" />
      </Link>

      <div style={{ flex: 1 }} />

      <div className="nav-links">
        <Link to="/" style={navLinkStyle}>El mercado</Link>
        {authenticated && (
          <Link to="/portfolio" style={navLinkStyle}>Portafolio</Link>
        )}
        <a
          href={COMO_FUNCIONA_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={navLinkStyle}
        >
          Cómo funciona
        </a>

        {/* Theme toggle — matches .btn-theme-toggle styling */}
        <button
          className="btn-theme-toggle"
          onClick={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          aria-label="Cambiar tema"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>

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
      </div>
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
