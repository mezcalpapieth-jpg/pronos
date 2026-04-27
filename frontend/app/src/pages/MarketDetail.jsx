/**
 * MVP market detail — /mvp/market?id=<numericId>.
 *
 * Single fetch path: GET /api/points/market?id=<id>. Mirrors what
 * PointsMarketDetail does on the off-chain side, but renders against
 * mode='onchain' rows so trading flows through the Turnkey-signed
 * BetModal we already have.
 *
 * Drops the legacy gmFetchBySlug / fetchProtocolMarket / MARKETS-static
 * fallback completely. If a Polymarket-sourced market lands here, it
 * arrives via the generator → pending → admin-approve pipeline and
 * carries our own chain_address — Polymarket's chain is never used.
 *
 * Layout (matches Points detail visually):
 *   - Top: category, status badges (LIVE / RESUELTO / POR RESOLVER)
 *   - Question h1
 *   - "FINAL · <score>" strip when resolved + finalScore set
 *   - Ring chart (binary) or compact stat for multi-outcome
 *   - Outcome list with prices + "Apostar" buttons (disabled when resolved)
 *   - Sparkline-style mini price history with final-point snap on resolved
 *   - Reglas / methodology block
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import BetModal from '../components/BetModal.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import Sparkline from '../components/Sparkline.jsx';
import ShareButton from '../components/ShareButton.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 421614);

// Multi-outcome line palette — same hue rotation the Hero uses so
// chart colors stay consistent across the app.
const SERIES_COLORS = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6', '#38BDF8', '#FF5500'];

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function formatDeadline(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// ── Ring chart for binary markets ───────────────────────────────────────────
function ProbabilityRing({ pct, label, resolved, winner }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;
  const color = resolved && !winner ? 'var(--text-muted)' : 'var(--yes)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface3, var(--surface2))" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 70 70)"
          style={{ filter: winner ? `drop-shadow(0 0 8px ${color})` : 'none' }}
        />
        {resolved && winner && (
          <>
            <text x="70" y="63" textAnchor="middle" fill="var(--yes)" fontSize="26" fontFamily="var(--font-display)">✓</text>
            <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-mono)" letterSpacing="0.1em">GANADOR</text>
          </>
        )}
        {!resolved && (
          <>
            <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontFamily="var(--font-display)">{pct}%</text>
            <text x="70" y="84" textAnchor="middle" fill="var(--text-muted)" fontSize="9" fontFamily="var(--font-mono)" letterSpacing="0.1em">{label}</text>
          </>
        )}
      </svg>
    </div>
  );
}

// Snap a price-history series to its final 100/0 endpoint when the
// market is resolved, mirroring what PointsMarketDetail does.
function snapTail(series, isResolved, isWinner, resolvedAt) {
  if (!Array.isArray(series)) return [];
  if (!isResolved) return series;
  const tailT = resolvedAt
    ? Math.floor(new Date(resolvedAt).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  const tailP = isWinner ? 100 : 0;
  const filtered = series.filter(pt => Number(pt.t) <= tailT);
  const last = filtered[filtered.length - 1];
  if (last && last.t === tailT && Math.abs(Number(last.p) - tailP) < 0.5) return filtered;
  return [...filtered, { t: tailT, p: tailP }];
}

function pricesFromReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length < 2) return [];
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default function MarketDetail({ onOpenLogin }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const id = searchParams.get('id');
  const preselectedOutcome = searchParams.get('outcome');
  const { authenticated } = usePointsAuth();

  const [market, setMarket] = useState(null);
  const [historyByOutcome, setHistoryByOutcome] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bet, setBet] = useState(null);

  // Fetch the market on mount / id change.
  useEffect(() => {
    if (!id) { navigate('/'); return; }
    const numericId = Number.parseInt(id, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      setError('invalid_id');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHistoryByOutcome(null);
    (async () => {
      try {
        const { ok, data } = await getJson(`/api/points/market?id=${numericId}`);
        if (!ok) throw new Error(data?.error || 'load_failed');
        if (cancelled) return;
        setMarket(data?.market || null);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, navigate]);

  // Once we have the market, fetch one history series per outcome and
  // snap each to its 100/0 final point if resolved.
  useEffect(() => {
    if (!market) return;
    let cancelled = false;
    const numericId = Number(market.id);
    const isResolved = market.status === 'resolved';
    const winnerIdx = isResolved && market.outcome != null ? Number(market.outcome) : null;

    const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
    if (outcomes.length === 0) {
      setHistoryByOutcome([]);
      return;
    }

    Promise.all(outcomes.map((_, i) =>
      getJson(`/api/points/price-history?ids=${numericId}&days=30&outcome=${i}`)
        .then(r => Array.isArray(r.data?.history?.[numericId]) ? r.data.history[numericId] : [])
        .catch(() => []),
    )).then(seriesArr => {
      if (cancelled) return;
      const snapped = seriesArr.map((s, i) =>
        snapTail(s, isResolved, winnerIdx === i, market.resolvedAt),
      );
      setHistoryByOutcome(snapped);
    });

    return () => { cancelled = true; };
  }, [market]);

  // When the URL has ?outcome=<i> from the Hero deep-link, auto-open
  // the bet modal once the market is loaded so users land in the right
  // buy flow without an extra click.
  useEffect(() => {
    if (!market || preselectedOutcome == null) return;
    const i = Number.parseInt(preselectedOutcome, 10);
    if (!Number.isInteger(i) || i < 0 || i >= (market.outcomes?.length || 0)) return;
    if (market.status !== 'active') return; // skip on resolved
    if (!authenticated) { onOpenLogin?.(); return; }
    const prices = market.prices || pricesFromReserves(market.reserves || []);
    setBet({
      market,
      outcome: market.outcomes[i],
      outcomeIndex: i,
      outcomePct: Math.round((prices[i] || 0) * 100),
    });
  }, [market, preselectedOutcome, authenticated, onOpenLogin]);

  // ── Render shells ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Nav onOpenLogin={onOpenLogin} />
        <div className="category-bar-sticky"><CategoryBar /></div>
        <main style={{ padding: '60px 48px', maxWidth: 1100, margin: '0 auto', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Cargando mercado…
        </main>
        <Footer />
      </>
    );
  }
  if (error || !market) {
    return (
      <>
        <Nav onOpenLogin={onOpenLogin} />
        <div className="category-bar-sticky"><CategoryBar /></div>
        <main style={{ padding: '60px 48px', maxWidth: 720, margin: '0 auto' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-primary)' }}>
            Mercado no encontrado
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)', marginTop: 12 }}>
            {error === 'market_not_found' || error === 'invalid_id'
              ? 'El mercado que buscas no existe o fue archivado.'
              : `Error: ${error || 'sin datos'}`}
          </p>
          <button onClick={() => navigate('/')} className="btn-primary" style={{ marginTop: 18 }}>
            Volver a /mvp
          </button>
        </main>
        <Footer />
      </>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const livePrices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : pricesFromReserves(market.reserves || []);
  const isResolved = market.status === 'resolved';
  const winnerIndex = isResolved && market.outcome != null ? Number(market.outcome) : null;
  const isOnchain = market.mode === 'onchain';
  const isLive = market.status === 'active' && market.startTime &&
    new Date(market.startTime).getTime() <= Date.now() &&
    (!market.endTime || new Date(market.endTime).getTime() > Date.now());
  const isPending = !isResolved && market.status === 'active' && market.endTime &&
    new Date(market.endTime).getTime() < Date.now() && !isLive;

  function pctFor(i) {
    if (isResolved) return winnerIndex === i ? 100 : 0;
    return Math.round((livePrices[i] || 0) * 100);
  }

  function handleBet(i) {
    if (isResolved) return;
    if (!authenticated) { onOpenLogin?.(); return; }
    setBet({
      market,
      outcome: outcomes[i],
      outcomeIndex: i,
      outcomePct: pctFor(i),
    });
  }

  // Sparkline color picker — winner accent on resolved
  const lineColor = (i) => {
    if (isResolved) return winnerIndex === i ? 'var(--yes)' : 'var(--text-muted)';
    return SERIES_COLORS[i % SERIES_COLORS.length];
  };

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky"><CategoryBar /></div>

      <main style={{ padding: '28px 48px 80px', maxWidth: 1100, margin: '0 auto' }}>
        {/* Category + status badges */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.12em', color: 'var(--text-muted)',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          <span>{market.icon ? `${market.icon} ` : ''}{market.category || 'general'}</span>
          {isResolved && <span style={{ color: 'var(--green)' }}>· resuelto</span>}
          {isLive && <span style={{ color: '#dc2626', fontWeight: 700 }}>· en vivo</span>}
          {isPending && !isLive && !isResolved && <span style={{ color: '#f59e0b' }}>· por resolver</span>}
          {isOnchain && (
            <span style={{
              padding: '2px 8px', borderRadius: 6,
              background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.3)',
              color: '#60a5fa',
            }}>
              on-chain · chain {market.chainId || CHAIN_ID}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <ShareButton marketId={market.id} app="mvp" question={market.question} />
        </div>

        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(26px, 3vw, 38px)',
          lineHeight: 1.2,
          color: 'var(--text-primary)',
          marginBottom: isResolved && market.finalScore ? 12 : 22,
        }}>
          {market.question}
        </h1>

        {/* Final-score strip */}
        {isResolved && market.finalScore && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            padding: '8px 14px', borderRadius: 10,
            background: 'var(--surface1)', border: '1px solid var(--border)',
            marginBottom: 22,
            fontFamily: 'var(--font-mono)', fontSize: 13,
            color: 'var(--text-primary)', letterSpacing: '0.03em',
          }}>
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>FINAL</span>
            <span>{market.finalScore}</span>
          </div>
        )}

        {/* Two-column layout: chart + buy panel */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 28,
          alignItems: 'start',
        }}>
          {/* Left: ring + history chart */}
          <section style={{
            padding: 20,
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface1)',
          }}>
            {outcomes.length === 2 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 18 }}>
                <ProbabilityRing
                  pct={pctFor(0)}
                  label={outcomes[0]}
                  resolved={isResolved}
                  winner={isResolved && winnerIndex === 0}
                />
                <div style={{ flex: 1 }}>
                  {isResolved ? (
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--green)' }}>
                      🏆 {outcomes[winnerIndex] || '—'}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Probabilidad implícita
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--text-primary)' }}>
                        {pctFor(0)}%
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {outcomes[0]} · {outcomes[1]} {pctFor(1)}%
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Probabilidades
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {outcomes.map((label, i) => {
                    const pct = pctFor(i);
                    const isWinner = isResolved && winnerIndex === i;
                    return (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 10px', borderRadius: 16,
                        border: `1px solid ${isWinner ? 'rgba(0,232,122,0.35)' : 'var(--border)'}`,
                        background: isWinner ? 'rgba(0,232,122,0.06)' : 'var(--surface2)',
                        fontFamily: 'var(--font-mono)', fontSize: 11,
                        color: isWinner ? 'var(--green)' : 'var(--text-secondary)',
                        opacity: isResolved && !isWinner ? 0.55 : 1,
                      }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: lineColor(i),
                        }} />
                        {label} · {pct}%
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Price history chart */}
            <div style={{
              padding: '10px 4px 4px',
              borderTop: '1px solid var(--border)',
              marginTop: 8,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em',
                color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10,
              }}>
                {isResolved ? 'Historial' : 'Tiempo real'} · 30d
              </div>
              {historyByOutcome === null ? (
                <div style={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  Cargando histórico…
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {outcomes.slice(0, 6).map((label, i) => (
                    <Sparkline
                      key={i}
                      data={historyByOutcome[i] || []}
                      color={lineColor(i)}
                      label={label.length > 11 ? `${label.slice(0, 10)}…` : label}
                      labelWidth={70}
                      showValue
                      valueWidth={48}
                      targetPct={pctFor(i)}
                      seed={`${market.id}-${i}`}
                      height={outcomes.length === 2 ? 70 : 36}
                      fill={i === 0 || (isResolved && winnerIndex === i)}
                      strokeWidth={isResolved && winnerIndex === i ? 2.4 : 1.8}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Right: outcomes + buy buttons */}
          <aside style={{
            padding: 20,
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface1)',
            position: 'sticky', top: 92,
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
              {isResolved ? 'Resultado' : 'Apuesta'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {outcomes.map((label, i) => {
                const pct = pctFor(i);
                const isWinner = isResolved && winnerIndex === i;
                return (
                  <button
                    key={i}
                    onClick={() => handleBet(i)}
                    disabled={isResolved}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid ${isWinner ? 'rgba(0,232,122,0.35)' : 'var(--border)'}`,
                      background: isWinner ? 'rgba(0,232,122,0.08)' : 'var(--surface2)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      cursor: isResolved ? 'default' : 'pointer',
                      opacity: isResolved && !isWinner ? 0.55 : 1,
                    }}
                  >
                    <span style={{ textAlign: 'left' }}>
                      {isWinner && <span style={{ marginRight: 6 }}>🏆</span>}
                      {label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 12,
                      fontWeight: isWinner ? 700 : 500,
                      color: isWinner ? 'var(--green)' : 'var(--text-secondary)',
                    }}>
                      {pct}¢
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: 10,
                      padding: '3px 10px', borderRadius: 6,
                      background: isResolved
                        ? (isWinner ? 'rgba(0,232,122,0.18)' : 'transparent')
                        : 'rgba(0,232,122,0.12)',
                      color: isResolved ? (isWinner ? 'var(--green)' : 'var(--text-muted)') : 'var(--green)',
                      letterSpacing: '0.06em',
                    }}>
                      {isResolved ? (isWinner ? 'GANÓ' : '—') : 'APOSTAR'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
              borderTop: '1px solid var(--border)', paddingTop: 12,
              letterSpacing: '0.04em',
            }}>
              <span>VOL ${Number(market.tradeVolume || 0).toLocaleString('en-US')}</span>
              <span>{market.endTime ? `cierra ${formatDeadline(market.endTime)}` : ''}</span>
            </div>
          </aside>
        </div>

        {/* Reglas / methodology */}
        <section style={{
          marginTop: 32, padding: 20,
          border: '1px solid var(--border)', borderRadius: 14,
          background: 'var(--surface1)',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>
            Reglas
          </div>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            Mercado liquidado en {isOnchain ? 'MXNB on-chain (Arbitrum) con firma delegada vía Turnkey' : 'MXNP off-chain'}.
            {market.resolverType && (
              <> Resolución vía <strong>{market.resolverSource || market.resolverType}</strong>.</>
            )}
            {market.resolvedAt && (
              <> Resuelto el {formatDeadline(market.resolvedAt)}.</>
            )}
          </p>
        </section>
      </main>

      <BetModal
        open={!!bet}
        onClose={() => setBet(null)}
        outcome={bet?.outcome}
        outcomePct={bet?.outcomePct}
        outcomeIndex={bet?.outcomeIndex}
        marketId={bet?.market?.id}
        marketTitle={bet?.market?.question}
        market={bet?.market}
        onOpenLogin={onOpenLogin}
      />

      <Footer />
    </>
  );
}
