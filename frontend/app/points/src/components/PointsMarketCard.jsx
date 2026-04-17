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
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));

  const isResolved = market.status === 'resolved';
  const isPending = market.status === 'active' && market.endTime && new Date(market.endTime) < new Date();
  const volume = market.volume ?? market.tradeVolume ?? 0;

  // Tri-color accent rotation matches the detail-page buy buttons so
  // users recognize the same color for the same outcome on both views.
  const ACCENTS = [
    { bg: 'var(--yes-dim, rgba(22,163,74,0.1))', border: 'rgba(22,163,74,0.25)', fg: 'var(--yes)' },
    { bg: 'rgba(184,144,10,0.08)',               border: 'rgba(184,144,10,0.3)',  fg: 'var(--gold, #f59e0b)' },
    { bg: 'rgba(255,59,59,0.08)',                border: 'rgba(255,59,59,0.25)',  fg: '#ff3b3b' },
  ];
  const accentFor = (i) => {
    if (outcomes.length === 2) return i === 0 ? ACCENTS[0] : ACCENTS[2];
    return ACCENTS[i] || ACCENTS[2];
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
            RESUELTO
          </span>
        )}
        {isPending && !isResolved && (
          <span className="mock-card-badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            PENDIENTE
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
            ✓ Tu posición
          </span>
        )}
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.question}</p>

        {/* Outcome rows — one per outcome (up to 3) with price and a
            "si ganas" payout preview for a 100 MXNP reference stake. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0 4px' }}>
          {outcomes.slice(0, 3).map((label, i) => {
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

        {outcomes.length > 3 && (
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}>
            + {outcomes.length - 3} opciones más
          </p>
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
