import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { fetchUsername } from '../lib/user.js';

function getInitialTheme() {
  const saved = localStorage.getItem('pronos-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function Nav() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [username, setUsername] = useState(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!authenticated || !user?.id) { setUsername(null); return; }
    const controller = new AbortController();
    fetchUsername(user.id, { signal: controller.signal })
      .then((savedUsername) => { if (savedUsername) setUsername(savedUsername); })
      .catch(() => {});
    return () => controller.abort();
  }, [authenticated, user?.id]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pronos-theme', theme);
  }, [theme]);

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

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const userLabel = (() => {
    if (!user) return '';
    if (username) return username;
    const wallet = user.wallet?.address;
    if (wallet) return wallet.slice(0, 6) + '…' + wallet.slice(-4);
    return '…';
  })();

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <Link to="/" className="nav-logo">
        PRONOS<span className="green-dot" />
      </Link>

      <div className="nav-links">
        <Link to="/#markets">El mercado</Link>
        <Link to="/portfolio">Portafolio</Link>
        <Link to="/#how-it-works">Cómo funciona</Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button
          className="btn-theme-toggle"
          onClick={toggleTheme}
          title="Cambiar tema"
        />

        <div style={{ position: 'relative' }} ref={dropdownRef}>
          {!ready ? (
            <button className="btn-nav-cta" disabled style={{ opacity: 0.5 }}>…</button>
          ) : authenticated ? (
            <>
              <button className="nav-user-pill" onClick={() => setDropdownOpen(o => !o)}>
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
            <button className="btn-nav-cta" onClick={login}>Conectar</button>
          )}
        </div>
      </div>
    </nav>
  );
}
