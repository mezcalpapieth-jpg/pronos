import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { getClobPositions, getUsdcBalance } from '../lib/clob.js';
import { useT } from '../lib/i18n.js';

function PositionCard({ pos }) {
  const t = useT();
  const value     = Number(pos.currentValue || pos.size || 0).toFixed(2);
  const size      = Number(pos.initialValue || pos.size || 0).toFixed(2);
  const pnl       = (Number(value) - Number(size)).toFixed(2);
  const pnlPos    = Number(pnl) >= 0;
  const outcome   = pos.outcome || pos.title || '—';
  const market    = pos.market?.question || pos.title || pos.marketTitle || '—';
  const pct       = pos.currentPrice != null ? Math.round(pos.currentPrice * 100) : null;

  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Market title */}
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
        {market}
      </p>

      {/* Outcome + probability */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          background: 'var(--green-dim)', color: 'var(--green)',
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
          padding: '3px 10px', borderRadius: 20, letterSpacing: '0.06em',
        }}>
          {outcome}
        </span>
        {pct !== null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
            {pct}% prob
          </span>
        )}
      </div>

      {/* Value row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, letterSpacing: '0.08em' }}>
            {t('pf.staked')}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            ${size} MXNB
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 2, letterSpacing: '0.08em' }}>
            {t('pf.pnl')}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700,
            color: pnlPos ? 'var(--green)' : 'var(--red)',
          }}>
            {pnlPos ? '+' : ''}{pnl} MXNB
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const t = useT();
  const { authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const [positions, setPositions]   = useState([]);
  const [balance, setBalance]       = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [address, setAddress]       = useState(null);

  useEffect(() => {
    if (!authenticated || !wallets?.length) return;
    loadData();
  }, [authenticated, wallets]);

  async function loadData() {
    const wallet = wallets?.[0];
    if (!wallet) return;
    setLoading(true);
    setError(null);
    try {
      const prov    = await wallet.getEthereumProvider();
      const provider = new ethers.providers.Web3Provider(prov);
      const signer  = provider.getSigner();
      const addr    = await signer.getAddress();
      setAddress(addr);

      const [bal, pos] = await Promise.all([
        getUsdcBalance(provider, addr),
        getClobPositions(addr),
      ]);

      setBalance(bal);
      setPositions(Array.isArray(pos) ? pos : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const totalValue = positions.reduce((s, p) => s + Number(p.currentValue || p.size || 0), 0);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 800, margin: '0 auto', padding: '80px 24px 60px' }}>

        <div style={{ marginBottom: 40 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 5vw, 52px)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}>
            {t('pf.title')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
            {t('pf.subtitle')}
          </p>
        </div>

        {!authenticated ? (
          <div style={{
            textAlign: 'center', padding: '80px 24px',
            border: '1px dashed var(--border)', borderRadius: 16,
          }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
              {t('pf.connect')}
            </p>
            <button className="btn-primary" onClick={login}>
              {t('pf.connectBtn')}
            </button>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              marginBottom: 40,
            }}>
              {[
                { label: t('pf.balanceMxnb'),  value: balance != null ? `$${balance.toFixed(2)}` : '—' },
                { label: t('pf.inPositions'),  value: `$${totalValue.toFixed(2)}` },
                { label: t('pf.activeMarkets'), value: positions.length.toString() },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: 'var(--surface1)',
                  border: '1px solid var(--border)',
                  borderRadius: 12, padding: '20px',
                  textAlign: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
                    {label.toUpperCase()}
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
                    {loading ? '…' : value}
                  </div>
                </div>
              ))}
            </div>

            {/* Wallet address */}
            {address && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginBottom: 24 }}>
                Wallet: {address.slice(0, 6)}…{address.slice(-4)}
              </div>
            )}

            {/* Positions */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {t('pf.loading')}
              </div>
            ) : error ? (
              <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13, padding: '20px', background: 'var(--red-dim)', borderRadius: 10 }}>
                {t('pf.error', { msg: error })}
              </div>
            ) : positions.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '60px 24px',
                border: '1px dashed var(--border)', borderRadius: 16,
              }}>
                <p style={{ fontSize: 32, marginBottom: 12 }}>🎯</p>
                <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                  {t('pf.empty')}
                </p>
                <a href="/mvp" className="btn-primary" style={{ display: 'inline-block', marginTop: 20, textDecoration: 'none' }}>
                  {t('pf.viewMarkets')}
                </a>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {positions.map((pos, i) => (
                  <PositionCard key={pos.id || i} pos={pos} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
