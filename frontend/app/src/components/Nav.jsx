import React, { useState, useEffect, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { Link } from 'react-router-dom';
import { MXNB_ADDRESS } from '../lib/clob.js';

function getInitialTheme() {
  const saved = localStorage.getItem('pronos-theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

const MXNB_ABI = ['function balanceOf(address) view returns (uint256)'];

const CHAIN_NAMES = {
  137: 'Polygon',
  8453: 'Base',
  84532: 'Base Sepolia',
};

export default function Nav() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [theme, setTheme] = useState(getInitialTheme);
  const [username, setUsername] = useState(null);
  const [adminFlag, setAdminFlag] = useState(false);
  const [balance, setBalance] = useState(null);
  const [chainId, setChainId] = useState(null);
  const dropdownRef = useRef(null);

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

  // Fetch MXNB balance + chain ID
  useEffect(() => {
    if (!authenticated) { setBalance(null); setChainId(null); return; }
    const wallet = wallets?.[0];
    if (!wallet) return;
    wallet.getEthereumProvider().then(async (prov) => {
      try {
        const provider = new ethers.providers.Web3Provider(prov);
        const network = await provider.getNetwork();
        setChainId(network.chainId);
        const addr = await provider.getSigner().getAddress();
        const mxnb = new ethers.Contract(MXNB_ADDRESS, MXNB_ABI, provider);
        const raw = await mxnb.balanceOf(addr);
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

      <div className="nav-links">
        <a href="#markets">El mercado</a>
        <a href="/mvp/portfolio">Portafolio</a>
        <a href="#how-it-works">Cómo funciona</a>
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
                  {chainId && (
                    <div className="nav-dropdown-info">
                      <span className="nav-chain-dot" />
                      {CHAIN_NAMES[chainId] || `Chain ${chainId}`}
                    </div>
                  )}
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
