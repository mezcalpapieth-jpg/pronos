/**
 * Market card for the points-app grid.
 *
 * Layout: question + a row per outcome showing current probability and
 * the projected payout on a 100 MXNP investment. NO sparkline — charts
 * only appear on the detail page, per product feedback (cards should
 * focus on the trade signal, not the chart).
 *
 * Projected payout calculation (simple, ignores fee + slippage):
 *   shares ≈ stake / price        (if you buy at current price)
 *   payout ≈ shares MXNP          (1 MXNP per winning share)
 *   net gain ≈ shares − stake
 * We show the net gain as "+X MXNP si ganas" — easy mental math.
 *
 * Props:
 *   market       — row from /api/points/markets
 *   userPosition — optional { outcomeIndex, shares } for the signed-in
 *                  user in this market. When present, a "Tu posición"
 *                  badge renders at the top of the card.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';

const STAKE_PREVIEW = 100; // MXNP reference stake for the card payout preview

function formatDeadline(endTime) {
  if (!endTime) return '';
  const d = new Date(endTime);
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

function formatVolume(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toFixed(0);
}

// Very rough gain estimate: at price p, 100 MXNP buys ~100/p shares,
// which pay out 100/p MXNP if the outcome wins. Net = 100/p − 100.
// Ignores fees and price impact on purpose — cards are preview text,
// the precise quote is computed on-server when the user actually buys.
function previewGain(price) {
  const p = Math.max(0.01, Math.min(0.99, Number(price) || 0.5));
  const payout = STAKE_PREVIEW / p;
  return Math.round(payout - STAKE_PREVIEW);
}

export default function PointsMarketCard({ market, userPosition }) {
  const navigate = useNavigate();
  const t = useT();
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));

  const isResolved = market.status === 'resolved';
  const isPending = market.status === 'active' && market.endTime && new Date(market.endTime) < new Date();
  const volume = market.volume ?? market.tradeVolume ?? 0;

  // Card palette is restricted to three hue families — green, yellow,
  // red — with three shades each. Ordered so adjacent indices always
  // land on a different hue (med-G, med-Y, med-R, light-G, light-Y,
  // light-R, dark-G, dark-Y, dark-R). Detail-page buy buttons keep
  // their wider 8-color palette; this is card-only per product
  // feedback (traffic-light feel, no blues/purples bleeding in).
  const ACCENTS = [
    // Medium row — also the W/D/L default for 3-outcome markets.
    { bg: 'var(--yes-dim, rgba(22,163,74,0.1))', border: 'rgba(22,163,74,0.25)', fg: 'var(--yes)' },            // green-medium
    { bg: 'rgba(245,158,11,0.1)',                border: 'rgba(245,158,11,0.3)',  fg: 'var(--gold, #f59e0b)' }, // gold (yellow-medium)
    { bg: 'rgba(255,59,59,0.08)',                border: 'rgba(255,59,59,0.3)',   fg: '#ff3b3b' },              // red-medium
    // Light row
    { bg: 'rgba(74,222,128,0.1)',                border: 'rgba(74,222,128,0.3)',  fg: '#4ade80' },              // green-light
    { bg: 'rgba(253,224,71,0.1)',                border: 'rgba(253,224,71,0.35)', fg: '#fde047' },              // yellow-light
    { bg: 'rgba(248,113,113,0.1)',               border: 'rgba(248,113,113,0.3)', fg: '#f87171' },              // red-light (salmon)
    // Dark row
    { bg: 'rgba(21,128,61,0.12)',                border: 'rgba(21,128,61,0.4)',   fg: '#16a34a' },              // green-dark
    { bg: 'rgba(161,98,7,0.12)',                 border: 'rgba(161,98,7,0.4)',    fg: '#b45309' },              // yellow-dark (amber)
    { bg: 'rgba(185,28,28,0.12)',                border: 'rgba(185,28,28,0.4)',   fg: '#dc2626' },              // red-dark (burgundy)
  ];
  const accentFor = (i) => {
    // Binary: canonical green / red pair.
    if (outcomes.length === 2) return i === 0 ? ACCENTS[0] : ACCENTS[2];
    // 3-outcome W/D/L: green / gold / red (traffic light).
    if (outcomes.length === 3) return ACCENTS[i];
    // N > 3: cycle the 9 shades modulo. Each "row" of 3 is one hue family;
    // cycling keeps adjacent outcomes on different hues.
    return ACCENTS[i % ACCENTS.length];
  };

  return (
    <div
      className="mock-card"
      onClick={() => navigate(`/market?id=${encodeURIComponent(market.id)}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(`/market?id=${encodeURIComponent(market.id)}`);
      }}
    >
      <div className="mock-card-header">
        <span className="mock-card-cat">
          {market.icon && <span style={{ marginRight: 4 }}>{market.icon}</span>}
          {market.category || 'General'}
        </span>
        {isResolved && (
          <span className="mock-card-badge live" style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--green)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {t('points.card.resolved')}
          </span>
        )}
        {isPending && !isResolved && (
          <span className="mock-card-badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            {t('points.card.pending')}
          </span>
        )}
        {userPosition && userPosition.shares > 0 && (
          <span style={{
            background: 'rgba(0,232,122,0.12)',
            color: 'var(--green)',
            padding: '2px 8px',
            borderRadius: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            {t('points.card.yourPos')}
          </span>
        )}
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.question}</p>

        {/* Two layouts:
              N ≤ 3 → original wide rows (label / +payout / %).
              N > 3 → 2-column grid of square-ish tiles (label on top,
                      big % below). Capped at 4 tiles; any extra legs
                      roll into a "+N opciones más" hint so the card
                      never goes beyond a 2×2 grid. The detail page
                      still shows every leg.
        */}
        {outcomes.length <= 3 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            margin: '10px 0 4px',
          }}>
            {outcomes.map((label, i) => {
              const accent = accentFor(i);
              const pct = Math.round(prices[i] * 100);
              const gain = previewGain(prices[i]);
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: accent.bg,
                    border: `1px solid ${accent.border}`,
                    borderRadius: 8,
                  }}
                >
                  <span style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    color: accent.fg,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {label}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    +{gain} MXNP
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
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              margin: '10px 0 4px',
            }}>
              {outcomes.slice(0, 4).map((label, i) => {
                const accent = accentFor(i);
                const pct = Math.round(prices[i] * 100);
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 4,
                      padding: '8px 10px',
                      background: accent.bg,
                      border: `1px solid ${accent.border}`,
                      borderRadius: 8,
                      minHeight: 52,
                    }}
                  >
                    <span style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      color: accent.fg,
                      fontWeight: 600,
                      lineHeight: 1.25,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 18,
                      color: accent.fg,
                      alignSelf: 'flex-end',
                      lineHeight: 1,
                    }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
            {outcomes.length > 4 && (
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                margin: '2px 0 0',
                letterSpacing: '0.04em',
              }}>
                {t('points.card.moreOptions', { n: outcomes.length - 4 })}
              </p>
            )}
          </>
        )}
      </div>

      <div className="mock-card-footer">
        <span className="mock-card-vol">
          VOL <span>{formatVolume(volume)} MXNP</span>
        </span>
        <span className="mock-card-deadline">
          {formatDeadline(market.endTime)}
        </span>
      </div>
    </div>
  );
}
