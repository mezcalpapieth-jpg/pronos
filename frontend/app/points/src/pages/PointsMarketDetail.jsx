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
import { fetchMarket, fetchPriceHistory, fetchPositions } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT } from '@app/lib/i18n.js';
import Sparkline from '@app/components/Sparkline.jsx';
import PointsBuyModal from '../components/PointsBuyModal.jsx';
import MarketComments from '../components/MarketComments.jsx';
import TopHolders from '../components/TopHolders.jsx';

// Accent colors for the multi-line price chart. Match the buy-button
// accents so users recognize the same color for the same outcome.
// Palette wraps at N>8 (rare); MULTI_ACCENTS below is the matched
// border / background variant for the buy buttons.
const OUTCOME_COLORS = [
  'var(--yes)',            // green
  'var(--gold, #f59e0b)',  // gold
  '#ff3b3b',               // red
  '#3b82f6',               // blue
  '#a855f7',               // purple
  '#06b6d4',               // cyan
  '#ec4899',               // pink
  '#84cc16',               // lime
];

const MULTI_ACCENTS = [
  { border: 'rgba(22,163,74,0.25)',  bg: 'var(--yes-dim, rgba(22,163,74,0.1))', fg: 'var(--yes)' },
  { border: 'rgba(184,144,10,0.3)',  bg: 'rgba(184,144,10,0.08)',              fg: 'var(--gold, #f59e0b)' },
  { border: 'rgba(255,59,59,0.25)',  bg: 'rgba(255,59,59,0.08)',               fg: '#ff3b3b' },
  { border: 'rgba(59,130,246,0.3)',  bg: 'rgba(59,130,246,0.08)',              fg: '#3b82f6' },
  { border: 'rgba(168,85,247,0.3)',  bg: 'rgba(168,85,247,0.08)',              fg: '#a855f7' },
  { border: 'rgba(6,182,212,0.3)',   bg: 'rgba(6,182,212,0.08)',               fg: '#06b6d4' },
  { border: 'rgba(236,72,153,0.3)',  bg: 'rgba(236,72,153,0.08)',              fg: '#ec4899' },
  { border: 'rgba(132,204,22,0.3)',  bg: 'rgba(132,204,22,0.08)',              fg: '#84cc16' },
];

function accentFor(i, totalOutcomes) {
  // Binary keeps the canonical green (YES) / red (NO) colors.
  if (totalOutcomes === 2) return i === 0 ? MULTI_ACCENTS[0] : MULTI_ACCENTS[2];
  return MULTI_ACCENTS[i % MULTI_ACCENTS.length];
}

// Map (resolver_type, resolver_config.source) → human-readable source
// name. Brand names stay untranslated — "Chainlink" is "Chainlink" in
// every language.
const RESOLVER_LABELS = {
  'chainlink_price':               'Chainlink',
  'weather_api':                   'Open-Meteo',
  'api_price:finnhub':             'Finnhub',
  'api_price:banxico-fix':         'Banxico',
  'api_price:cre-gasolina':        'CRE',
  'api_chart:apple-mx-songs':      'Apple Music',
  'api_chart:youtube-trending-mx': 'YouTube',
  'sports_api:espn':               'ESPN',
  'sports_api:football-data':      'football-data.org',
  'sports_api:jolpica-f1':         'Jolpica F1',
};

function resolverLabel(type, source) {
  if (!type) return null; // null = admin-manual; surface as 'Admin' via fallback text
  const composite = source ? `${type}:${source}` : type;
  return RESOLVER_LABELS[composite] || RESOLVER_LABELS[type] || type;
}

// ─── Outcome pickers ────────────────────────────────────────────────────────
// Unified: one tap-target per outcome ("Sí" / "No" / "Barcelona" …) showing
// the current percentage. Tapping opens the buy modal for that outcome at
// the shared pool.
//
// Layout: when the generator supplied a logo for this outcome, it sits
// on the LEFT outside the "pill" (the pill contains only the price).
// This matches the card layout and gives crests/logos room to breathe.
//
// Scroll: when a market has > SCROLL_AT_N outcomes (F1 has 21), the list
// is wrapped in a fixed-height scroll container by the caller, so the
// detail page doesn't turn into an endless vertical stack.
const SCROLL_AT_N = 6;

function OutcomeLogo({ src }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      style={{
        width: 28,
        height: 28,
        objectFit: 'contain',
        flexShrink: 0,
      }}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

function ScrollableList({ count, children }) {
  if (count <= SCROLL_AT_N) return <>{children}</>;
  return (
    <div style={{
      maxHeight: 360,
      overflowY: 'auto',
      paddingRight: 4,
      // Subtle scroll shadow so users see there's more below.
      WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
      maskImage: 'linear-gradient(to bottom, black calc(100% - 24px), transparent 100%)',
    }}>
      {children}
    </div>
  );
}

function UnifiedOutcomeList({ outcomes, prices, outcomeImages, market, onBuyClick }) {
  return (
    <ScrollableList count={outcomes.length}>
      {outcomes.map((label, i) => {
        const pct = Math.round((prices[i] ?? 0) * 100);
        const accent = accentFor(i, outcomes.length);
        const logo = outcomeImages?.[i] || null;
        return (
          <button
            key={i}
            onClick={() => onBuyClick(market, i, label)}
            style={{
              width: '100%',
              padding: '10px 14px 10px 10px',
              marginBottom: 8,
              borderRadius: 10,
              border: `1px solid ${accent.border}`,
              background: accent.bg,
              color: accent.fg,
              fontFamily: 'var(--font-mono)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'transform 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <OutcomeLogo src={logo} />
            <span style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {label}
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, flexShrink: 0 }}>
              {pct}%
            </span>
          </button>
        );
      })}
    </ScrollableList>
  );
}

// Parallel: each row is a binary Sí/No market. Rendered Polymarket-style:
// label + aggregated %, then compact Sí / No buttons with each side's
// current price. Clicking either opens the buy modal against the leg.
//
// Leg images come from the parent market's `outcomeImages[i]` — the
// parallel parent stores one image per outcome (e.g. driver portraits
// when/if we wire that up), index-aligned with the leg order.
function ParallelLegList({ market, legs, outcomeImages, onBuyClick }) {
  return (
    <ScrollableList count={legs.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {legs.map((leg, i) => {
          const accent = accentFor(i, legs.length);
          const yesPrice = leg.prices?.[0] ?? 0.5;
          const noPrice  = leg.prices?.[1] ?? 1 - yesPrice;
          const pct = Math.round(yesPrice * 100);
          const logo = outcomeImages?.[i] || null;
          const legMarket = {
            id: leg.id,
            question: `${market.question} — ${leg.label}`,
          };
          return (
            <div
              key={leg.id}
              style={{
                // Flex with wrap so long leg labels (golfer names,
                // driver names) get the full row width they need and
                // the Sí/No buttons drop to a second line cleanly
                // instead of colliding into the name column.
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${accent.border}`,
                background: accent.bg,
              }}
            >
              {logo && <OutcomeLogo src={logo} />}
              <div style={{
                flex: '1 1 200px',
                minWidth: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 600,
                color: accent.fg,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {leg.label}
              </div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                color: accent.fg,
                minWidth: 48,
                textAlign: 'right',
                flexShrink: 0,
              }}>
                {pct}%
              </div>
              <div style={{
                display: 'flex',
                gap: 6,
                flexShrink: 0,
                // Push the buttons to the right edge when the row
                // has enough width; wrap to a new line below the
                // label when there's not.
                marginLeft: 'auto',
              }}>
                <button
                  onClick={() => onBuyClick(legMarket, 0, `${leg.label} — Sí`)}
                  style={legButtonStyle('var(--yes)', 'rgba(22,163,74,0.15)', 'rgba(22,163,74,0.4)')}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  Sí <span style={legPriceStyle}>{Math.round(yesPrice * 100)}¢</span>
                </button>
                <button
                  onClick={() => onBuyClick(legMarket, 1, `${leg.label} — No`)}
                  style={legButtonStyle('#ff3b3b', 'rgba(255,59,59,0.12)', 'rgba(255,59,59,0.4)')}
                  onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                >
                  No <span style={legPriceStyle}>{Math.round(noPrice * 100)}¢</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollableList>
  );
}

// Read-only price summary shown on the right side of parallel markets.
// Each row: label on the left (swatch in the outcome's accent), % on the
// right. No buttons — the actual buying happens in the leg list below
// the chart. Keeps the sidebar quick to scan.
function OddsSummary({ outcomes, prices, outcomeImages }) {
  return (
    <ScrollableList count={outcomes.length}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {outcomes.map((label, i) => {
          const accent = accentFor(i, outcomes.length);
          const pct = Math.round((prices[i] ?? 0) * 100);
          const logo = outcomeImages?.[i] || null;
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
              }}
            >
              {logo ? (
                <OutcomeLogo src={logo} />
              ) : (
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: accent.fg,
                  flexShrink: 0,
                }} />
              )}
              <span style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                color: 'var(--text-primary)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {label}
              </span>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                color: accent.fg,
                minWidth: 38,
                textAlign: 'right',
              }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </ScrollableList>
  );
}

function legButtonStyle(fg, bg, border) {
  return {
    padding: '6px 10px',
    borderRadius: 8,
    border: `1px solid ${border}`,
    background: bg,
    color: fg,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.04em',
    cursor: 'pointer',
    display: 'inline-flex',
    gap: 6,
    alignItems: 'center',
    transition: 'transform 0.15s',
    whiteSpace: 'nowrap',
  };
}
const legPriceStyle = {
  fontFamily: 'var(--font-display)',
  fontSize: 12,
  opacity: 0.9,
};

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
  const { authenticated, user } = usePointsAuth();
  const t = useT();

  const [market, setMarket] = useState(null);
  // historyByOutcome[i] = [{t, p}] for outcome i. Populated for every
  // outcome so the chart can render one line per option on multi markets.
  const [historyByOutcome, setHistoryByOutcome] = useState(null);
  const [userPositions, setUserPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // buyState.market is the effective trade target:
  //   unified → the parent market itself
  //   parallel → the individual leg market (so the buy endpoint hits the
  //              leg's binary CPMM, not the aggregated parent)
  const [buyState, setBuyState] = useState(null);

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
        if (!m) return;

        // Fire-and-forget price-history fetch. Shape differs by AMM mode:
        //   Unified: one call per outcome on the parent market id (the
        //   snapshot job stores a price per outcome in one row).
        //   Parallel: one call per leg — each leg is its own binary
        //   market, snapshotted independently — and we pull the YES
        //   (outcome 0) series to plot the per-outcome line.
        if (m.ammMode === 'parallel' && Array.isArray(m.legs)) {
          Promise.all(
            m.legs.map(leg =>
              fetchPriceHistory([leg.id], { days: 30, outcome: 0 })
                .then(h => h[leg.id] || [])
                .catch(() => []),
            ),
          ).then(series => {
            if (!cancelled) setHistoryByOutcome(series);
          });
        } else if (Array.isArray(m.outcomes)) {
          const n = m.outcomes.length;
          Promise.all(
            Array.from({ length: n }, (_, i) =>
              fetchPriceHistory([m.id], { days: 30, outcome: i })
                .then(h => h[m.id] || [])
                .catch(() => []),
            ),
          ).then(series => {
            if (!cancelled) setHistoryByOutcome(series);
          });
        }
      })
      .catch(e => { if (!cancelled) { setError(e.code || e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [id]);

  // Fetch the signed-in user's positions. For parallel markets, positions
  // live on leg ids but positions.js surfaces the parent id via
  // `parentMarketId` — so we match on either to pick up both modes.
  useEffect(() => {
    if (!authenticated || !id) {
      setUserPositions([]);
      return undefined;
    }
    let cancelled = false;
    fetchPositions()
      .then(r => {
        if (cancelled) return;
        const mid = Number(id);
        const mine = (r.positions || []).filter(p => {
          if (Number(p.shares) <= 0) return false;
          return Number(p.marketId) === mid || Number(p.parentMarketId) === mid;
        });
        setUserPositions(mine);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [authenticated, id, buyState]);

  function handleBuyClick(target, outcomeIndex, outcomeLabel) {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    setBuyState({ market: target, outcomeIndex, outcomeLabel });
  }

  if (loading) {
    return (
      <div style={{
        textAlign: 'center', padding: '100px 48px',
        fontFamily: 'var(--font-mono)', fontSize: 12,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
      }}>
        {t('points.detail.loading')}
      </div>
    );
  }

  if (error || !market) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 48px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--text-primary)', marginBottom: 16 }}>
          {t('points.detail.marketNotFound')}
        </h2>
        <button className="btn-ghost" onClick={() => navigate('/')}>{t('points.detail.back')}</button>
      </div>
    );
  }

  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));
  const winnerIndex = market.status === 'resolved' ? Number(market.outcome) : null;
  const isResolved = winnerIndex != null;
  // isLive wins over isPendingResolution when start_time has passed
  // but end_time hasn't — the game is in progress and trading stays
  // open. Only sports markets set start_time; everything else falls
  // back to isPendingResolution semantics.
  const _now = new Date();
  const isLive = !isResolved
    && market.status === 'active'
    && market.startTime
    && new Date(market.startTime) <= _now
    && (!market.endTime || new Date(market.endTime) > _now);
  const isPendingResolution = !isResolved
    && !isLive
    && market.status === 'active'
    && market.endTime
    && new Date(market.endTime) < _now;

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
          {t('points.detail.backToMarkets')}
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
                <span style={{ marginLeft: 12, color: 'var(--green)' }}>{t('points.detail.resolvedBadge')}</span>
              )}
              {isLive && (
                <span style={{
                  marginLeft: 12,
                  color: '#dc2626',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  animation: 'pronos-live-pulse 1.4s ease-in-out infinite',
                }}>
                  · {t('points.card.live')}
                </span>
              )}
              {isPendingResolution && !isResolved && !isLive && (
                <span style={{ marginLeft: 12, color: '#f59e0b' }}>{t('points.detail.pendingBadge')}</span>
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
                        {t('points.detail.resultOfficial')}
                      </div>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--green)' }}>
                        🏆 {outcomes[winnerIndex]}
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
                        {t('points.detail.redeemInstructions')}
                      </p>
                    </>
                  ) : (
                    <>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8 }}>
                        {t('points.detail.probNow')}
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
                        {t('points.detail.probExplain')}
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
                <span>{isResolved ? t('points.detail.priceHistory') : t('points.detail.priceRealtime')}</span>
                <span>{t('points.detail.last30d')}</span>
              </div>
              <div style={{ padding: '20px 20px 18px' }}>
                {/* One sparkline per outcome. For binary markets we show
                    a taller chart with just the YES line (equivalent to
                    the NO line mirrored, no extra info). For 3+ outcome
                    markets we stack smaller sparklines so the user sees
                    every curve — one color per option, matching the buy
                    buttons below. */}
                {outcomes.length <= 2 ? (
                  <Sparkline
                    height={140}
                    color={OUTCOME_COLORS[0]}
                    strokeWidth={2.4}
                    fill={true}
                    showValue={true}
                    valueWidth={60}
                    data={
                      historyByOutcome && historyByOutcome[0] && historyByOutcome[0].length > 1
                        ? historyByOutcome[0]
                        : null
                    }
                    targetPct={Math.round((prices[0] ?? 0.5) * 100)}
                    seed={`points-detail-${market.id}-${outcomes[0] || 'yes'}`}
                  />
                ) : (
                  // Chart shows up to FOUR lines. When a market has
                  // more than four outcomes (F1, election-style
                  // markets) we pick the four with the highest
                  // current odds — every other line would just be a
                  // flat zero-ish trace crowding the chart. Color
                  // stays tied to the outcome's ORIGINAL index so
                  // it matches the color in the buy-list below.
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(() => {
                      const chartIndices = outcomes.length <= 4
                        ? outcomes.map((_, i) => i)
                        : [...outcomes.keys()]
                            .sort((a, b) => (prices[b] ?? 0) - (prices[a] ?? 0))
                            .slice(0, 4);
                      return chartIndices.map((i) => {
                        const label = outcomes[i];
                        const color = OUTCOME_COLORS[i % OUTCOME_COLORS.length];
                        const series = historyByOutcome && historyByOutcome[i];
                        return (
                          <Sparkline
                            key={i}
                            height={48}
                            color={color}
                            strokeWidth={2}
                            fill={i === chartIndices[0]}
                            showValue={true}
                            valueWidth={44}
                            label={label.length > 10 ? label.slice(0, 9) + '…' : label}
                            labelWidth={84}
                            data={Array.isArray(series) && series.length > 1 ? series : null}
                            targetPct={Math.round((prices[i] ?? 1 / outcomes.length) * 100)}
                            seed={`points-detail-${market.id}-${label || 'opt' + i}`}
                          />
                        );
                      });
                    })()}
                    {outcomes.length > 4 && (
                      <p style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--text-muted)',
                        letterSpacing: '0.04em',
                        margin: '4px 0 0',
                        textAlign: 'right',
                      }}>
                        {t('points.detail.topOnly', { n: outcomes.length })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Parallel markets: voting lives here (below the chart),
                one row per leg with Sí/No buttons — matches the
                Polymarket-style layout. The right sidebar carries a
                read-only odds summary to complement this. */}
            {market.ammMode === 'parallel' && Array.isArray(market.legs) && !isResolved && !isPendingResolution && (
              <div style={{ marginBottom: 32 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  {t('points.detail.optionsVote')}
                </div>
                <ParallelLegList
                  market={market}
                  legs={market.legs}
                  outcomeImages={market.outcomeImages}
                  onBuyClick={handleBuyClick}
                />
              </div>
            )}

            {/* Unified multi (N>2): read-only option grid under the
                chart so the user sees every outcome's percentage. The
                actual voting happens in the right sidebar. Parallel
                doesn't use this grid — the leg list above already
                shows every outcome with inline buy buttons. */}
            {outcomes.length > 2 && market.ammMode !== 'parallel' && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: 32,
                // Many outcomes (rare on unified, but guard anyway):
                // cap height and scroll so the grid doesn't push the
                // rest of the page off-screen.
                ...(outcomes.length > 8 ? {
                  maxHeight: 320,
                  overflowY: 'auto',
                } : null),
              }}>
                {outcomes.map((label, i) => {
                  const pct = Math.round((isResolved ? (winnerIndex === i ? 1 : 0) : prices[i]) * 100);
                  const isWin = isResolved && winnerIndex === i;
                  const logo = market.outcomeImages?.[i] || null;
                  return (
                    <div key={i} style={{
                      padding: '16px',
                      background: isWin ? 'rgba(0,232,122,0.08)' : 'var(--surface1)',
                      border: `1px solid ${isWin ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                      borderRadius: 12,
                      opacity: isResolved && !isWin ? 0.5 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <OutcomeLogo src={logo} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          letterSpacing: '0.06em',
                          marginBottom: 6,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {label.toUpperCase()}
                        </div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: isWin ? 'var(--green)' : 'var(--text-primary)' }}>
                          {pct}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Comments — sits between the trade area and the meta strip
                so the discussion stays adjacent to the market but below
                the actionable UI. */}
            <MarketComments
              marketId={market.id}
              authenticated={authenticated}
              username={user?.username}
              onOpenLogin={onOpenLogin}
            />

            {/* Meta */}
            <div style={{
              display: 'flex',
              gap: 32,
              padding: '16px 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {isResolved ? t('points.detail.closedLabel') : t('points.detail.closesLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {formatDeadline(market.endTime)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.volumeLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {Number(market.tradeVolume || market.volume || 0).toLocaleString('es-MX')} MXNP
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.stateLabel')}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  fontWeight: isLive ? 700 : 400,
                  color: isResolved ? 'var(--green)'
                       : isLive ? '#dc2626'
                       : isPendingResolution ? '#f59e0b'
                       : 'var(--text-primary)',
                }}>
                  {isResolved ? t('points.detail.stateResolved')
                   : isLive ? t('points.card.live')
                   : isPendingResolution ? t('points.detail.statePending')
                   : t('points.detail.stateActive')}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {t('points.detail.resolverLabel')}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)' }}>
                  {resolverLabel(market.resolverType, market.resolverSource) || t('points.detail.resolverAdmin')}
                </div>
              </div>
            </div>
          </div>

          {/* Right column: user-position panel + buy panel */}
          <aside style={{
            position: 'sticky',
            top: 80,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}>

            {/* ── Tu posición ───────────────────────────────────────
                Shows shares held per outcome when the user is signed in
                and holds anything on this market. Each row has a
                "Vender" shortcut that jumps to /portfolio where the
                sell flow is already wired. Keeps the user from having
                to leave the market detail to manage existing exposure.
            */}
            {authenticated && userPositions.length > 0 && (
              <div style={{
                background: 'var(--surface1)',
                border: '1px solid rgba(0,232,122,0.25)',
                borderRadius: 14,
                padding: '18px 22px',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  color: 'var(--green)',
                  textTransform: 'uppercase',
                  marginBottom: 12,
                }}>
                  {t('points.detail.yourPos')}
                </div>
                {userPositions.map(p => {
                  const oi = Number(p.outcomeIndex);
                  // Prefer positions.js's composed label ("Leg — Sí/No"
                  // for parallel, raw outcome label for unified) since
                  // it already knows whether this sits on a leg or the
                  // parent directly.
                  const label = p.outcomeLabel || outcomes[oi] || `Opción ${oi + 1}`;
                  const shares = Number(p.shares) || 0;
                  // Use the backend-computed currentPrice so parallel
                  // leg positions get the leg's YES/NO price rather than
                  // the parent's aggregated one.
                  const currentPrice = Number(p.currentPrice ?? prices[oi] ?? 0);
                  const markValue = shares * currentPrice;
                  const costBasis = Number(p.costBasis) || 0;
                  const pnl = markValue - costBasis;
                  const pnlPos = pnl >= 0;
                  // "Comprar más" opens the modal against the leg
                  // market for parallel, parent for unified.
                  const buyTarget = p.parentMarketId
                    ? { id: p.marketId, question: `${market.question} — ${label}` }
                    : market;
                  return (
                    <div key={`${p.marketId}-${oi}`} style={{
                      padding: '10px 0',
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{
                          fontFamily: 'var(--font-body)',
                          fontSize: 13,
                          color: 'var(--text-primary)',
                          fontWeight: 600,
                        }}>
                          {label}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          color: 'var(--text-muted)',
                        }}>
                          {t('points.detail.shares', { n: shares.toFixed(2) })}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {t('points.detail.valueLabel')}: <span style={{ color: 'var(--text-primary)' }}>{markValue.toFixed(2)} MXNP</span>
                        </span>
                        <span style={{ color: pnlPos ? 'var(--green)' : 'var(--red, #ef4444)' }}>
                          {pnlPos ? '+' : ''}{pnl.toFixed(2)} PnL
                        </span>
                      </div>
                      {!isResolved && !isPendingResolution && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => handleBuyClick(buyTarget, oi, label)}
                            className="btn-primary"
                            style={{ flex: 1, padding: '8px 10px', fontSize: 11 }}
                          >
                            {t('points.detail.buyMore')}
                          </button>
                          <button
                            onClick={() => navigate('/portfolio')}
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              fontSize: 11,
                              background: 'transparent',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              color: 'var(--text-secondary)',
                              fontFamily: 'var(--font-mono)',
                              letterSpacing: '0.04em',
                              textTransform: 'uppercase',
                              cursor: 'pointer',
                            }}
                          >
                            {t('points.detail.sell')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          {/* Top holders — read-only social-proof panel. Refreshes when
              buyState flips so the list reflects the user's own trades
              after closing the modal. */}
          <TopHolders marketId={market.id} refreshKey={buyState ? 'open' : 'closed'} />

          <div style={{
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
              {isResolved ? t('points.detail.marketClosed')
               : isPendingResolution ? t('points.detail.awaitingResult')
               : market.ammMode === 'parallel' ? t('points.detail.oddsNow')
               : t('points.detail.chooseOutcome')}
            </div>

            {/* Unified: one big button per outcome lives in the sidebar.
                Parallel: voting moved below the chart in the main column
                (one row per leg with Sí/No buttons); the sidebar only
                carries a read-only odds summary to keep scanability. */}
            {!isResolved && !isPendingResolution && (
              market.ammMode === 'parallel'
                ? <OddsSummary outcomes={outcomes} prices={prices} outcomeImages={market.outcomeImages} />
                : <UnifiedOutcomeList
                    outcomes={outcomes}
                    prices={prices}
                    outcomeImages={market.outcomeImages}
                    market={market}
                    onBuyClick={handleBuyClick}
                  />
            )}

            {(isResolved || isPendingResolution) && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {isResolved
                  ? t('points.detail.closedHint')
                  : t('points.detail.pendingHint')}
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
              {t('points.detail.mxnpNote')}
            </div>
          </div>
          </aside>
        </div>
      </main>

      {buyState && (
        <PointsBuyModal
          open
          // buyState.market points at the leg for parallel markets and
          // the parent otherwise, so the modal's quote/buy calls always
          // route to the correct binary CPMM state.
          market={buyState.market || market}
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
