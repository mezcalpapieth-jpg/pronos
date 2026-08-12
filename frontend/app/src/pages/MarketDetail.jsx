/**
 * MVP market detail — /mvp/market?id=<numericId>.
 *
 * Single fetch path: GET /api/protocol/market?id=<id>. Reads from
 * the indexer-owned `protocol_markets` table; trading flows through
 * the Turnkey-signed BetModal we already have via /api/protocol/buy.
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
 *   - Outcome list with prices + choose buttons (disabled when resolved)
 *   - Sparkline-style mini price history with final-point snap on resolved
 *   - Reglas / methodology block
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import BetModal from '../components/BetModal.jsx';
import AmmDepthPanel from '../components/AmmDepthPanel.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import LiveScorePanel from '../components/LiveScorePanel.jsx';
import Sparkline from '../components/Sparkline.jsx';
import ShareButton from '../components/ShareButton.jsx';
import TeamMarketStrip from '../components/TeamMarketStrip.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import {
  formatSeriesGameLabel,
  formatSeriesScoreSummary,
  formatSeriesSubtitle,
} from '../lib/seriesDisplay.js';
import {
  finalMarketOptions,
  findChampionsLeagueFinalMarket,
} from '../lib/championsLeague.js';
import { marketInterestPayload, trackInterest } from '../lib/interest.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);

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

function shortGameDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function seriesGameStatus(item) {
  if (item?.status === 'not_needed') return 'No necesario';
  if (item?.status === 'resolved') return 'Final';
  if (item?.placeholder || item?.status === 'pending' || item?.seriesLocked) return 'Pendiente';
  const now = Date.now();
  const start = item?.startTime ? new Date(item.startTime).getTime() : NaN;
  const end = item?.endTime ? new Date(item.endTime).getTime() : NaN;
  if (item?.status === 'active' && Number.isFinite(start) && Number.isFinite(end) && start <= now && end > now) {
    return 'En vivo';
  }
  if (item?.status === 'active' && Number.isFinite(end) && end < now) {
    return 'Por resolver';
  }
  return 'Abierto';
}

function SeriesGameStrip({ seriesMeta, currentMarketId, navigate }) {
  const sequence = Array.isArray(seriesMeta?.sequence) ? seriesMeta.sequence : [];
  if (sequence.length <= 1) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 10,
        fontFamily: 'var(--font-mono)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {seriesMeta.round || 'Serie'}
        </span>
        {formatSeriesScoreSummary(seriesMeta) && (
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            {formatSeriesScoreSummary(seriesMeta)}
          </span>
        )}
      </div>
      <div style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 2,
      }}>
        {sequence.map((item) => {
          const isCurrent = Number(item.id) === Number(currentMarketId);
          const clickable = item.id && !isCurrent && !item.seriesLocked && item.status !== 'pending' && item.status !== 'not_needed';
          const status = seriesGameStatus(item);
          const muted = item.placeholder || item.seriesLocked || item.status === 'not_needed';
          return (
            <button
              key={`${item.gameNumber}-${item.id || item.pendingId || item.status}`}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (clickable) navigate(`/market?id=${encodeURIComponent(item.id)}`);
              }}
              title={item.subtitle || formatSeriesGameLabel(item.gameNumber)}
              style={{
                minWidth: 122,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${isCurrent ? 'rgba(0,232,122,0.45)' : 'var(--border)'}`,
                background: isCurrent ? 'rgba(0,232,122,0.10)' : 'var(--surface1)',
                opacity: muted ? 0.62 : 1,
                cursor: clickable ? 'pointer' : 'default',
                textAlign: 'left',
                flex: '0 0 auto',
              }}
            >
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                color: isCurrent ? 'var(--green)' : 'var(--text-primary)',
                marginBottom: 4,
              }}>
                {formatSeriesGameLabel(item.gameNumber)}
              </span>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: item.status === 'resolved' ? 'var(--green)'
                  : item.status === 'not_needed' ? 'var(--text-muted)'
                  : item.placeholder ? '#f59e0b'
                  : 'var(--text-secondary)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 4,
                whiteSpace: 'nowrap',
              }}>
                {status}
              </span>
              <span style={{
                display: 'block',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                letterSpacing: '0.02em',
                whiteSpace: 'nowrap',
              }}>
                {item.startTime ? shortGameDate(item.startTime) : 'Fecha pendiente'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function outcomeInitials(label) {
  const words = String(label || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return (words.map(word => word[0]).join('') || '?').toUpperCase();
}

// ── Chart watermark (Pronos brand mark, corner-anchored like Polymarket's) ──
function ChartWatermark() {
  return (
    <div style={{position:'absolute',top:1,right:14,opacity:0.5,pointerEvents:'none',userSelect:'none',zIndex:1}}>
      <span style={{fontFamily:'var(--font-mono)',fontSize:12,letterSpacing:'0.02em',color:'var(--text-primary)'}}>pronos.io</span>
    </div>
  );
}

// ── Ring chart for binary markets ───────────────────────────────────────────
function ProbabilityRing({ pct, label, logo, color = 'var(--yes)', resolved, winner }) {
  const radius = 54;
  const circ = 2 * Math.PI * radius;
  const safePct = Math.max(0, Math.min(100, Number(pct) || 0));
  const dash = (safePct / 100) * circ;
  const ringColor = resolved && !winner ? 'var(--text-muted)' : color;
  return (
    <div
      aria-label={`${label} ${safePct}%`}
      style={{
        position: 'relative',
        width: 140,
        height: 140,
        flexShrink: 0,
      }}
    >
      <svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--surface3, var(--surface2))" strokeWidth="12" />
        <circle
          cx="70" cy="70" r={radius} fill="none" stroke={ringColor} strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform="rotate(-90 70 70)"
          style={{ filter: winner ? `drop-shadow(0 0 8px ${ringColor})` : 'none' }}
        />
      </svg>
      <div style={{
        position: 'absolute',
        inset: 24,
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 5,
      }}>
        {logo ? (
          <img
            src={logo}
            alt=""
            style={{ width: 44, height: 44, objectFit: 'contain', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.35))' }}
            onError={(event) => { event.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <span style={{
            width: 44,
            height: 44,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface2)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            fontSize: 17,
          }}>
            {outcomeInitials(label)}
          </span>
        )}
        <span style={{
          color: winner ? 'var(--green)' : 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          lineHeight: 1,
        }}>
          {safePct}%
        </span>
        {resolved && winner && (
          <span style={{
            color: 'var(--green)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Ganador
          </span>
        )}
      </div>
    </div>
  );
}

function ProbabilityGaugeRow({ outcomes, outcomeImages, pctFor, isResolved, winnerIndex, lineColor }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      gap: 12,
      marginTop: 18,
    }}>
      {outcomes.map((label, i) => {
        const isWinner = isResolved && winnerIndex === i;
        return (
          <div
            key={label}
            style={{
              display: 'grid',
              justifyItems: 'center',
              gap: 8,
              padding: '16px 12px',
              border: `1px solid ${isWinner ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              borderRadius: 12,
              background: isWinner ? 'rgba(0,232,122,0.08)' : 'var(--surface2)',
              opacity: isResolved && !isWinner ? 0.58 : 1,
            }}
          >
            <ProbabilityRing
              pct={pctFor(i)}
              label={label}
              logo={outcomeImages?.[i] || null}
              color={lineColor(i)}
              resolved={isResolved}
              winner={isWinner}
            />
            <div style={{
              maxWidth: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: isWinner ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              {label}
            </div>
          </div>
        );
      })}
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
  const isMobile = useIsMobile();

  const [market, setMarket] = useState(null);
  const [historyByOutcome, setHistoryByOutcome] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bet, setBet] = useState(null);
  const [depthOutcomeIndex, setDepthOutcomeIndex] = useState(0);

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
        const { ok, data } = await getJson(`/api/protocol/market?id=${numericId}`);
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

  useEffect(() => {
    if (!market?.id) return;
    trackInterest({
      ...marketInterestPayload('mvp', market, 'view'),
      objectType: 'protocol_market',
      action: 'view',
    });
  }, [market?.id]);

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

  useEffect(() => {
    setDepthOutcomeIndex(0);
  }, [id]);

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
  const outcomeImages = Array.isArray(market.outcomeImages)
    && market.outcomeImages.length === outcomes.length
    ? market.outcomeImages
    : null;
  const outcomeCountryLabels = Array.isArray(market.outcomeCountryLabels)
    && market.outcomeCountryLabels.length === outcomes.length
    ? market.outcomeCountryLabels
    : null;
  const livePrices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : pricesFromReserves(market.reserves || []);
  const championsFinalOptions = findChampionsLeagueFinalMarket([market])
    ? finalMarketOptions(market)
    : null;
  const displayOutcomeIndices = Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.outcomeIndex)
    : outcomes.map((_, i) => i);
  const displayOutcomes = Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.label)
    : outcomes;
  const displayPrices = Array.isArray(championsFinalOptions) && championsFinalOptions.length >= 2
    ? championsFinalOptions.map(option => option.price)
    : livePrices;
  const displayOutcomeImages = displayOutcomeIndices.map(i => outcomeImages?.[i] || null);
  const displayOutcomeCountryLabels = displayOutcomeIndices.map(i => outcomeCountryLabels?.[i] || null);
  const displayHistoryByOutcome = displayOutcomeIndices.map(i => historyByOutcome?.[i] || []);
  const hasAnyDisplayLogo = displayOutcomeImages.some(Boolean);
  const isResolved = market.status === 'resolved';
  const isCanceled = market.status === 'canceled';
  const isDisputed = market.status === 'disputed';
  const winnerIndex = isResolved && market.outcome != null ? Number(market.outcome) : null;
  const displayWinnerIndex = isResolved ? displayOutcomeIndices.indexOf(winnerIndex) : null;
  const isTradingLocked = !isResolved && (market.seriesLocked || market.status !== 'active');
  const lockedLabel = isCanceled ? 'Anulado' : isDisputed ? 'En disputa' : 'Pendiente';
  const seriesSubtitle = formatSeriesSubtitle(market.seriesMeta);
  const isOnchain = market.mode === 'onchain';
  const isLive = typeof market.live === 'boolean'
    ? (!isResolved && market.live)
    : (
        market.status === 'active' && market.startTime &&
        new Date(market.startTime).getTime() <= Date.now() &&
        (!market.endTime || new Date(market.endTime).getTime() > Date.now())
      );
  const isPending = !isResolved && market.status === 'active' && market.endTime &&
    new Date(market.endTime).getTime() < Date.now() && !isLive;

  function pctFor(i) {
    if (isResolved) return displayWinnerIndex === i ? 100 : 0;
    return Math.round((displayPrices[i] || 0) * 100);
  }

  function handleBet(i) {
    setDepthOutcomeIndex(i);
    if (isResolved || isTradingLocked) return;
    if (!authenticated) { onOpenLogin?.(); return; }
    const outcomeIndex = displayOutcomeIndices[i] ?? i;
    setBet({
      market,
      outcome: displayOutcomes[i],
      outcomeIndex,
      outcomePct: pctFor(i),
    });
  }

  // Sparkline color picker — winner accent on resolved
  const lineColor = (i) => {
    if (isResolved) return displayWinnerIndex === i ? 'var(--yes)' : 'var(--text-muted)';
    return SERIES_COLORS[i % SERIES_COLORS.length];
  };

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky"><CategoryBar /></div>

      <main style={{
        padding: isMobile ? '20px 16px 56px' : '28px 48px 80px',
        maxWidth: 1100,
        margin: '0 auto',
      }}>
        {/* Category + status badges */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.12em', color: 'var(--text-muted)',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          <span>{market.category || 'general'}</span>
          {isResolved && <span style={{ color: 'var(--green)' }}>· resuelto</span>}
          {isCanceled && <span style={{ color: 'var(--red, #ef4444)' }}>· anulado</span>}
          {isDisputed && <span style={{ color: '#f59e0b' }}>· en disputa</span>}
          {isLive && <span style={{ color: '#dc2626', fontWeight: 700 }}>· en vivo</span>}
          {isPending && !isLive && !isResolved && <span style={{ color: '#f59e0b' }}>· por resolver</span>}
          {isTradingLocked && !isResolved && !isCanceled && !isDisputed && <span style={{ color: '#f59e0b' }}>· pendiente</span>}
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
          marginBottom: seriesSubtitle ? 8 : (isResolved && market.finalScore ? 12 : 22),
        }}>
          {market.question}
        </h1>

        {seriesSubtitle && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-secondary)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            marginBottom: isResolved && market.finalScore ? 12 : 22,
          }}>
            {seriesSubtitle}
          </div>
        )}

        <TeamMarketStrip market={market} outcomeImages={outcomeImages} />
        <LiveScorePanel market={market} />

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

        {/* Two-column layout: chart + buy panel.
            On phones, stack chart on top of the buy panel (single col)
            so chart + outcome list use the full viewport width. */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile
            ? 'minmax(0, 1fr)'
            : 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: isMobile ? 18 : 28,
          alignItems: 'start',
        }}>
          {/* Left: ring + history chart */}
          <section style={{
            padding: 20,
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface1)',
          }}>
            {displayOutcomes.length === 2 && (
              <div style={{ marginBottom: 16 }}>
                {isResolved ? (
                  <>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 7, textTransform: 'uppercase' }}>
                      Resultado oficial
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--green)' }}>
                      {displayWinnerIndex >= 0 ? displayOutcomes[displayWinnerIndex] : outcomes[winnerIndex] || '—'}
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55 }}>
                    La probabilidad se ajusta con cada trade. Compra más barato cuando hay desacuerdo, más caro cuando hay consenso.
                  </p>
                )}
              </div>
            )}

            {/* Price history chart */}
            <div style={{
              padding: '10px 4px 4px',
              borderTop: displayOutcomes.length === 2 ? '1px solid var(--border)' : 'none',
              marginTop: displayOutcomes.length === 2 ? 8 : 0,
              position: 'relative',
            }}>
              <ChartWatermark />
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
                  {displayOutcomes.slice(0, 6).map((label, i) => (
                    <Sparkline
                      key={i}
                      data={displayHistoryByOutcome[i] || []}
                      color={lineColor(i)}
                      label={label.length > 11 ? `${label.slice(0, 10)}…` : label}
                      labelWidth={70}
                      showValue
                      valueWidth={48}
                      targetPct={pctFor(i)}
                      seed={`${market.id}-${i}`}
                      height={displayOutcomes.length === 2 ? 70 : 36}
                      fill={i === 0 || (isResolved && displayWinnerIndex === i)}
                      strokeWidth={isResolved && displayWinnerIndex === i ? 2.4 : 1.8}
                    />
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 18 }}>
              <SeriesGameStrip
                seriesMeta={market.seriesMeta}
                currentMarketId={market.id}
                navigate={navigate}
              />
            </div>

            {displayOutcomes.length === 2 ? (
              <ProbabilityGaugeRow
                outcomes={displayOutcomes}
                outcomeImages={displayOutcomeImages}
                pctFor={pctFor}
                isResolved={isResolved}
                winnerIndex={displayWinnerIndex}
                lineColor={lineColor}
              />
            ) : (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>
                  Probabilidades
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {displayOutcomes.map((label, i) => {
                    const pct = pctFor(i);
                    const isWinner = isResolved && displayWinnerIndex === i;
                    const logo = displayOutcomeImages?.[i] || null;
                    const countryLabel = displayOutcomeCountryLabels?.[i] || null;
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
                        {logo ? (
                          <img
                            src={logo}
                            alt=""
                            style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }}
                            onError={(event) => { event.currentTarget.style.display = 'none'; }}
                          />
                        ) : hasAnyDisplayLogo ? (
                          <span style={{ width: 18, height: 18, flexShrink: 0 }} aria-hidden="true" />
                        ) : null}
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: lineColor(i),
                        }} />
                        {label} · {pct}%
                        {countryLabel && (
                          <span style={{
                            maxWidth: 90,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            fontSize: 9,
                          }}>
                            {countryLabel}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Right: outcomes + buy buttons */}
          <aside style={{
            padding: 20,
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--surface1)',
            // Sticky only when there's a sibling column to the left.
            // On phones the panel is stacked below the chart and
            // shouldn't follow scroll.
            position: isMobile ? 'static' : 'sticky',
            top: isMobile ? undefined : 92,
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
              {isResolved ? 'Resultado' : isTradingLocked ? lockedLabel : 'Elige un resultado'}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {displayOutcomes.map((label, i) => {
                const pct = pctFor(i);
                const isWinner = isResolved && displayWinnerIndex === i;
                const logo = displayOutcomeImages?.[i] || null;
                const countryLabel = displayOutcomeCountryLabels?.[i] || null;
                return (
                  <button
                    key={i}
                    onClick={() => handleBet(i)}
                    onMouseEnter={() => setDepthOutcomeIndex(i)}
                    onFocus={() => setDepthOutcomeIndex(i)}
                    disabled={isResolved || isTradingLocked}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 10,
                      border: `1px solid ${isWinner ? 'rgba(0,232,122,0.35)' : 'var(--border)'}`,
                      background: isWinner ? 'rgba(0,232,122,0.08)' : 'var(--surface2)',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      cursor: isResolved || isTradingLocked ? 'default' : 'pointer',
                      opacity: isResolved && !isWinner ? 0.55 : 1,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, textAlign: 'left' }}>
                      {logo ? (
                        <img
                          src={logo}
                          alt=""
                          style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0 }}
                          onError={(event) => { event.currentTarget.style.display = 'none'; }}
                        />
                      ) : hasAnyDisplayLogo ? (
                        <span style={{ width: 28, height: 28, flexShrink: 0 }} aria-hidden="true" />
                      ) : null}
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                      {countryLabel && (
                        <span style={{
                          maxWidth: 90,
                          padding: '3px 7px',
                          borderRadius: 999,
                          background: 'var(--surface1)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 9,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          flexShrink: 0,
                        }}>
                          {countryLabel}
                        </span>
                      )}
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
                      {isResolved ? (isWinner ? 'GANÓ' : '—') : isTradingLocked ? lockedLabel.toUpperCase() : 'ELEGIR'}
                    </span>
                  </button>
                );
              })}
            </div>

            <AmmDepthPanel
              marketId={market.id}
              outcomeIndex={displayOutcomeIndices[depthOutcomeIndex] ?? 0}
              outcomeLabel={displayOutcomes[depthOutcomeIndex]}
              disabled={isResolved || isTradingLocked}
            />

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
