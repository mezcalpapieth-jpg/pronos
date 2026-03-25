import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import BetModal from '../components/BetModal.jsx';
import { gmFetchBySlug } from '../lib/gamma.js';
import MARKETS from '../lib/markets.js';

function ProbabilityChart({ options }) {
  if (!options || options.length === 0) return null;

  const top = options[0];
  const pct = top.pct;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (pct / 100) * circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        {/* Background circle */}
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="var(--surface3)"
          strokeWidth="12"
        />
        {/* Progress arc */}
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="var(--green)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${strokeDash} ${circumference}`}
          transform="rotate(-90 70 70)"
          style={{ filter: 'drop-shadow(0 0 8px var(--green))' }}
        />
        <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontFamily="var(--font-display)" letterSpacing="0.04em">
          {pct}%
        </text>
        <text x="70" y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">
          {top.label}
        </text>
      </svg>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {options.map((opt, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--green)' : 'var(--text-muted)', display: 'inline-block' }} />
            {opt.label} · {opt.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MarketDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const marketId = searchParams.get('id');

  const [market, setMarket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [betModal, setBetModal] = useState({ open: false, outcome: '', pct: 0 });

  useEffect(() => {
    if (!marketId) {
      navigate('/');
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Try Gamma API first
        const live = await gmFetchBySlug(marketId);
        if (!cancelled) {
          if (live) {
            setMarket(live);
          } else {
            // Fall back to local markets
            const local = MARKETS.find(m => m.id === marketId);
            setMarket(local || null);
          }
        }
      } catch (_) {
        if (!cancelled) {
          const local = MARKETS.find(m => m.id === marketId);
          setMarket(local || null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [marketId, navigate]);

  const openBet = (outcome, pct) => {
    setBetModal({ open: true, outcome, pct });
  };

  if (loading) {
    return (
      <>
        <Nav />
        <div style={{ textAlign: 'center', padding: '100px 48px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
          CARGANDO MERCADO…
        </div>
      </>
    );
  }

  if (!market) {
    return (
      <>
        <Nav />
        <div style={{ textAlign: 'center', padding: '100px 48px' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', marginBottom: 16 }}>
            Mercado no encontrado
          </h2>
          <button className="btn-ghost" onClick={() => navigate('/')}>
            ← Volver al inicio
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 48px' }}>
        {/* Back link */}
        <button
          onClick={() => navigate('/')}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← EL MERCADO
        </button>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 48, alignItems: 'start' }}>
          {/* Left: Market info */}
          <div>
            {/* Category badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>{market.icon}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                {market.categoryLabel}
              </span>
              {market._source === 'polymarket' && (
                <span className="mock-card-badge live">LIVE</span>
              )}
              {market.trending && (
                <span className="mock-card-badge trending">🔥 TRENDING</span>
              )}
            </div>

            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.5vw, 44px)', letterSpacing: '0.03em', color: 'var(--text-primary)', marginBottom: 24, lineHeight: 1.15 }}>
              {market.title}
            </h1>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 36 }}>
              <div style={{ padding: '16px 24px 16px 0', marginRight: 24, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>VOLUMEN</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>${market.volume}</div>
              </div>
              <div style={{ padding: '16px 24px 16px 0', marginRight: 24, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>CIERRA</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>{market.deadline}</div>
              </div>
              <div style={{ padding: '16px 0' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>ESTADO</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--green)' }}>ACTIVO</div>
              </div>
            </div>

            {/* Probability chart */}
            <div style={{ background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: 16, marginBottom: 24 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                PROBABILIDAD ACTUAL
              </div>
              <ProbabilityChart options={market.options} />
            </div>

            {/* Outcomes */}
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>
                RESULTADOS
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(market.options || []).map((opt, i) => (
                  <div
                    key={i}
                    style={{
                      background: 'var(--surface1)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                    onMouseOver={e => e.currentTarget.style.borderColor = 'rgba(0,232,122,0.3)'}
                    onMouseOut={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    onClick={() => openBet(opt.label, opt.pct)}
                  >
                    {/* Probability bar */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 15 }}>{opt.label}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: i === 0 ? 'var(--green)' : 'var(--text-secondary)', fontWeight: 500 }}>
                          {opt.pct}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${opt.pct}%`, background: i === 0 ? 'var(--green)' : 'var(--text-muted)', borderRadius: 2 }} />
                      </div>
                    </div>
                    <button className="btn-primary" style={{ padding: '8px 16px', fontSize: 12, flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); openBet(opt.label, opt.pct); }}
                    >
                      Apostar
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Bet panel */}
          <div style={{ position: 'sticky', top: 88 }}>
            <div style={{ background: 'var(--surface1)', border: '1px solid var(--border-active)', borderRadius: 16, padding: 24 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 20 }}>
                COLOCAR APUESTA
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                Elige un resultado en el panel izquierdo para abrir el formulario de apuesta.
              </p>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                {(market.options || []).map((opt, i) => (
                  <button
                    key={i}
                    className={i === 0 ? 'btn-primary' : 'btn-ghost'}
                    style={{ width: '100%', marginBottom: 10 }}
                    onClick={() => openBet(opt.label, opt.pct)}
                  >
                    {opt.label} · {opt.pct}%
                  </button>
                ))}
              </div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textAlign: 'center', marginTop: 8 }}>
                On-chain · Polygon · USDC
              </p>
            </div>
          </div>
        </div>
      </main>

      <BetModal
        open={betModal.open}
        onClose={() => setBetModal(b => ({ ...b, open: false }))}
        outcome={betModal.outcome}
        outcomePct={betModal.pct}
        marketId={market.id}
        marketTitle={market.title}
      />
    </>
  );
}
