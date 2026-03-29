import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import BetModal from '../components/BetModal.jsx';
import { gmFetchBySlug } from '../lib/gamma.js';
import MARKETS from '../lib/markets.js';

/* ── Probability ring chart ──────────────────────────────────── */
function ProbabilityChart({ options, resolved, winner }) {
  if (!options || options.length === 0) return null;

  const top    = options[0];
  const pct    = resolved ? (top.label === winner ? 100 : 0) : top.pct;
  const radius = 54;
  const circ   = 2 * Math.PI * radius;
  const dash   = (pct / 100) * circ;
  const color  = resolved ? 'var(--yes)' : 'var(--green)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface3)" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius} fill="none"
          stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 70 70)"
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
        {resolved ? (
          <>
            <text x="70" y="63" textAnchor="middle" fill="var(--yes)" fontSize="26" fontFamily="var(--font-display)" letterSpacing="0.04em">✓</text>
            <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.1em">GANADOR</text>
          </>
        ) : (
          <>
            <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontFamily="var(--font-display)" letterSpacing="0.04em">{pct}%</text>
            <text x="70" y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">{top.label}</text>
          </>
        )}
      </svg>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {options.map((opt, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-mono)', fontSize: 12,
            color: resolved && opt.label === winner ? 'var(--yes)' : 'var(--text-secondary)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? (resolved ? 'var(--yes)' : 'var(--green)') : 'var(--text-muted)', display: 'inline-block' }} />
            {opt.label} · {opt.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────── */
export default function MarketDetail() {
  const [searchParams] = useSearchParams();
  const navigate       = useNavigate();
  const marketId       = searchParams.get('id');

  const [market,   setMarket]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [betModal, setBetModal] = useState({ open: false, outcome: '', pct: 0, clobTokenId: null, isNegRisk: false });

  useEffect(() => {
    if (!marketId) { navigate('/'); return; }
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const live = await gmFetchBySlug(marketId);
        if (!cancelled) setMarket(live || MARKETS.find(m => m.id === marketId) || null);
      } catch (_) {
        if (!cancelled) setMarket(MARKETS.find(m => m.id === marketId) || null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [marketId, navigate]);

  const openBet = (outcome, pct, optionIndex) => {
    const clobTokenId = market?._clobTokenIds?.[optionIndex ?? 0] ?? null;
    const isNegRisk   = market?._isNegRisk ?? false;
    setBetModal({ open: true, outcome, pct, clobTokenId, isNegRisk });
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
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', marginBottom: 16 }}>Mercado no encontrado</h2>
          <button className="btn-ghost" onClick={() => navigate('/')}>← Volver al inicio</button>
        </div>
      </>
    );
  }

  const resolved = !!market._resolved;

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 48px' }}>

        {/* Back */}
        <button
          onClick={() => navigate('/')}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ← MERCADOS
        </button>

        {/* ── Resolved banner ── */}
        {resolved && (
          <div style={{
            background: 'rgba(22,163,74,0.08)',
            border: '1px solid rgba(22,163,74,0.25)',
            borderRadius: 14,
            padding: '18px 24px',
            marginBottom: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 28 }}>🥊</span>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.12em', marginBottom: 4 }}>MERCADO CERRADO · {market._resolvedDate}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--yes)', letterSpacing: '0.04em' }}>
                  🏆 {market._winnerShort} — Ganador
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                  {market._resolvedBy}
                </div>
              </div>
            </div>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
              padding: '6px 14px', borderRadius: 6,
              background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)',
              color: 'var(--yes)',
            }}>RESUELTO</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 48, alignItems: 'start' }}>

          {/* ── Left ── */}
          <div>
            {/* Category badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>{market.icon}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
                {market.categoryLabel}
              </span>
              {resolved ? (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
                  padding: '3px 8px', borderRadius: 4,
                  background: 'rgba(184,144,10,0.1)', border: '1px solid rgba(184,144,10,0.25)',
                  color: 'var(--gold)',
                }}>CERRADO</span>
              ) : (
                <>
                  {market._source === 'polymarket' && <span className="mock-card-badge live">LIVE</span>}
                  {market.trending && <span className="mock-card-badge trending">🔥 TRENDING</span>}
                </>
              )}
            </div>

            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.5vw, 44px)', letterSpacing: '0.03em', color: 'var(--text-primary)', marginBottom: 24, lineHeight: 1.15 }}>
              {market.title}
            </h1>

            {/* Description (resolved markets) */}
            {resolved && market._description && (
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 28, borderLeft: '3px solid var(--yes)', paddingLeft: 16 }}>
                {market._description}
              </p>
            )}

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 0, borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 36 }}>
              <div style={{ padding: '16px 24px 16px 0', marginRight: 24, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>VOLUMEN</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>${market.volume}</div>
              </div>
              <div style={{ padding: '16px 24px 16px 0', marginRight: 24, borderRight: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>{resolved ? 'CERRÓ' : 'CIERRA'}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--text-primary)' }}>{market.deadline}</div>
              </div>
              <div style={{ padding: '16px 0' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>ESTADO</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: resolved ? 'var(--gold)' : 'var(--green)' }}>
                  {resolved ? 'CERRADO' : 'ACTIVO'}
                </div>
              </div>
            </div>

            {/* Chart */}
            <div style={{ background: 'var(--surface1)', border: '1px solid var(--border)', borderRadius: 16, marginBottom: 24 }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)' }}>
                {resolved ? 'PROBABILIDADES FINALES (ANTES DEL CIERRE)' : 'PROBABILIDAD ACTUAL'}
              </div>
              <ProbabilityChart options={market.options} resolved={resolved} winner={market._winner} />
            </div>

            {/* Outcomes */}
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 12 }}>
                {resolved ? 'RESULTADOS FINALES' : 'RESULTADOS'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(market.options || []).map((opt, i) => {
                  const isWinner = resolved && opt.label === market._winner;
                  const isLoser  = resolved && opt.label !== market._winner;
                  return (
                    <div
                      key={i}
                      style={{
                        background: isWinner ? 'rgba(22,163,74,0.06)' : 'var(--surface1)',
                        border: `1px solid ${isWinner ? 'rgba(22,163,74,0.3)' : 'var(--border)'}`,
                        borderRadius: 12,
                        padding: '16px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        opacity: isLoser ? 0.45 : 1,
                        cursor: resolved ? 'default' : 'pointer',
                        transition: 'border-color 0.2s',
                      }}
                      onClick={() => !resolved && openBet(opt.label, opt.pct, i)}
                      onMouseOver={e => !resolved && (e.currentTarget.style.borderColor = 'var(--border-active)')}
                      onMouseOut={e => !resolved && (e.currentTarget.style.borderColor = 'var(--border)')}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isWinner && <span style={{ fontSize: 16 }}>🏆</span>}
                            <span style={{ fontWeight: 600, fontSize: 15, color: isWinner ? 'var(--yes)' : 'inherit' }}>{opt.label}</span>
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, color: isWinner ? 'var(--yes)' : 'var(--text-secondary)', fontWeight: 500 }}>
                            {opt.pct}%
                          </span>
                        </div>
                        <div style={{ height: 4, background: 'var(--surface3)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${opt.pct}%`, background: isWinner ? 'var(--yes)' : 'var(--text-muted)', borderRadius: 2 }} />
                        </div>
                      </div>
                      {!resolved && (
                        <button
                          className="btn-primary"
                          style={{ padding: '8px 16px', fontSize: 12, flexShrink: 0 }}
                          onClick={e => { e.stopPropagation(); openBet(opt.label, opt.pct, i); }}
                        >
                          Apostar
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Right panel ── */}
          <div style={{ position: 'sticky', top: 88 }}>
            {resolved ? (
              /* Resolved: payout panel */
              <div style={{ background: 'var(--surface1)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 16, padding: 24 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.04em', color: 'var(--yes)', marginBottom: 8 }}>
                  MERCADO RESUELTO
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 20 }}>
                  {market._resolvedDate} · {market._resolvedBy}
                </div>

                <div style={{ background: 'var(--surface2)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 10 }}>GANADOR OFICIAL</div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--yes)', letterSpacing: '0.04em', marginBottom: 4 }}>
                    🏆 {market._winnerShort}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{market._resolvedBy}</div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 12 }}>DESGLOSE</div>
                  {(market.options || []).map((opt, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      <span style={{ color: opt.label === market._winner ? 'var(--yes)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {opt.label === market._winner ? '✓' : '✗'} {opt.label}
                      </span>
                      <span style={{ color: 'var(--text-secondary)' }}>{opt.pct}% pre-cierre</span>
                    </div>
                  ))}
                </div>

                <button
                  disabled
                  style={{
                    width: '100%', marginTop: 20, padding: '12px 0',
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 11,
                    color: 'var(--text-muted)', letterSpacing: '0.08em', cursor: 'not-allowed',
                  }}
                >
                  GANANCIAS YA LIQUIDADAS
                </button>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textAlign: 'center', marginTop: 10 }}>
                  Liquidado on-chain · Polygon · MXNB
                </p>
              </div>
            ) : (
              /* Active: bet panel */
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
                      onClick={() => openBet(opt.label, opt.pct, i)}
                    >
                      {opt.label} · {opt.pct}%
                    </button>
                  ))}
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textAlign: 'center', marginTop: 8 }}>
                  On-chain · Polygon · MXNB
                </p>
              </div>
            )}
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
        clobTokenId={betModal.clobTokenId}
        isNegRisk={betModal.isNegRisk}
      />
    </>
  );
}
