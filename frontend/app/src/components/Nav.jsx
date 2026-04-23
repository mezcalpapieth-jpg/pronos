/**
 * MVP Nav — Turnkey session + delegated signing, no Privy.
 *
 * Trimmed from the legacy Privy version: no wallet-link flow, no direct
 * chain switching, no USDC balance read. The backend handles all chain
 * interaction via Turnkey-signed txs, and the user's MXNB/MXNP balance
 * comes from the session payload (user.balance) populated by /api/points/auth/me.
 */
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT, useLang, setLang } from '../lib/i18n.js';
import MARKETS from '../lib/markets.js';

function getInitialTheme() {
  const saved = typeof localStorage !== 'undefined' && localStorage.getItem('pronos-theme');
  if (saved) return saved;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const isPublicMarkets = typeof window !== 'undefined' && window.location.pathname.startsWith('/markets');

export default function Nav({ onOpenLogin }) {
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();
  const { loading, authenticated, user, logout } = usePointsAuth();

  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const dropdownRef = useRef(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const mobileSearchInputRef = useRef(null);

  const username = user?.username || null;
  const walletAddress = user?.walletAddress || null;
  const balance = typeof user?.balance === 'number' ? user.balance : null;

  // Client-side admin flag (cosmetic only; server enforces the real rule).
  const adminList = (import.meta.env.VITE_POINTS_ADMIN_USERNAMES || 'mezcal,frmm,alex')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const adminFlag = !!(username && adminList.includes(username.toLowerCase()));

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('pronos-theme', theme); } catch { /* ignore */ }
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

  // Search: filter markets
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResults([]); setSearchOpen(false); return; }
    const results = MARKETS.filter(m => m.title.toLowerCase().includes(q)).slice(0, 6);
    setSearchResults(results);
    setSearchOpen(true);
  }, [searchQuery]);

  // Search: close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearchSelect = (market) => {
    setSearchQuery('');
    setSearchOpen(false);
    navigate(`/market?id=${market.id}`);
  };

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const userLabel = (() => {
    if (!user) return '';
    if (username) return username;
    if (walletAddress) return walletAddress.slice(0, 6) + '…' + walletAddress.slice(-4);
    return '…';
  })();

  const handleLogin = () => { onOpenLogin?.(); };

  return (
    <>
      <nav id="nav" className={scrolled ? 'scrolled' : ''}>
        <a href={isPublicMarkets ? 'https://pronos.io' : '/mvp'} className="nav-logo">
          PRONOS<span className="green-dot" />
        </a>

        {/* Search bar — desktop */}
        <div className="nav-search nav-search-desktop" ref={searchRef}>
          <div className="nav-search-input-wrap">
            <span className="nav-search-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </span>
            <input
              className="nav-search-input"
              type="text"
              placeholder={t('nav.search.placeholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.trim() && setSearchOpen(true)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                if (e.key === 'Enter' && searchResults.length > 0) handleSearchSelect(searchResults[0]);
              }}
            />
            {searchQuery && (
              <button className="nav-search-clear" onClick={() => { setSearchQuery(''); setSearchOpen(false); }}>×</button>
            )}
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="nav-search-dropdown">
              {searchResults.map(m => (
                <button key={m.id} className="nav-search-result" onClick={() => handleSearchSelect(m)}>
                  <span className="nav-search-result-icon">{m.icon}</span>
                  <span className="nav-search-result-text">
                    <span className="nav-search-result-title">{m.title}</span>
                    <span className="nav-search-result-meta">{m.categoryLabel} · {m.deadline}</span>
                  </span>
                  <span className="nav-search-result-pct">{m.options?.[0]?.pct}%</span>
                </button>
              ))}
            </div>
          )}
          {searchOpen && searchQuery.trim() && searchResults.length === 0 && (
            <div className="nav-search-dropdown">
              <div className="nav-search-empty">{t('nav.search.empty')}</div>
            </div>
          )}
        </div>

        <div className="nav-links">
          {isPublicMarkets ? (
            <>
              <a href="https://pronos.io">{t('nav.market')}</a>
              <a href="https://pronos.io">{t('nav.howItWorks')}</a>
            </>
          ) : (
            <>
              <a href="/mvp/#markets" onClick={e => {
                const el = document.getElementById('markets');
                if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
              }}>{t('nav.market')}</a>
              <Link to="/c/world-cup">Mundial 2026</Link>
              <Link to="/portfolio">{t('nav.portfolio')}</Link>
              <a href="/mvp/#how-it-works" onClick={e => {
                const el = document.getElementById('how-it-works');
                if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
              }}>{t('nav.howItWorks')}</a>
              {adminFlag && <Link to="/admin">{t('nav.admin')}</Link>}
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Language toggle */}
          <button
            className="nav-lang-toggle"
            onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            aria-label={lang === 'es' ? 'Switch to English' : 'Cambiar a Español'}
            title={lang === 'es' ? 'Switch to English' : 'Cambiar a Español'}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              padding: '6px 10px',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {lang === 'es' ? 'ES · EN' : 'EN · ES'}
          </button>

          {/* Mobile search icon */}
          <button
            className="nav-search-mobile-btn"
            onClick={() => { setMobileSearchOpen(o => !o); setTimeout(() => mobileSearchInputRef.current?.focus(), 50); }}
            aria-label={t('nav.search.aria')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>

          <button
            className="btn-theme-toggle"
            onClick={toggleTheme}
            title={t('nav.theme')}
          />

          <div style={{ position: 'relative' }} ref={dropdownRef}>
            {loading ? (
              <button className="btn-nav-cta" disabled style={{ opacity: 0.5 }}>…</button>
            ) : authenticated ? (
              <>
                {balance !== null && (
                  <span className="nav-balance">
                    ${balance.toFixed(2)} <span className="nav-balance-label">MXNB</span>
                  </span>
                )}
                <button className="nav-user-pill" onClick={() => setDropdownOpen(o => !o)}>
                  <span className="user-dot" />
                  {userLabel}
                  <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
                </button>
                {dropdownOpen && (
                  <div className="nav-dropdown">
                    <div className="nav-dropdown-info" style={{ display: 'block' }}>
                      <span style={{ display: 'block', marginBottom: 4, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        Wallet
                      </span>
                      <span style={{ display: 'block', color: 'var(--text-primary)' }}>
                        {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Sin wallet'}
                      </span>
                      <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--green)' }}>
                        Firma delegada vía Turnkey
                      </span>
                    </div>
                    {adminFlag && (
                      <Link
                        className="nav-dropdown-item"
                        to="/admin"
                        onClick={() => setDropdownOpen(false)}
                      >
                        {t('nav.admin')}
                      </Link>
                    )}
                    <button
                      className="nav-dropdown-item"
                      onClick={() => { logout(); setDropdownOpen(false); }}
                    >
                      {t('nav.signOut')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button className="btn-nav-cta" onClick={handleLogin}>{t('nav.predict')}</button>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile search bar — slides below nav */}
      {mobileSearchOpen && (
        <div className="nav-search-mobile-bar" ref={searchRef}>
          <div className="nav-search-input-wrap" style={{ width: '100%' }}>
            <span className="nav-search-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </span>
            <input
              ref={mobileSearchInputRef}
              className="nav-search-input"
              type="text"
              placeholder={t('nav.search.placeholder')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setMobileSearchOpen(false); setSearchQuery(''); setSearchOpen(false); }
                if (e.key === 'Enter' && searchResults.length > 0) { handleSearchSelect(searchResults[0]); setMobileSearchOpen(false); }
              }}
              style={{ width: '100%' }}
            />
            <button className="nav-search-clear" onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); setSearchOpen(false); }}>✕</button>
          </div>
          {searchOpen && searchResults.length > 0 && (
            <div className="nav-search-dropdown" style={{ position: 'static', marginTop: 4, borderRadius: 8 }}>
              {searchResults.map(m => (
                <button key={m.id} className="nav-search-result" onClick={() => { handleSearchSelect(m); setMobileSearchOpen(false); }}>
                  <span className="nav-search-result-icon">{m.icon}</span>
                  <span className="nav-search-result-text">
                    <span className="nav-search-result-title">{m.title}</span>
                    <span className="nav-search-result-meta">{m.categoryLabel}</span>
                  </span>
                  <span className="nav-search-result-pct">{m.options?.[0]?.pct}%</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
