import React, { useState, useEffect, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export default function Nav() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Get display label from Privy user
  const userLabel = (() => {
    if (!user) return '';
    if (user.email?.address) {
      const e = user.email.address;
      return e.length > 20 ? e.slice(0, 8) + '…' + e.slice(-8) : e;
    }
    const wallet = user.wallet?.address;
    if (wallet) return wallet.slice(0, 6) + '…' + wallet.slice(-4);
    return 'Usuario';
  })();

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <a href="/" className="nav-logo">
        PRONOS<span className="green-dot" />
      </a>

      <div className="nav-links">
        <a href="#markets">El mercado</a>
        <a href="#portfolio">Portafolio</a>
        <a href="#how-it-works">Cómo funciona</a>
      </div>

      <div style={{ position: 'relative' }} ref={dropdownRef}>
        {!ready ? (
          <button className="btn-nav-cta" disabled style={{ opacity: 0.5 }}>
            …
          </button>
        ) : authenticated ? (
          <>
            <button
              className="nav-user-pill"
              onClick={() => setDropdownOpen(o => !o)}
            >
              <span className="user-dot" />
              {userLabel}
              <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
            </button>
            {dropdownOpen && (
              <div className="nav-dropdown">
                <button
                  className="nav-dropdown-item"
                  onClick={() => { logout(); setDropdownOpen(false); }}
                >
                  Cerrar sesión
                </button>
              </div>
            )}
          </>
        ) : (
          <button className="btn-nav-cta" onClick={login}>
            Conectar
          </button>
        )}
      </div>
    </nav>
  );
}
