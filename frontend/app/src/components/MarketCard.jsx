import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BetModal from './BetModal.jsx';
import { useT } from '../lib/i18n.js';
import {
  accentForOutcome,
  formatCardDate,
  formatCompactVolume,
  previewGain,
  priceForOutcome,
} from '../lib/mvpMarketCard.js';

export default function MarketCard({ market, onOpenLogin }) {
  const t = useT();
  const navigate = useNavigate();
  const [drawerIndex, setDrawerIndex] = useState(null);

  const outcomes = Array.isArray(market.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : ['Sí', 'No'];
  const outcomeImages = Array.isArray(market.outcomeImages)
    && market.outcomeImages.length === outcomes.length
    ? market.outcomeImages
    : null;
  const outcomeCountryLabels = Array.isArray(market.outcomeCountryLabels)
    && market.outcomeCountryLabels.length === outcomes.length
    ? market.outcomeCountryLabels
    : null;
  const hasAnyLogo = outcomeImages?.some(Boolean) || false;
  const isResolved = market.status === 'resolved';
  const isLive = !isResolved && !!market.live;
  const isClosed = !isResolved
    && !isLive
    && market.status === 'active'
    && market.endTime
    && new Date(market.endTime).getTime() < Date.now();
  const drawerOpen = drawerIndex !== null;

  function navigateToDetail() {
    navigate(`/market?id=${encodeURIComponent(market.id)}`);
  }

  function openDrawer(event, index) {
    event.stopPropagation();
    if (isResolved || isClosed) return;
    setDrawerIndex(index);
  }

  return (
    <div
      className="mock-card"
      onClick={navigateToDetail}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigateToDetail();
        }
      }}
    >
      <div className="mock-card-header">
        <span className="mock-card-cat">
          {market.icon && <span style={{ marginRight: 4 }}>{market.icon}</span>}
          {market.categoryLabel || market.category || 'General'}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {isResolved && (
            <span className="mock-card-badge live" style={{ background: 'rgba(0,232,122,0.12)', color: 'var(--green)' }}>
              {t('card.resolved') || 'RESUELTO'}
            </span>
          )}
          {isClosed && (
            <span className="mock-card-badge" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>
              {t('card.closed') || 'CERRADO'}
            </span>
          )}
          {isLive && (
            <span className="mock-card-badge" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'rgba(220,38,38,0.18)',
              color: '#dc2626',
              fontWeight: 700,
            }}>
              <span
                aria-hidden="true"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#dc2626',
                  boxShadow: '0 0 0 3px rgba(220,38,38,0.18)',
                }}
              />
              {t('card.live') || 'EN VIVO'}
            </span>
          )}
          {!isResolved && !isClosed && !isLive && market.trending && (
            <span className="mock-card-badge trending">{t('card.trending') || 'TRENDING'}</span>
          )}
        </div>
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{market.question}</p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            margin: '10px 0 4px',
            ...(outcomes.length > 4 ? {
              maxHeight: 200,
              overflowY: 'auto',
              paddingRight: 4,
              WebkitMaskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
              maskImage: 'linear-gradient(to bottom, black calc(100% - 18px), transparent 100%)',
            } : null),
          }}
          onClick={(event) => {
            if (outcomes.length > 4) event.stopPropagation();
          }}
        >
          {outcomes.map((label, index) => {
            const price = priceForOutcome(market, index);
            const pct = Math.round(price * 100);
            const gain = previewGain(price);
            const isWinner = isResolved && Number(market.outcome) === index;
            const accent = accentForOutcome(index, outcomes.length);
            const logo = outcomeImages?.[index] || null;
            const countryLabel = outcomeCountryLabels?.[index] || null;

            return (
              <div
                key={`${label}-${index}`}
                role="button"
                tabIndex={0}
                onClick={(event) => openDrawer(event, index)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openDrawer(event, index);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 6px 6px 8px',
                  borderRadius: 8,
                  cursor: isResolved || isClosed ? 'default' : 'pointer',
                  opacity: isResolved && !isWinner ? 0.58 : 1,
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(event) => {
                  if (!isResolved) event.currentTarget.style.background = 'var(--surface2)';
                }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
              >
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    style={{ width: 26, height: 26, objectFit: 'contain', flexShrink: 0 }}
                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                  />
                ) : hasAnyLogo ? (
                  <span style={{ width: 26, height: 26, flexShrink: 0 }} aria-hidden="true" />
                ) : null}
                <span style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {isWinner && <span style={{ marginRight: 6 }}>🏆</span>}
                  {label}
                </span>
                {countryLabel && (
                  <span style={{
                    maxWidth: 90,
                    padding: '3px 7px',
                    borderRadius: 999,
                    background: 'var(--surface2)',
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
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: isWinner ? 'rgba(0,232,122,0.14)' : accent.bg,
                  border: `1px solid ${isWinner ? 'rgba(0,232,122,0.35)' : accent.border}`,
                  borderRadius: 100,
                  flexShrink: 0,
                }}>
                  {!isResolved && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}>
                      +{gain}
                    </span>
                  )}
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    color: isWinner ? 'var(--green)' : accent.fg,
                    minWidth: 32,
                    textAlign: 'right',
                  }}>
                    {pct}%
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {isResolved && market.finalScore && (
        <div style={{
          margin: '2px 16px 8px',
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>FINAL</span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{market.finalScore}</span>
        </div>
      )}

      <div className="mock-card-footer">
        <span className="mock-card-vol">
          LIQ <span>{formatCompactVolume(market.volume)} MXNB</span>
        </span>
        <span className="mock-card-deadline">
          {formatCardDate(market.endTime)}
        </span>
      </div>

      {drawerOpen && (
        <BetModal
          open={drawerOpen}
          variant="drawer"
          onClose={() => setDrawerIndex(null)}
          outcome={outcomes[drawerIndex]}
          outcomePct={Math.round(priceForOutcome(market, drawerIndex) * 100)}
          outcomeIndex={drawerIndex}
          marketId={market.id}
          marketTitle={market.question}
          market={market}
          onOpenLogin={onOpenLogin}
        />
      )}
    </div>
  );
}
