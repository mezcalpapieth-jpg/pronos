import React from 'react';
import { useNavigate } from 'react-router-dom';
import Sparkline from './Sparkline.jsx';

export default function MarketCard({ market }) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/market?id=${market.id}`);
  };

  const topOption = market.options?.[0];
  const pct = topOption?.pct ?? 50;

  return (
    <div className="mock-card" onClick={handleClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick()}
    >
      <div className="mock-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>{market.icon}</span>
          <span className="mock-card-cat">{market.categoryLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {market._resolved ? (
            <span className="mock-card-badge" style={{ background: 'rgba(184,144,10,0.1)', border: '1px solid rgba(184,144,10,0.25)', color: 'var(--gold)' }}>
              🏆 RESUELTO
            </span>
          ) : (
            <>
              {market.trending && <span className="mock-card-badge trending">🔥 TRENDING</span>}
              {market._source === 'polymarket' && <span className="mock-card-badge live">LIVE</span>}
            </>
          )}
        </div>
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.title}</p>

        <div className="mock-card-opts">
          {(market.options || []).map((opt, i) => (
            <div key={i} className={`mock-card-opt ${i === 0 ? 'yes' : 'no'}`}>
              <span className="mock-card-opt-label">{opt.label}</span>
              <span className="mock-card-opt-pct">{opt.pct}%</span>
            </div>
          ))}
        </div>

        {/* Sparkline charts — one per option */}
        <div style={{ margin: '6px 0 2px', opacity: 0.8, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(market.options || []).map((opt, i) => {
            const colors = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6'];
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: colors[i] || 'var(--text-muted)', width: 28, textAlign: 'right', flexShrink: 0 }}>
                  {opt.pct}%
                </span>
                <Sparkline
                  width={240}
                  height={market.options.length > 2 ? 24 : 32}
                  color={colors[i] || 'var(--text-muted)'}
                  strokeWidth={1.2}
                  fill={i === 0}
                  targetPct={opt.pct}
                  seed={`${market.id}-${opt.label}`}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mock-card-footer">
        <div className="mock-card-vol">
          VOL <span>${market.volume}</span>
        </div>
        <div className="mock-card-deadline">
          {market.deadline}
        </div>
      </div>
    </div>
  );
}
