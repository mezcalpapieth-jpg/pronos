/**
 * Nav for the points-app.
 *
 * Visual parity with the main pronos.io landing:
 *   - `.nav-logo` wordmark with pulsing `.green-dot` next to it
 *   - `.nav-links` row with Markets, Portfolio (if signed-in), Cómo funciona
 *   - circular light/dark switcher
 *   - Green Crear cuenta CTA or balance pill + dropdown when signed-in
 *
 * No wallet-chain UI, no RPC, no Privy — this is an off-chain points app.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT, useLang, setLang } from '@app/lib/i18n.js';
import { fetchMarkets, adminListTaskCounts, fetchClaimableSummary } from '../lib/pointsApi.js';
import { onPointsRefresh } from '../lib/pointsLiveRefresh.js';

// Public info page on pronos.io that explains prediction markets. The MVP
// and old landing both link here — we match so the user journey is the same.
const COMO_FUNCIONA_URL = 'https://pronos.io/que-son-los-mercados-de-predicciones';

function languageToggleLabel(lang) {
  return lang === 'es' ? 'English' : 'Español';
}

function themeToggleLabel(lang, theme) {
  const targetIsLight = theme === 'dark';
  if (lang === 'en') return targetIsLight ? 'Light mode' : 'Dark mode';
  return targetIsLight ? 'Modo claro' : 'Modo oscuro';
}

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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authenticated, user, logout, refresh } = usePointsAuth();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [adminTaskTotal, setAdminTaskTotal] = useState(0);
  const [claimableCount, setClaimableCount] = useState(0);
  const dropdownRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const t = useT();
  const lang = useLang();

  // Search: URL mirror (?q=foo) for list filtering on home, PLUS an
  // autocomplete dropdown that navigates straight to a market detail.
  // The dropdown is backed by a local cache of titles fetched once the
  // user focuses the input; we filter client-side for instant results.
  const searchValue = searchParams.get('q') || '';
  const [searchCache, setSearchCache] = useState([]);
  const [searchCacheLoaded, setSearchCacheLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  async function ensureSearchCache() {
    if (searchCacheLoaded) return;
    try {
      // "Active" covers Trending + category tabs + Por resolver; we
      // intentionally don't pull resolved markets since users are
      // almost never trying to jump into one via search. Add another
      // fetch if that changes.
      const rows = await fetchMarkets({ status: 'active', featured: 'all', limit: 250 });
      setSearchCache(Array.isArray(rows) ? rows : []);
      setSearchCacheLoaded(true);
    } catch {
      setSearchCacheLoaded(true); // mark done so we don't retry-storm
    }
  }

  function handleSearchChange(e) {
    const value = e.target.value;
    setSearchOpen(true);
    if (location.pathname !== '/') {
      navigate(value ? `/?q=${encodeURIComponent(value)}` : '/');
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }

  const searchResults = useMemo(() => {
    const q = (searchValue || '').trim().toLowerCase();
    if (!q) return [];
    return searchCache
      .filter(m => (m.question || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchCache, searchValue]);

  function handleSearchSelect(market) {
    setSearchOpen(false);
    // Clear the URL's search so we don't navigate back into a filtered
    // view when the user hits Back.
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    setSearchParams(next, { replace: true });
    navigate(`/market?id=${encodeURIComponent(market.id)}`);
  }

  // Close dropdown on outside click.
  useEffect(() => {
    if (!searchOpen) return undefined;
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

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
    let cancelled = false;

    async function loadAdminTaskTotal() {
      if (!authenticated || !isAdmin) {
        if (!cancelled) setAdminTaskTotal(0);
        return;
      }
      try {
        const counts = await adminListTaskCounts();
        if (!cancelled) setAdminTaskTotal(Number(counts?.total || 0));
      } catch {
        if (!cancelled) setAdminTaskTotal(0);
      }
    }

    loadAdminTaskTotal();
    const intervalId = authenticated && isAdmin
      ? window.setInterval(loadAdminTaskTotal, 60000)
      : null;
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [authenticated, isAdmin, dropdownOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadClaimableCount() {
      if (!authenticated) {
        if (!cancelled) setClaimableCount(0);
        return;
      }
      try {
        const summary = await fetchClaimableSummary();
        if (!cancelled) setClaimableCount(Number(summary?.count || 0));
      } catch {
        if (!cancelled) setClaimableCount(0);
      }
    }

    loadClaimableCount();
    const removeRefreshListener = onPointsRefresh(() => {
      loadClaimableCount();
    });
    const intervalId = authenticated
      ? window.setInterval(loadClaimableCount, 20000)
      : null;
    return () => {
      cancelled = true;
      removeRefreshListener();
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [authenticated, user?.username, location.pathname]);

  useEffect(() => {
    if (!authenticated || !refresh) return undefined;
    const refreshBalance = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refresh();
    };
    const intervalId = window.setInterval(refreshBalance, 30000);
    const removeRefreshListener = onPointsRefresh(refreshBalance);
    return () => {
      window.clearInterval(intervalId);
      removeRefreshListener();
    };
  }, [authenticated, refresh]);

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

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const handler = (e) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileMenuOpen]);

  async function handleLogout() {
    setDropdownOpen(false);
    setMobileMenuOpen(false);
    await logout();
    navigate('/');
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  const balance = Number(user?.balance || 0);

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      {/* Logo with pulsing green dot — matches .nav-logo .green-dot in
          frontend/css/components.css */}
      <Link to="/" className="nav-logo" style={{ textDecoration: 'none' }}>
        PRONOS<span className="green-dot" />
      </Link>

      {/* Search — sits right next to the logo, expands to fill
          available horizontal space up to the nav-links row. Typing
          updates ?q=<text> in the URL (for home-page list filtering)
          AND opens an autocomplete dropdown that jumps straight to a
          market detail when a result is clicked. */}
      <div
        className="points-nav-search"
        ref={searchRef}
        style={{
          position: 'relative',
          flex: '1 1 auto',
          maxWidth: 420,
          margin: '0 16px',
          minWidth: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          left: 12,
          top: 16,
          fontSize: 13,
          color: 'var(--text-muted)',
          pointerEvents: 'none',
        }}>
          ⌕
        </span>
        <input
          type="search"
          value={searchValue}
          onChange={handleSearchChange}
          onFocus={() => { ensureSearchCache(); if (searchValue) setSearchOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchResults.length > 0) {
              e.preventDefault();
              handleSearchSelect(searchResults[0]);
            } else if (e.key === 'Escape') {
              setSearchOpen(false);
            }
          }}
          placeholder={t('points.nav.search')}
          aria-label={t('points.nav.search')}
          style={{
            width: '100%',
            padding: '8px 12px 8px 30px',
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />

        {searchOpen && searchValue.trim() && (
          <div style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 10px 32px rgba(0,0,0,0.35)',
            maxHeight: 420,
            overflowY: 'auto',
            zIndex: 1000,
          }}>
            {searchResults.length === 0 ? (
              <div style={{
                padding: '14px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                letterSpacing: '0.04em',
              }}>
                {lang === 'en' ? 'No markets match.' : 'Sin coincidencias.'}
              </div>
            ) : (
              searchResults.map((m) => {
                const prices = Array.isArray(m.prices) ? m.prices : [];
                const topPct = prices.length > 0 ? Math.round(prices[0] * 100) : null;
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSearchSelect(m)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      padding: '10px 14px',
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      alignItems: 'center',
                      gap: 10,
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface2)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span aria-hidden="true" style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--orange)',
                      flex: '0 0 7px',
                    }} />
                    <span style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {m.question}
                    </span>
                    {topPct !== null && (
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--green)',
                        fontWeight: 600,
                      }}>
                        {topPct}%
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="points-mobile-menu" ref={mobileMenuRef}>
        <button
          type="button"
          className="points-mobile-menu-button"
          aria-label={lang === 'en' ? 'Open menu' : 'Abrir menú'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(o => !o)}
        >
          <span />
          <span />
          <span />
        </button>

        {mobileMenuOpen && (
          <div className="points-mobile-menu-panel">
            {authenticated && (
              <div className="points-mobile-menu-user">
                <span>{user?.username ? `@${user.username}` : (lang === 'en' ? 'Signed in' : 'Sesión iniciada')}</span>
                <strong>{balance.toLocaleString('es-MX')} MXNP</strong>
              </div>
            )}
            <Link to="/" onClick={closeMobileMenu}>{t('points.nav.markets')}</Link>
            {authenticated && (
              <>
                <Link to="/portfolio" onClick={closeMobileMenu} className="points-mobile-menu-row">
                  <span>{t('points.nav.portfolio')}</span>
                  {claimableCount > 0 && (
                    <span className="points-mobile-menu-badge">
                      {claimableCount > 99 ? '99+' : claimableCount}
                    </span>
                  )}
                </Link>
                <Link to="/earn" onClick={closeMobileMenu}>{t('points.nav.earn')}</Link>
              </>
            )}
            {/* Public — see the desktop nav for why this one isn't gated. */}
            <Link to="/torneo" onClick={closeMobileMenu}>{t('points.nav.tournament')}</Link>
            <Link to="/support" onClick={closeMobileMenu}>
              {lang === 'en' ? 'Support' : 'Soporte'}
            </Link>
            <a
              href={COMO_FUNCIONA_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMobileMenu}
            >
              {t('points.nav.howItWorks')}
            </a>
            {isAdmin && (
              <Link
                to="/admin"
                onClick={closeMobileMenu}
                className="points-mobile-menu-row"
              >
                <span>{t('points.nav.admin')}</span>
                {adminTaskTotal > 0 && (
                  <span className="points-mobile-menu-badge">
                    {adminTaskTotal > 99 ? '99+' : adminTaskTotal}
                  </span>
                )}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setLang(lang === 'es' ? 'en' : 'es');
                closeMobileMenu();
              }}
            >
              {languageToggleLabel(lang)}
            </button>
            <button
              type="button"
              onClick={() => {
                setTheme(th => (th === 'dark' ? 'light' : 'dark'));
                closeMobileMenu();
              }}
            >
              {themeToggleLabel(lang, theme)}
            </button>
            {!authenticated ? (
              <button
                type="button"
                onClick={() => {
                  closeMobileMenu();
                  onOpenLogin?.();
                }}
              >
                {t('points.nav.signUp')}
              </button>
            ) : (
              <button type="button" onClick={handleLogout}>
                {t('points.nav.signOut')}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="nav-links">
        <Link to="/" style={navLinkStyle}>{t('points.nav.markets')}</Link>
        {authenticated && (
          <>
            <Link to="/portfolio" style={navLinkStyle} className="points-nav-link-alert">
              <span>{t('points.nav.portfolio')}</span>
              {claimableCount > 0 && (
                <span className="points-nav-alert-badge">
                  {claimableCount > 99 ? '99+' : claimableCount}
                </span>
              )}
            </Link>
            <Link to="/earn" style={navLinkStyle}>{t('points.nav.earn')}</Link>
          </>
        )}
        {/* Tournament is public and needs no account to read — it renders
            the prize ladder and the live leaderboard either way. It is
            also the ONLY place the prize ladder lives now that the home
            hero is gone, so gating the link would leave a logged-out
            visitor with no way to find out what they'd be playing for.
            Portfolio and Earn stay gated: both are personal and require
            an account to do anything with. */}
        <Link to="/torneo" style={navLinkStyle}>{t('points.nav.tournament')}</Link>
        <a
          href={COMO_FUNCIONA_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={navLinkStyle}
        >
          {t('points.nav.howItWorks')}
        </a>

        <button
          className="points-lang-toggle"
          onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
          title={lang === 'es' ? 'Switch to English' : 'Cambiar a español'}
          aria-label={t('points.nav.lang')}
        >
          {lang === 'es' ? 'EN' : 'ES'}
        </button>

        <button
          className={`points-theme-toggle ${theme === 'light' ? 'is-on' : ''}`}
          onClick={() => setTheme(th => (th === 'dark' ? 'light' : 'dark'))}
          title={t('points.nav.theme')}
          aria-label={t('points.nav.theme')}
        >
          <span className="points-theme-sun" aria-hidden="true" />
        </button>

        {!authenticated ? (
          <button className="nav-signup-cta" onClick={onOpenLogin}>
            {lang === 'en' ? 'Sign up' : 'Crear cuenta'}
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
                    lang === 'en'
                      ? <>Signed in as <strong>@{user.username}</strong></>
                      : <>Sesión iniciada como <strong>@{user.username}</strong></>
                  ) : (
                    lang === 'en'
                      ? <>Pick a username to finish setup.</>
                      : <>Elige un usuario para completar tu cuenta.</>
                  )}
                </div>
                <Link
                  to="/portfolio"
                  onClick={() => setDropdownOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                >
                  <span>{t('points.nav.portfolio')}</span>
                  {claimableCount > 0 && (
                    <span className="points-nav-alert-badge">
                      {claimableCount > 99 ? '99+' : claimableCount}
                    </span>
                  )}
                </Link>
                <Link to="/support" onClick={() => setDropdownOpen(false)}>
                  {lang === 'en' ? 'Support' : 'Soporte'}
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setDropdownOpen(false)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                  >
                    <span>{t('points.nav.admin')}</span>
                    {adminTaskTotal > 0 && (
                      <span style={{
                        minWidth: 20,
                        height: 20,
                        padding: '0 6px',
                        borderRadius: 999,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(245,158,11,0.16)',
                        border: '1px solid rgba(245,158,11,0.5)',
                        color: 'var(--warning)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        lineHeight: 1,
                        letterSpacing: 0,
                      }}>
                        {adminTaskTotal > 99 ? '99+' : adminTaskTotal}
                      </span>
                    )}
                  </Link>
                )}
                <button onClick={handleLogout}>
                  {t('points.nav.signOut')}
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
