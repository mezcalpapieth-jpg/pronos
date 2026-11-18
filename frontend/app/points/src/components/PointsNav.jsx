/**
 * Nav for the points-app.
 *
 * Visual parity with the main pronos.io landing:
 *   - `.nav-logo` wordmark with pulsing `.green-dot` next to it
 *   - `.nav-links` row with Markets, Portfolio (if signed-in), Cómo funciona
 *   - account disclosure with balance and preferences
 *
 * The isolated preview also exposes a test-market selector and token balance.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Menu, Search, Settings2 } from 'lucide-react';
import { Input } from '../ui/index.jsx';
import PointsBottomNav from './PointsBottomNav.jsx';
import { matchesMarketSearch, normalizeSearchText } from '../lib/marketSearch.js';
import { Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT, useLang, setLang } from '@app/lib/i18n.js';
import {
  fetchMarkets,
  adminListTaskCounts,
  fetchClaimableSummary,
  fetchSocialTaskCatalog,
} from '../lib/pointsApi.js';
import { onPointsRefresh } from '../lib/pointsLiveRefresh.js';
import { useExecutionBalance, usePointsExecution } from '../lib/PointsExecution.jsx';
import './PointsNav.css';
import {
  isTournamentSocialTaskSeen,
  onTournamentSocialTaskSeen,
} from '../lib/tournamentSocialTaskNotice.js';
import './points-browse.css';

// Public info pages on pronos.io that explain prediction markets.
const HOW_IT_WORKS_URLS = {
  es: 'https://pronos.io/que-son-los-mercados-de-predicciones',
  en: 'https://pronos.io/what-are-prediction-markets',
};

function formatBalance(value) {
  const numeric = Number(value || 0);
  return numeric.toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

export default function PointsNav({ onOpenLogin, isAdmin, isAdminWorkspace, showBottomNav }) {
  const navigate = useNavigate();
  const location = useLocation();
  const externalPreview = /^\/external-markets(?:\/|$)/.test(location.pathname);
  const marketsPath = externalPreview ? '/external-markets' : '/';
  const [searchParams, setSearchParams] = useSearchParams();
  const { authenticated, user, logout, refresh } = usePointsAuth();
  const execution = usePointsExecution();
  const executionBalance = useExecutionBalance();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [adminTaskTotal, setAdminTaskTotal] = useState(0);
  const [claimableCount, setClaimableCount] = useState(0);
  const [tournamentTaskCount, setTournamentTaskCount] = useState(0);
  const [tournamentTaskNoticeVersion, setTournamentTaskNoticeVersion] = useState(0);
  const dropdownRef = useRef(null);
  const dropdownTrigger = useRef(null);
  const accountPanelId = useId();
  const t = useT();
  const lang = useLang();
  const howItWorksUrl = HOW_IT_WORKS_URLS[lang] || HOW_IT_WORKS_URLS.es;

  // Search: URL mirror (?q=foo) for list filtering on home, PLUS an
  // autocomplete dropdown that navigates straight to a market detail.
  // The dropdown is backed by a local cache of titles fetched once the
  // user focuses the input; we filter client-side for instant results.
  const searchValue = isAdminWorkspace ? '' : searchParams.get('q') || '';
  const [searchCache, setSearchCache] = useState([]);
  const [searchCacheLoaded, setSearchCacheLoaded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  async function ensureSearchCache() {
    if (externalPreview || searchCacheLoaded) return;
    try {
      // "Active" covers public-visible Trending + category tabs + Por
      // resolver; we intentionally don't pull resolved markets since users
      // are almost never trying to jump into one via search.
      const rows = await fetchMarkets({ status: 'active', featured: 'all', limit: 250 });
      setSearchCache(Array.isArray(rows) ? rows : []);
      setSearchCacheLoaded(true);
    } catch {
      setSearchCacheLoaded(true); // mark done so we don't retry-storm
    }
  }

  function handleSearchChange(e) {
    const value = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    if (externalPreview) {
      navigate({ pathname: marketsPath, search: next.toString() }, { replace: true });
      return;
    }
    setSearchOpen(true);
    const categoryGrid = /^\/c\/(?!noticias(?:\/|$)|tradingfestival(?:\/|$))[^/]+\/?$/.test(location.pathname);
    if (location.pathname !== '/' && !categoryGrid) {
      navigate(value ? `/?q=${encodeURIComponent(value)}` : '/');
      return;
    }
    setSearchParams(next, { replace: true });
  }

  const searchResults = useMemo(() => {
    const q = normalizeSearchText(searchValue);
    if (externalPreview || !q) return [];
    return searchCache
      .filter(m => matchesMarketSearch(m, q))
      .slice(0, 8);
  }, [externalPreview, searchCache, searchValue]);

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

  useEffect(() => {
    if (isAdminWorkspace) return undefined;
    function focusSearch(event) {
      if (event.key !== '/' || event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!window.matchMedia('(width >= 720px)').matches) return;
      const target = event.target;
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"], [aria-modal="true"]'))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const field = searchRef.current?.querySelector('input');
      if (!field?.getClientRects().length) return;
      event.preventDefault();
      field.focus();
    }
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [isAdminWorkspace]);

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
      if (!authenticated || !isAdmin || isAdminWorkspace) {
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
    const intervalId = authenticated && isAdmin && !isAdminWorkspace
      ? window.setInterval(loadAdminTaskTotal, 60000)
      : null;
    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [authenticated, isAdmin, isAdminWorkspace, dropdownOpen]);

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
    let cancelled = false;

    async function loadTournamentTaskCount() {
      try {
        const data = await fetchSocialTaskCatalog(null, { surface: 'tournament' });
        const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
        const count = tasks.filter(task =>
          task?.source === 'campaign'
          && task?.hidden
          && task?.status !== 'approved'
          && !isTournamentSocialTaskSeen(task)
        ).length;
        if (!cancelled) setTournamentTaskCount(count);
      } catch {
        if (!cancelled) setTournamentTaskCount(0);
      }
    }

    loadTournamentTaskCount();
    const removeSeenListener = onTournamentSocialTaskSeen(({ alreadySeen } = {}) => {
      if (cancelled) return;
      if (!alreadySeen) setTournamentTaskCount(count => Math.max(0, count - 1));
      setTournamentTaskNoticeVersion(v => v + 1);
    });
    const intervalId = window.setInterval(loadTournamentTaskCount, 60000);
    return () => {
      cancelled = true;
      removeSeenListener();
      window.clearInterval(intervalId);
    };
  }, [authenticated, user?.username, tournamentTaskNoticeVersion]);

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

    function dismissOutside(event) {
      if (!dropdownRef.current?.contains(event.target)) setDropdownOpen(false);
    }

    function dismissWithEscape(event) {
      if (event.key !== 'Escape') return;
      setDropdownOpen(false);
      if (dropdownRef.current?.contains(document.activeElement)) dropdownTrigger.current?.focus();
    }

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissWithEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissWithEscape);
    };
  }, [dropdownOpen]);

  function closeDropdown() {
    setDropdownOpen(false);
  }

  async function handleLogout() {
    closeDropdown();
    await logout();
    navigate('/');
  }

  function handleOpenLogin() {
    closeDropdown();
    onOpenLogin?.();
  }

  const username = user?.username ? `@${user.username}` : t('points.nav.account');
  const balanceLabel = executionBalance.balance == null ? '—' : formatBalance(executionBalance.balance);
  const languageLabelId = `${accountPanelId}-language`;
  const appearanceLabelId = `${accountPanelId}-appearance`;

  return (
    <>
    <nav id="nav" className={`points-nav${scrolled ? ' scrolled' : ''}`}>
      {/* Logo with pulsing green dot — matches .nav-logo .green-dot in
          frontend/css/components.css */}
      <Link to={marketsPath} className="nav-logo" style={{ textDecoration: 'none' }}>
        PRONOS<span className="green-dot" />
      </Link>
      {execution.enabled && <select
        aria-label={lang === 'en' ? 'Trading mode' : 'Modo de operación'}
        value={execution.mode}
        onChange={event => execution.setMode(event.target.value)}
        style={{ maxWidth: 155, padding: '6px 4px', borderRadius: 6, background: 'var(--surface1)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontSize: 11 }}
      >
        <option value="onchain">{lang === 'en' ? 'Test tournament' : 'Torneo de prueba'}</option>
        <option value="points">Points</option>
      </select>}

      {/* Search — sits right next to the logo, expands to fill
          available horizontal space up to the nav-links row. Typing
          updates ?q=<text> in the URL (for home-page list filtering)
          AND opens an autocomplete dropdown that jumps straight to a
          market detail when a result is clicked. */}
      {!isAdminWorkspace && <div
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
        <Search aria-hidden="true" className="points-nav-search-icon" size={16} />
        <Input
          className="points-nav-search-field"
          type="search"
          aria-keyshortcuts="/"
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
        />

        {!searchValue && <kbd className="points-search-shortcut" aria-hidden="true">/</kbd>}
        {!externalPreview && searchOpen && searchValue.trim() && (
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
      </div>}

      <div className="nav-links">
        <Link to={marketsPath} style={navLinkStyle}>{t('points.nav.markets')}</Link>
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
            {execution.mode !== 'onchain' && <Link to="/earn" style={navLinkStyle}>{t('points.nav.earn')}</Link>}
          </>
        )}
        {/* Tournament is public and needs no account to read — it renders
            the prize ladder and the live leaderboard either way. It is
            also the ONLY place the prize ladder lives now that the home
            hero is gone, so gating the link would leave a logged-out
            visitor with no way to find out what they'd be playing for.
            Portfolio and Earn stay gated: both are personal and require
            an account to do anything with. */}
        {(execution.mode !== 'onchain' || execution.tournamentSeason) && <Link to="/torneo" style={navLinkStyle} className="points-nav-link-alert">
          <span>{t('points.nav.tournament')}</span>
          {execution.mode !== 'onchain' && tournamentTaskCount > 0 && (
            <span className="points-nav-alert-badge">
              {tournamentTaskCount > 99 ? '99+' : tournamentTaskCount}
            </span>
          )}
        </Link>}
        <a
          href={howItWorksUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={navLinkStyle}
        >
          {t('points.nav.howItWorks')}
        </a>
      </div>

      <div className="points-nav-actions">
        {!authenticated && (
          <button type="button" className="nav-signup-cta" onClick={handleOpenLogin}>
            {t('points.nav.signUp')}
          </button>
        )}
        <div className="points-account" ref={dropdownRef}>
          <button
            ref={dropdownTrigger}
            type="button"
            className={`points-account-trigger${authenticated ? '' : ' points-account-trigger-guest'}`}
            aria-label={authenticated ? undefined : t('points.nav.menu')}
            aria-expanded={dropdownOpen}
            aria-controls={accountPanelId}
            onClick={() => setDropdownOpen(open => !open)}
          >
            {authenticated ? (
              <>
                <span className="points-account-trigger-name">{username}</span>
                <ChevronDown aria-hidden="true" size={14} />
              </>
            ) : (
              <>
                <Settings2 aria-hidden="true" className="points-account-settings-icon" size={18} />
                <Menu aria-hidden="true" className="points-account-menu-icon" size={18} />
              </>
            )}
          </button>

          <div
            className={`points-account-panel${showBottomNav ? ' points-menu-with-bottom-nav' : ''}`}
            id={accountPanelId}
            hidden={!dropdownOpen}
          >
            {authenticated && (
              <div className="points-account-summary">
                <div className="points-account-name">{username}</div>
                {!user?.username && <p>{t('points.nav.chooseUsername')}</p>}
                <div className="points-account-balance">
                  <span>{t('points.nav.balance')}</span>
                  <strong>{balanceLabel} <span>MXNP</span></strong>
                </div>
              </div>
            )}
            <Link to={marketsPath} onClick={closeDropdown} className="points-account-compact-link points-menu-primary">
              {t('points.nav.markets')}
            </Link>
            {authenticated && (
              <Link to="/portfolio" onClick={closeDropdown} className="points-menu-primary">
                <span>{t('points.nav.portfolio')}</span>
                {claimableCount > 0 && (
                  <span className="points-nav-alert-badge">{claimableCount > 99 ? '99+' : claimableCount}</span>
                )}
              </Link>
            )}
            {(execution.mode !== 'onchain' || execution.tournamentSeason) && <Link to="/torneo" onClick={closeDropdown} className="points-account-compact-link points-menu-primary">
              <span>{t('points.nav.tournament')}</span>
              {execution.mode !== 'onchain' && tournamentTaskCount > 0 && (
                <span className="points-nav-alert-badge">{tournamentTaskCount > 99 ? '99+' : tournamentTaskCount}</span>
              )}
            </Link>}
            <Link to="/support" onClick={closeDropdown}>{lang === 'en' ? 'Support' : 'Soporte'}</Link>
            {authenticated && execution.enabled && <button type="button" onClick={() => { closeDropdown(); execution.openTradingAuthorization(); }}>
              {lang === 'en' ? 'Trading authorization' : 'Autorización de operaciones'}
            </button>}
            {authenticated && execution.mode !== 'onchain' && (
              <Link to="/earn" onClick={closeDropdown} className="points-menu-primary">{t('points.nav.earn')}</Link>
            )}
            <a
              className="points-account-compact-link"
              href={howItWorksUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeDropdown}
            >
              {t('points.nav.howItWorks')}
            </a>
            {isAdmin && (
              <Link to="/admin" onClick={closeDropdown}>
                <span>{t('points.nav.admin')}</span>
                {adminTaskTotal > 0 && (
                  <span className="points-nav-alert-badge points-account-admin-badge">
                    {adminTaskTotal > 99 ? '99+' : adminTaskTotal}
                  </span>
                )}
              </Link>
            )}

            <div className="points-account-preferences">
              <div className="points-account-preference" role="group" aria-labelledby={languageLabelId}>
                <span id={languageLabelId}>{t('points.nav.lang')}</span>
                <div className="points-account-options">
                  <button type="button" aria-label="Español" lang="es" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>ES</button>
                  <button type="button" aria-label="English" lang="en" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
                </div>
              </div>
              <div className="points-account-preference" role="group" aria-labelledby={appearanceLabelId}>
                <span id={appearanceLabelId}>{t('points.nav.appearance')}</span>
                <div className="points-account-options">
                  <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('points.nav.light')}</button>
                  <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('points.nav.dark')}</button>
                </div>
              </div>
            </div>
            {authenticated ? (
              <button type="button" onClick={handleLogout}>{t('points.nav.signOut')}</button>
            ) : (
              <button type="button" className="points-account-mobile-signup" onClick={handleOpenLogin}>
                {t('points.nav.signUp')}
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
    {showBottomNav && (
      <PointsBottomNav
        marketsPath={marketsPath}
        authenticated={authenticated}
        onOpenLogin={onOpenLogin}
        claimableCount={claimableCount}
        tournamentTaskCount={execution.mode === 'onchain' ? 0 : tournamentTaskCount}
        showTournament={execution.mode !== 'onchain' || Boolean(execution.tournamentSeason)}
        showEarn={execution.mode !== 'onchain'}
      />
    )}
    </>
  );
}

const navLinkStyle = {
  fontFamily: 'var(--font-body)',
  fontSize: 'var(--text-sm)',
  color: 'var(--points-caption)',
  textDecoration: 'none',
};
