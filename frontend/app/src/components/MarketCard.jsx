import React from 'react';
import { useNavigate } from 'react-router-dom';
import Sparkline from './Sparkline.jsx';
import { extractSeries } from '../lib/priceHistory.js';
import { useT, useLang, localizedTitle, localizedOptions } from '../lib/i18n.js';

export default function MarketCard({ market, history }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/market?id=${market.id}`);
  };

  const topOption = market.options?.[0];
  const pct = topOption?.pct ?? 50;
  const volumeLabel = market.source === 'protocol' ? t('detail.liquidity') : t('detail.volume');

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
              {t('card.resolved')}
            </span>
          ) : market._awaitingResolution ? (
            <span className="mock-card-badge" style={{ background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.3)', color: 'var(--text-muted)' }}>
              {t('card.closed')}
            </span>
          ) : (
            <>
              {market.trending && <span className="mock-card-badge trending">{t('card.trending')}</span>}
              {market._source === 'polymarket' && <span className="mock-card-badge live">{t('card.live')}</span>}
            </>
          )}
        </div>
      </div>

      <div className="mock-card-body">
        <p className="mock-card-title">{localizedTitle(market, lang)}</p>

        <div className="mock-card-opts">
          {localizedOptions(market, lang).map((opt, i) => {
            const isWinner = market._resolved && opt.label === market._winner;
            const pct = market._resolved ? (isWinner ? 100 : 0) : opt.pct;
            return (
              <div key={i} className={`mock-card-opt ${i === 0 ? 'yes' : 'no'}`}>
                <span className="mock-card-opt-label">{isWinner ? '🏆 ' : ''}{opt.label}</span>
                <span className="mock-card-opt-pct">{pct}%</span>
              </div>
            );
          })}
        </div>

        {/* Sparkline chart(s) — single for yes/no, multi for 3+ options */}
        <div style={{ margin: '6px 0 2px' }}>
          {(market.options || []).length <= 2 ? (
            <Sparkline
              height={48}
              color="var(--yes)"
              strokeWidth={1.8}
              fill={true}
              showValue={true}
              valueWidth={40}
              data={extractSeries(market, history, 0)}
              targetPct={market.options[0]?.pct ?? 50}
              seed={`${market.id}-${market.options[0]?.label}`}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {localizedOptions(market, lang).map((opt, i) => {
                const colors = ['var(--yes)', 'var(--red)', 'var(--gold)', '#8b5cf6'];
                return (
                  <Sparkline
                    key={i}
                    height={28}
                    color={colors[i] || 'var(--text-muted)'}
                    strokeWidth={1.5}
                    fill={i === 0}
                    label={opt.label.length > 8 ? opt.label.slice(0, 7) + '…' : opt.label}
                    labelWidth={54}
                    showValue={true}
                    valueWidth={38}
                    data={extractSeries(market, history, i)}
                    targetPct={opt.pct}
                    seed={`${market.id}-${opt.label}`}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mock-card-footer">
        <div className="mock-card-vol">
          {volumeLabel} <span>${market.volume}</span>
        </div>
        <div className="mock-card-deadline">
          {market.deadline}
        </div>
      </div>
    </div>
  );
}
