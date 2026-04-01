import React, { useState, useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { Link, useNavigate } from 'react-router-dom';
import { POLYGON_CHAIN_ID } from '../lib/clob.js';
import { getProtocolMode, getUsdcAddress, getRequiredChainId } from '../lib/protocol.js';
import MARKETS from '../lib/markets.js';

function getInitialTheme() {
  const saved = localStorage.getItem('pronos-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const MXNB_ABI = ['function balanceOf(address) view returns (uint256)'];

const CHAIN_NAMES = {
  137: 'Polygon',
  42161: 'Arbitrum',
  421614: 'Arb Sepolia',
};

export default function Nav() {
  const navigate = useNavigate();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
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
  const searchRef = useRef(null);

  useEffect(() => {
    if (!authenticated || !user?.id) { setUsername(null); setAdminFlag(false); return; }
    fetch(`/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(r => r.json())
      .then(d => {
        if (d.username) setUsername(d.username);
        setAdminFlag(d.isAdmin === true);
      })
      .catch(() => {});
  }, [authenticated, user?.id]);

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
        const usdc = new ethers.Contract(usdcAddr, MXNB_ABI, provider);
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
        wallet.switchChain(targetChain).then(() => setChainId(targetChain)).catch(() => {});
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
    const wallet = user.wallet?.address;
    if (wallet) return wallet.slice(0, 6) + '…' + wallet.slice(-4);
    return '…';
  })();

  return (
    <nav id="nav" className={scrolled ? 'scrolled' : ''}>
      <a href="/" className="nav-logo">
        PRONOS<span className="green-dot" />
      </a>

      {/* Search bar */}
      <div className="nav-search" ref={searchRef}>
        <div className="nav-search-input-wrap">
          <span className="nav-search-icon">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </span>
          <input
            className="nav-search-input"
            type="text"
            placeholder="Buscar mercados…"
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
            <div className="nav-search-empty">No se encontraron mercados</div>
          </div>
        )}
      </div>

      <div className="nav-links">
        <a href="/mvp/#markets" onClick={e => {
          const el = document.getElementById('markets');
          if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
        }}>El mercado</a>
        <Link to="/portfolio">Portafolio</Link>
        <a href="/mvp/#how-it-works" onClick={e => {
          const el = document.getElementById('how-it-works');
          if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth' }); }
        }}>Cómo funciona</a>
        {adminFlag && <Link to="/admin">Admin</Link>}
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
                      Depositar
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
                    const targetName = protocolMode === 'own' ? 'Arbitrum' : 'Polygon';
                    return (
                      <div className="nav-dropdown-info">
                        <span className="nav-chain-dot" style={wrongChain ? { background: 'var(--red)' } : {}} />
                        {CHAIN_NAMES[chainId] || `Chain ${chainId}`}
                        {wrongChain && (
                          <button
                            className="nav-dropdown-switch"
                            onClick={async () => {
                              const w = wallets?.[0];
                              if (w) {
                                await w.switchChain(expectedChain);
                                setChainId(expectedChain);
                              }
                            }}
                          >
                            Cambiar a {targetName}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {adminFlag && (
                    <Link
                      className="nav-dropdown-item"
                      to="/admin"
                      onClick={() => setDropdownOpen(false)}
                    >
                      Admin
                    </Link>
                  )}
                  <button
                    className="nav-dropdown-item"
                    onClick={() => { logout(); setDropdownOpen(false); }}
                  >
                    Cerrar sesion
                  </button>
                </div>
              )}
            </>
          ) : (
            <button className="btn-nav-cta" onClick={login}>Empieza a predecir</button>
          )}
        </div>
      </div>
    </nav>
  );
}
