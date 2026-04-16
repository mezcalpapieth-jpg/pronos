/**
 * Market card for the points-app grid.
 *
 * Uses the exact same `.mock-card*` classes as the landing page and
 * MVP so the visual style stays consistent across the site. Clicking
 * anywhere on the card navigates to /market?id=<id> — the actual
 * buy UI lives on the detail page.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';

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

export default function PointsMarketCard({ market }) {
  const navigate = useNavigate();
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : ['Sí', 'No'];
  const prices = Array.isArray(market.prices) && market.prices.length === outcomes.length
    ? market.prices
    : outcomes.map((_, i) => (i === 0 ? 0.5 : 1 / outcomes.length));

  const isResolved = market.status === 'resolved';
  const isPending = market.status === 'active' && market.endTime && new Date(market.endTime) < new Date();
  const volume = market.volume ?? market.tradeVolume ?? 0;

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
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.question}</p>

        <div className="mock-card-opts">
          {outcomes.slice(0, 2).map((label, i) => (
            <div
              key={i}
              className={`mock-opt ${i === 0 ? 'yes' : 'no'}`}
            >
              <span className="mock-opt-pct">{Math.round(prices[i] * 100)}%</span>
              <span className="mock-opt-label">{label}</span>
            </div>
          ))}
        </div>
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
