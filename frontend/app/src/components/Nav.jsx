import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePrivy, useWallets, useLinkAccount } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { POLYGON_CHAIN_ID } from '../lib/clob.js';
import { getProtocolMode, getUsdcAddress, getRequiredChainId, getChainDisplayName, switchWalletChain } from '../lib/protocol.js';
import MARKETS from '../lib/markets.js';
import { useT, useLang, setLang } from '../lib/i18n.js';
import { authFetch } from '../lib/apiAuth.js';

function getInitialTheme() {
  const saved = localStorage.getItem('pronos-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const isPublicMarkets = typeof window !== 'undefined' && window.location.pathname.startsWith('/markets');

export default function Nav() {
  const navigate = useNavigate();
  const t = useT();
  const lang = useLang();
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [linkingWallet, setLinkingWallet] = useState(false);
  const [walletLinkStatus, setWalletLinkStatus] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [username, setUsername] = useState(null);
  const [adminFlag, setAdminFlag] = useState(false);
  const [balance, setBalance] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [protocolMode, setProtocolModeState] = useState(getProtocolMode);
  const dropdownRef = useRef(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const mobileSearchInputRef = useRef(null);
  const linkedAccounts = user?.linkedAccounts || [];
  const linkedWalletAccount = useMemo(
    () => linkedAccounts.find(account => account.type === 'wallet' || account.type === 'smart_wallet'),
    [linkedAccounts],
  );
  const currentWallet = wallets?.[0] || null;
  const walletAddress = currentWallet?.address || user?.wallet?.address || linkedWalletAccount?.address || null;
  const walletLinked = currentWallet ? currentWallet.linked : Boolean(linkedWalletAccount);

  const { linkWallet } = useLinkAccount({
    onSuccess: () => {
      setLinkingWallet(false);
      setWalletLinkStatus({
        type: 'success',
        msg: 'Wallet vinculada. Si sigues viendo la cuenta equivocada, cierra sesión y vuelve a entrar.',
      });
    },
    onError: (err) => {
      const msg = err?.message || String(err);
      const lower = msg.toLowerCase();
      setLinkingWallet(false);
      setWalletLinkStatus({
        type: 'error',
        msg: lower.includes('another user') || lower.includes('already linked')
          ? 'Esta wallet ya está vinculada a otra cuenta de Privy. Entra con tu login original de frmm y usa este botón desde esa sesión para moverla.'
          : `No se pudo vincular la wallet: ${msg.slice(0, 100)}`,
      });
    },
  });

  useEffect(() => {
    if (!authenticated || !user?.id) { setUsername(null); setAdminFlag(false); return; }
    authFetch(getAccessToken, `/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) return { username: null, isAdmin: false };
        return data;
      })
      .then((d) => {
        if (d.username) setUsername(d.username);
        setAdminFlag(d.isAdmin === true);
      })
      .catch(() => {});
  }, [authenticated, user?.id, getAccessToken]);

  useEffect(() => {
    if (!authenticated) {
      setWalletLinkStatus(null);
      setLinkingWallet(false);
    }
  }, [authenticated]);

  // Fetch USDC balance + chain ID (chain-aware)
  useEffect(() => {
    if (!authenticated) { setBalance(null); setChainId(null); return; }
    const wallet = wallets?.[0];
    if (!wallet) return;
    wallet.getEthereumProvider().then(async (prov) => {
      try {
        const provider = new ethers.providers.Web3Provider(prov);
        const network = await provider.getNetwork();
        setChainId(network.chainId);
        const usdcAddr = getUsdcAddress(network.chainId);
        if (!usdcAddr) { setBalance(null); return; }
        const addr = await provider.getSigner().getAddress();
        const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
        const raw = await usdc.balanceOf(addr);
        setBalance(Number(ethers.utils.formatUnits(raw, 6)));
      } catch {
        setBalance(null);
      }
    });
  }, [authenticated, wallets]);

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

  // Search: filter markets
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResults([]); setSearchOpen(false); return; }
    const results = MARKETS.filter(m => m.title.toLowerCase().includes(q)).slice(0, 6);
    setSearchResults(results);
    setSearchOpen(true);
  }, [searchQuery]);

  // Listen for protocol mode changes (from admin panel toggle)
  useEffect(() => {
    const handler = (e) => {
      setProtocolModeState(e.detail);
      // Auto-switch chain when protocol mode changes
      const wallet = wallets?.[0];
      if (wallet) {
        const targetChain = e.detail === 'own' ? getRequiredChainId() : POLYGON_CHAIN_ID;
        switchWalletChain(wallet, targetChain).then(() => setChainId(targetChain)).catch(() => {});
      }
    };
    window.addEventListener('pronos-protocol-change', handler);
    return () => window.removeEventListener('pronos-protocol-change', handler);
  }, [wallets]);

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

  async function handleLinkWallet() {
    setWalletLinkStatus(null);
    if (currentWallet && currentWallet.linked === false && typeof currentWallet.loginOrLink === 'function') {
      setLinkingWallet(true);
      try {
        await currentWallet.loginOrLink();
        setWalletLinkStatus({
          type: 'success',
          msg: 'Wallet vinculada. Si el admin todavía no aparece, cierra sesión y vuelve a entrar.',
        });
      } catch (err) {
        const msg = err?.message || String(err);
        const lower = msg.toLowerCase();
        setWalletLinkStatus({
          type: 'error',
          msg: lower.includes('another user') || lower.includes('already linked')
            ? 'Esta wallet ya está vinculada a otra cuenta de Privy. Entra con tu login original de frmm y usa este botón desde esa sesión para moverla.'
            : `No se pudo vincular la wallet: ${msg.slice(0, 100)}`,
        });
      } finally {
        setLinkingWallet(false);
      }
      return;
    }

    setWalletLinkStatus({ type: 'info', msg: 'Completa la vinculación en la ventana de Privy.' });
    setLinkingWallet(true);
    linkWallet();
  }

  return (
    <>
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <a href={isPublicMarkets ? 'https://pronos.io' : '/'} className="nav-logo">
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
        {/* Language toggle — flips ES ↔ EN, persists in localStorage */}
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
          {!ready ? (
            <button className="btn-nav-cta" disabled style={{ opacity: 0.5 }}>…</button>
          ) : authenticated ? (
            <>
              {balance !== null && (
                <span className="nav-balance">
                  ${balance.toFixed(2)} <span className="nav-balance-label">USDC</span>
                  {balance === 0 && (
                    <a
                      href={protocolMode === 'own' ? 'https://bridge.arbitrum.io/' : 'https://wallet.polygon.technology/zkEVM-Bridge/bridge'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="nav-deposit-link"
                    >
                      {t('nav.deposit')}
                    </a>
                  )}
                </span>
              )}
              <button className="nav-user-pill" onClick={() => setDropdownOpen(o => !o)}>
                <span className="user-dot" />
                {userLabel}
                <span style={{ marginLeft: 4, opacity: 0.5 }}>▾</span>
              </button>
              {dropdownOpen && (
                <div className="nav-dropdown">
                  {chainId && (() => {
                    const expectedChain = protocolMode === 'own' ? getRequiredChainId() : POLYGON_CHAIN_ID;
                    const wrongChain = chainId !== expectedChain;
                    const targetName = getChainDisplayName(expectedChain);
                    return (
                      <div className="nav-dropdown-info">
                        <span className="nav-chain-dot" style={wrongChain ? { background: 'var(--red)' } : {}} />
                        {getChainDisplayName(chainId)}
                        {wrongChain && (
                          <button
                            className="nav-dropdown-switch"
                            onClick={async () => {
                              const w = wallets?.[0];
                              if (w) {
                                await switchWalletChain(w, expectedChain);
                                setChainId(expectedChain);
                              }
                            }}
                          >
                            {t('nav.switchTo', { chain: targetName })}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  <div className="nav-dropdown-info" style={{ display: 'block' }}>
                    <span style={{ display: 'block', marginBottom: 4, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                      Wallet
                    </span>
                    <span style={{ display: 'block', color: 'var(--text-primary)' }}>
                      {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Sin wallet vinculada'}
                    </span>
                    <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: walletLinked ? 'var(--green)' : 'var(--text-muted)' }}>
                      {walletLinked ? 'Vinculada a esta cuenta' : 'No vinculada a esta cuenta'}
                    </span>
                  </div>
                  {!walletLinked && (
                    <button
                      className="nav-dropdown-item"
                      onClick={handleLinkWallet}
                      disabled={linkingWallet}
                      style={{ opacity: linkingWallet ? 0.6 : 1, cursor: linkingWallet ? 'wait' : 'pointer' }}
                    >
                      {linkingWallet ? 'Vinculando wallet…' : 'Vincular wallet'}
                    </button>
                  )}
                  {walletLinked && !username && (
                    <div
                      className="nav-dropdown-info"
                      style={{ whiteSpace: 'normal', lineHeight: 1.45, color: 'var(--text-secondary)' }}
                    >
                      Si esta no es tu cuenta original, cierra sesión y entra con tu login original de frmm. Desde ahí podrás vincular esta wallet a esa cuenta.
                    </div>
                  )}
                  {walletLinkStatus && (
                    <div
                      className="nav-dropdown-info"
                      style={{
                        color:
                          walletLinkStatus.type === 'error'
                            ? 'var(--red)'
                            : walletLinkStatus.type === 'success'
                              ? 'var(--green)'
                              : 'var(--text-secondary)',
                        whiteSpace: 'normal',
                        lineHeight: 1.45,
                      }}
                    >
                      {walletLinkStatus.msg}
                    </div>
                  )}
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
            <button className="btn-nav-cta" onClick={login}>{t('nav.predict')}</button>
          )}
        </div>
      </div>
    </nav>

    {/* Mobile search bar — slides below nav */}
    {mobileSearchOpen && (
      <div className="nav-search-mobile-bar" ref={searchRef}>
        <div className="nav-search-input-wrap" style={{width:'100%'}}>
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
            style={{width:'100%'}}
          />
          <button className="nav-search-clear" onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); setSearchOpen(false); }}>✕</button>
        </div>
        {searchOpen && searchResults.length > 0 && (
          <div className="nav-search-dropdown" style={{position:'static',marginTop:4,borderRadius:8}}>
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
