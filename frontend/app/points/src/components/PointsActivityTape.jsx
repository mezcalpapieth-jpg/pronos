import React, { useState } from 'react';
import { useLang, useT } from '@app/lib/i18n.js';

const BUY_COLOR = 'var(--yes)';
const SELL_COLOR = 'var(--danger)';

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value, locale) {
  const n = Math.abs(toNumber(value));
  const hasCents = Math.abs(n - Math.round(n)) > 0.004;
  return n.toLocaleString(locale, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatShares(value, locale) {
  const n = Math.abs(toNumber(value));
  if (n >= 1000) return `${(n / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString(locale, { maximumFractionDigits: n >= 100 ? 0 : 2 });
}

function timeAgo(value, lang) {
  const input = value?.createdAt || value?.t;
  const ts = typeof input === 'number'
    ? input * 1000
    : new Date(input || 0).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSeconds < 60) return lang === 'en' ? 'now' : 'ahora';
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return lang === 'en' ? `${minutes}m ago` : `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang === 'en' ? `${hours}h ago` : `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return lang === 'en' ? `${days}d ago` : `hace ${days}d`;
}

function centLabel(price) {
  const n = toNumber(price);
  if (n <= 0) return null;
  return `${Math.round(n * 100)}c`;
}

function priceMovementLabel(item) {
  const before = toNumber(item.priceBefore);
  const after = toNumber(item.priceAfter);
  if (before > 0 && after > 0 && Math.abs(after - before) >= 0.005) {
    return `${centLabel(before)} → ${centLabel(after)}`;
  }
  const min = toNumber(item.priceMin);
  const max = toNumber(item.priceMax);
  if (min > 0 && max > 0 && Math.abs(max - min) >= 0.005) {
    return `${centLabel(min)}-${centLabel(max)}`;
  }
  return centLabel(item.price);
}

function tradeRowKey(item, i) {
  return `${item.id || i}-${item.t || item.createdAt || i}`;
}

export default function PointsActivityTape({
  items = [],
  maxRows = 12,
  compact = false,
  embedded = false,
  title,
  emptyTitle,
  emptySub,
  showShares = true,
  showTradeDetails = false,
}) {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'en' ? 'en-US' : 'es-MX';
  const [expandedTradeRows, setExpandedTradeRows] = useState(() => new Set());
  const rows = Array.isArray(items) ? items.slice(0, maxRows) : [];
  const resolvedTitle = title || t('points.activity.tapeTitle');
  const resolvedEmptyTitle = emptyTitle || t('points.activity.tapeEmpty');
  const resolvedEmptySub = emptySub || t('points.activity.tapeEmptySub');
  const toggleTradeRow = (key) => {
    setExpandedTradeRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const content = rows.length > 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 3 : 6, minWidth: 0 }}>
      {rows.map((item, i) => {
        const key = tradeRowKey(item, i);
        const isBuy = item.side === 'buy';
        const accent = isBuy ? BUY_COLOR : SELL_COLOR;
        const bg = isBuy ? 'rgba(0,232,122,0.10)' : 'rgba(255,59,59,0.10)';
        const price = priceMovementLabel(item);
        const fills = Array.isArray(item.fills) ? item.fills : [];
        const canShowDetails = showTradeDetails && fills.length > 1;
        const expanded = canShowDetails && expandedTradeRows.has(key);
        return (
          <div key={key}>
            <div
              className="points-tape-row"
              style={{
                display: 'grid',
                gridTemplateColumns: compact ? '1fr auto' : 'minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: compact ? 8 : 12,
                minHeight: compact ? 34 : 44,
                padding: compact ? '7px 8px' : '10px 12px',
                borderRadius: compact ? 7 : 9,
                background: bg,
                border: '1px solid rgba(255,255,255,0.04)',
                animationDelay: `${i * 55}ms`,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)',
                  fontWeight: 800,
                  lineHeight: 1.2,
                }}>
                  <span style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: accent,
                    flexShrink: 0,
                  }} />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    @{item.username || t('points.activity.tapeUser')}
                  </span>
                  <span style={{
                    color: accent,
                    fontFamily: 'var(--font-mono)',
                    fontSize: compact ? 'var(--fs-2xs)' : 'var(--fs-xs)',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>
                    {isBuy ? t('points.activity.tapeBought') : t('points.activity.tapeSold')}
                  </span>
                </div>
                <div style={{
                  marginTop: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-2xs)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: accent, flexShrink: 0 }}>
                    {formatMoney(item.collateral, locale)} MXNP
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.outcomeLabel || t('points.activity.tapeOutcome')}
                  </span>
                  {showShares && item.shares > 0 && (
                    <span style={{ flexShrink: 0 }}>
                      {formatShares(item.shares, locale)} {t('points.activity.tapeShares')}
                    </span>
                  )}
                </div>
                {canShowDetails && (
                  <button
                    type="button"
                    onClick={() => toggleTradeRow(key)}
                    style={{
                      marginTop: 8,
                      padding: '5px 8px',
                      borderRadius: 7,
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.04)',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-2xs)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                    }}
                  >
                    {expanded ? t('points.activity.detailsHide') : t('points.activity.detailsShow')} · {fills.length} {fills.length === 1 ? t('points.activity.detailsFill') : t('points.activity.detailsFills')}
                  </button>
                )}
              </div>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 3,
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-2xs)',
                color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}>
                <span>{timeAgo(item, lang)}</span>
                {price && <span style={{ color: accent }}>{price}</span>}
              </div>
            </div>
            {expanded && (
              <div style={{
                margin: compact ? '3px 0 5px' : '6px 0 8px',
                padding: compact ? '8px 10px' : '10px 12px',
                borderRadius: compact ? 7 : 9,
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-2xs)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}>
                  <span>{fills.length} {fills.length === 1 ? t('points.activity.detailsFill') : t('points.activity.detailsFills')}</span>
                  {item.priceBefore > 0 && item.priceAfter > 0 && (
                    <span>{centLabel(item.priceBefore)} → {centLabel(item.priceAfter)}</span>
                  )}
                </div>
                {fills.map((fill, fillIndex) => (
                  <div
                    key={`${fill.id || fillIndex}-${fill.t || fill.createdAt || fillIndex}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: compact ? '1fr auto' : 'auto minmax(0, 1fr) auto',
                      gap: compact ? 8 : 10,
                      alignItems: 'center',
                      minWidth: 0,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-2xs)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {!compact && <span style={{ color: 'var(--text-secondary)' }}>#{fill.id || fillIndex + 1}</span>}
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: accent }}>{formatMoney(fill.collateral, locale)} MXNP</span>
                      {' · '}
                      {fill.outcomeLabel || item.outcomeLabel || t('points.activity.tapeOutcome')}
                      {showShares && fill.shares > 0 && (
                        <>
                          {' · '}
                          {formatShares(fill.shares, locale)} {t('points.activity.tapeShares')}
                        </>
                      )}
                    </span>
                    <span style={{ color: accent, whiteSpace: 'nowrap' }}>
                      {fill.priceBefore > 0 && fill.priceAfter > 0
                        ? `${centLabel(fill.priceBefore)} → ${centLabel(fill.priceAfter)}`
                        : centLabel(fill.price)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  ) : (
    <div style={{
      minHeight: compact ? 98 : 120,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      textAlign: 'center',
      color: 'var(--text-muted)',
      padding: compact ? '14px 8px' : '24px 12px',
      border: compact ? 'none' : '1px dashed var(--border)',
      borderRadius: compact ? 0 : 10,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: compact ? 'var(--fs-2xs)' : 'var(--fs-xs)',
        color: 'var(--text-secondary)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}>
        {resolvedEmptyTitle}
      </span>
      <span style={{
        maxWidth: 320,
        fontFamily: 'var(--font-body)',
        fontSize: compact ? 'var(--fs-xs)' : 'var(--fs-sm)',
        lineHeight: 1.45,
      }}>
        {resolvedEmptySub}
      </span>
    </div>
  );

  if (embedded) return content;

  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: compact ? 14 : 18,
      marginBottom: 24,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}>
          {resolvedTitle}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          {t('points.activity.tapeLive')}
        </span>
      </div>
      {content}
    </section>
  );
}
