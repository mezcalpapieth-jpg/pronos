/**
 * Market detail for the points-app.
 *
 * Mirrors the MVP's detail page behavior: a clean 2-column layout with
 * the market info + mini price chart on the left and a buy panel on the
 * right. Clicking a price button opens PointsBuyModal.
 *
 * Data comes from /api/points/market?id=... — the response contains
 * the market row + its current reserves, outcomes, and prices.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMarket, fetchPriceHistory } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import Sparkline from '@app/components/Sparkline.jsx';
import PointsBuyModal from '../components/PointsBuyModal.jsx';

function formatDeadline(endTime) {
  if (!endTime) return '';
  const d = new Date(endTime);
  return d.toLocaleString('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* Ring chart — same shape as MVP's ProbabilityChart, minus on-chain state */
function ProbabilityRing({ pct, resolved, winner, label }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const dash = (pct / 100) * circ;
  const color = resolved ? (winner ? 'var(--yes)' : 'var(--red, #ef4444)') : 'var(--yes)';

  return (
    <svg width={140} height={140} viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface2)" strokeWidth="12" />
      <circle
        cx="70" cy="70" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        transform="rotate(-90 70 70)"
        style={{ transition: 'stroke-dasharray 0.5s' }}
      />
      <text
        x="70" y="70"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-display)"
        fontSize="30"
        fill="var(--text-primary)"
      >
        {pct}%
      </text>
      <text
        x="70" y="96"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="var(--font-mono)"
        fontSize="10"
        fill="var(--text-muted)"
        letterSpacing="0.1em"
      >
        {label}
      </text>
    </svg>
  );
}

export default function PointsMarketDetail({ onOpenLogin }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id');
  const { authenticated } = usePointsAuth();

  const [market, setMarket] = useState(null);
  const [history, setHistory] = useState(null); // [{t, p}] for outcome 0
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [buyState, setBuyState] = useState(null); // { outcomeIndex, outcomeLabel }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchMarket(id)
      .then(m => {
        if (cancelled) return;
        setMarket(m);
        setLoading(false);
        // Fire-and-forget history fetch. Failures are swallowed inside
        // fetchPriceHistory so they never block the detail page.
        if (m?.id) {
          fetchPriceHistory([m.id], { days: 30, outcome: 0 }).then(h => {
            if (!cancelled) setHistory(h[m.id] || []);
          });
        }
      })
      .catch(e => { if (!cancelled) { setError(e.code || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  function handleBuyClick(outcomeIndex, outcomeLabel) {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    setBuyState({ outcomeIndex, outcomeLabel });
  }

  if (loading) {
    return (
      <div style={{
        textAlign: 'center', padding: '100px 48px',
        fontFamily: 'var(--font-mono)', fontSize: 12,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
      }}>
        Cargando mercado…
      </div>
    );
  }

  if (error || !market) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 48px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', marginBottom: 16 }}>
          Mercado no encontrado
        </h2>
        <button className="btn-ghost" onClick={() => navigate('/')}>← Volver</button>
      </div>
    );
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));
  const winnerIndex = market.status === 'resolved' ? Number(market.outcome) : null;
  const isResolved = winnerIndex != null;
  const isPendingResolution = market.status === 'active' && market.endTime && new Date(market.endTime) < new Date();

  return (
    <>
      <main style={{ padding: '40px 48px', maxWidth: 1160, margin: '0 auto' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 0,
            marginBottom: 24,
          }}
        >
          ← MERCADOS
        </button>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 360px',
          gap: 40,
          alignItems: 'start',
        }}>
          {/* Left column: market info */}
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 10,
            }}>
              {market.icon && `${market.icon} `}{market.category || 'General'}
              {isResolved && (
                <span style={{ marginLeft: 12, color: 'var(--green)' }}>· RESUELTO</span>
              )}
              {isPendingResolution && !isResolved && (
                <span style={{ marginLeft: 12, color: '#f59e0b' }}>· ⏳ PENDIENTE</span>
              )}
            </div>

            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(26px, 3vw, 38px)',
              lineHeight: 1.2,
              color: 'var(--text-primary)',
              marginBottom: 24,
            }}>
              {market.question}
            </h1>

            {/* Big probability ring for 2-outcome markets */}
            {outcomes.length === 2 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 32,
                marginBottom: 32,
                padding: '24px 28px',
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                borderRadius: 14,
              }}>
                <ProbabilityRing
                  pct={Math.round((isResolved ? (winnerIndex === 0 ? 1 : 0) : prices[0]) * 100)}
                  resolved={isResolved}
                  winner={isResolved && winnerIndex === 0}
                  label="Sí"
                />
                <div style={{ flex: 1 }}>
                  {isResolved ? (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
                        RESULTADO OFICIAL
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--green)' }}>
                        🏆 {outcomes[winnerIndex]}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
                        Los ganadores pueden reclamar 1 MXNP por cada acción.
                      </p>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
                        PROBABILIDAD ACTUAL · SÍ
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                        La probabilidad se ajusta con cada trade. Compra más barato cuando hay desacuerdo, más caro cuando hay consenso.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Price history chart — shows the outcome-0 ("Sí/YES")
                probability trajectory over the last 30 days. Hourly
                resolution, filled under the curve, hover for exact
                timestamp + percentage at each snapshot. Falls back to
                a seeded mock when no snapshots exist yet. */}
            <div style={{
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              marginBottom: 24,
            }}>
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.1em',
                color: 'var(--text-muted)',
              }}>
                <span>{isResolved ? 'HISTORIAL DE PRECIO' : 'PRECIO EN TIEMPO REAL'}</span>
                <span>ÚLT. 30 DÍAS</span>
              </div>
              <div style={{ padding: '20px 20px 18px' }}>
                <Sparkline
                  height={140}
                  color="var(--yes)"
                  strokeWidth={2.4}
                  fill={true}
                  showValue={true}
                  valueWidth={60}
                  data={Array.isArray(history) && history.length > 1 ? history : null}
                  targetPct={Math.round((prices[0] ?? 0.5) * 100)}
                  seed={`points-detail-${market.id}-${outcomes[0] || 'yes'}`}
                />
              </div>
            </div>

            {/* Multi-outcome: list all options */}
            {outcomes.length > 2 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 32,
              }}>
                {outcomes.map((label, i) => {
                  const pct = Math.round((isResolved ? (winnerIndex === i ? 1 : 0) : prices[i]) * 100);
                  const isWin = isResolved && winnerIndex === i;
                  return (
                    <div key={i} style={{
                      padding: '18px 16px',
                      background: isWin ? 'rgba(0,232,122,0.08)' : 'var(--surface1)',
                      border: `1px solid ${isWin ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                      borderRadius: 12,
                      opacity: isResolved && !isWin ? 0.5 : 1,
                    }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 6 }}>
                        {label.toUpperCase()}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: isWin ? 'var(--green)' : 'var(--text-primary)' }}>
                        {pct}%
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Meta */}
            <div style={{
              display: 'flex',
              gap: 32,
              padding: '16px 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {isResolved ? 'CERRÓ' : 'CIERRA'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {formatDeadline(market.endTime)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  VOLUMEN
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {Number(market.tradeVolume || market.volume || 0).toLocaleString('es-MX')} MXNP
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  ESTADO
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: isResolved ? 'var(--green)' : isPendingResolution ? '#f59e0b' : 'var(--text-primary)' }}>
                  {isResolved ? 'RESUELTO' : isPendingResolution ? 'PENDIENTE' : 'ACTIVO'}
                </div>
              </div>
            </div>
          </div>

          {/* Right column: buy panel */}
          <aside style={{
            position: 'sticky',
            top: 80,
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 24,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 16,
            }}>
              {isResolved ? 'Mercado cerrado'
               : isPendingResolution ? 'Esperando resolución'
               : outcomes.length > 3 ? 'Trading próximamente'
               : 'Elige un resultado'}
            </div>

            {/* For markets with 4+ outcomes we haven't wired the parallel-
                binary event group path yet — show a read-only notice
                instead of buttons that would error on click. N=2 (binary)
                and N=3 (unified CPMM) are both fully tradeable. */}
            {!isResolved && !isPendingResolution && outcomes.length > 3 && (
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                lineHeight: 1.6,
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '12px 14px',
                margin: 0,
              }}>
                Este mercado tiene <strong>{outcomes.length} opciones</strong>.
                El trading para mercados de 4+ opciones se habilita pronto —
                por ahora puedes ver el mercado pero no comprar.
              </p>
            )}

            {!isResolved && !isPendingResolution && outcomes.length <= 3 && outcomes.map((label, i) => {
              const pct = Math.round(prices[i] * 100);
              // Color accent rotates for 3-outcome markets so Sí/Empate/No
              // feel visually distinct. Binary keeps the green/red pair.
              const MULTI_ACCENTS = [
                { border: 'rgba(22,163,74,0.25)',  bg: 'var(--yes-dim, rgba(22,163,74,0.1))', fg: 'var(--yes)' },
                { border: 'rgba(184,144,10,0.3)',  bg: 'rgba(184,144,10,0.08)',              fg: 'var(--gold, #f59e0b)' },
                { border: 'rgba(255,59,59,0.25)',  bg: 'rgba(255,59,59,0.08)',               fg: '#ff3b3b' },
              ];
              const isBinary = outcomes.length === 2;
              const accent = isBinary
                ? (i === 0 ? MULTI_ACCENTS[0] : MULTI_ACCENTS[2])
                : MULTI_ACCENTS[i] || MULTI_ACCENTS[2];
              return (
                <button
                  key={i}
                  onClick={() => handleBuyClick(i, label)}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    marginBottom: 10,
                    borderRadius: 10,
                    border: `1px solid ${accent.border}`,
                    background: accent.bg,
                    color: accent.fg,
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    transition: 'transform 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  <span style={{ fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Comprar {label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 20 }}>
                    {pct}%
                  </span>
                </button>
              );
            })}

            {(isResolved || isPendingResolution) && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {isResolved
                  ? 'Este mercado ya cerró. Los ganadores pueden reclamar su pago en el portafolio.'
                  : 'Las inversiones están cerradas. El resultado se publicará pronto.'}
              </p>
            )}

            <div style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
              lineHeight: 1.6,
            }}>
              💡 MXNP son puntos de la competencia. Los Top 10 del leaderboard quincenal reciben premios en efectivo.
            </div>
          </aside>
        </div>
      </main>

      {buyState && (
        <PointsBuyModal
          open
          market={market}
          outcomeIndex={buyState.outcomeIndex}
          outcomeLabel={buyState.outcomeLabel}
          onClose={() => setBuyState(null)}
          onSuccess={async () => {
            setBuyState(null);
            // Refresh the market so prices + volume update after the trade.
            try {
              const fresh = await fetchMarket(id);
              setMarket(fresh);
            } catch { /* no-op */ }
          }}
        />
      )}
    </>
  );
}
