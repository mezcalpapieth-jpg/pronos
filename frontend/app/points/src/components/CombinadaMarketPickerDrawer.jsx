import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchMarkets } from '../lib/pointsApi.js';
import { parlayLegGroupId } from '../lib/combinadaSlip.js';
import { marketImageSrc, marketPlaceholderImageSrc } from '../lib/marketImages.js';
import { pointsPublicAssetSrc } from '@app/lib/publicAssets.js';
import CombinadaSlipPanel from './CombinadaSlipPanel.jsx';

function outcomeLabels(market) {
  return Array.isArray(market?.outcomes) && market.outcomes.length > 0
    ? market.outcomes
    : ['Sí', 'No'];
}

function outcomePrices(market, count) {
  return Array.isArray(market?.prices) && market.prices.length === count
    ? market.prices
    : Array.from({ length: count }, (_, i) => (count === 2 ? (i === 0 ? 0.5 : 0.5) : 1 / count));
}

function formatPercent(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '--';
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

function DrawerMarketThumbnail({ market }) {
  const [usePlaceholder, setUsePlaceholder] = useState(false);
  const fallback = marketPlaceholderImageSrc(market);
  const src = usePlaceholder ? fallback : marketImageSrc(market);
  return (
    <img
      src={pointsPublicAssetSrc(src)}
      alt=""
      aria-hidden="true"
      style={{
        width: 42,
        height: 42,
        borderRadius: 8,
        objectFit: 'cover',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        flex: '0 0 42px',
      }}
      onError={(event) => {
        if (!usePlaceholder && src !== fallback) {
          setUsePlaceholder(true);
          return;
        }
        event.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

function activeMarket(market, now = Date.now()) {
  if (market?.status !== 'active') return false;
  const endMs = new Date(market?.endTime || '').getTime();
  return !Number.isFinite(endMs) || endMs > now;
}

function parallelChoiceGroups(market, outcomes, prices) {
  const legIds = Array.isArray(market?.legIds) && market.legIds.length === outcomes.length
    ? market.legIds
    : null;
  if (!legIds) return [];
  const legStatuses = Array.isArray(market?.legStatuses) && market.legStatuses.length === outcomes.length
    ? market.legStatuses
    : null;
  return outcomes
    .map((label, index) => {
      const legId = Number(legIds[index]);
      if (!Number.isInteger(legId) || legId <= 0) return null;
      if (legStatuses && String(legStatuses[index] || '').toLowerCase() !== 'active') return null;
      const yesPrice = Math.max(0.01, Math.min(0.99, Number(prices[index]) || 0.5));
      return {
        key: `${market.id}:${legId}`,
        label,
        targetMarket: {
          id: legId,
          parentId: market.id,
          groupId: market.id,
          question: `${market.question} - ${label}`,
        },
        options: [
          { outcomeIndex: 0, displayLabel: 'Sí', outcomeLabel: `${label} - Sí`, price: yesPrice },
          { outcomeIndex: 1, displayLabel: 'No', outcomeLabel: `${label} - No`, price: 1 - yesPrice },
        ],
      };
    })
    .filter(Boolean);
}

function choiceGroupsForMarket(market) {
  const outcomes = outcomeLabels(market);
  const prices = outcomePrices(market, outcomes.length);
  if (market?.ammMode === 'parallel') {
    return parallelChoiceGroups(market, outcomes, prices);
  }
  return [{
    key: String(market?.id),
    label: null,
    targetMarket: {
      id: market.id,
      groupId: market.id,
      question: market.question,
    },
    options: outcomes.map((label, index) => ({
      outcomeIndex: index,
      displayLabel: label,
      outcomeLabel: label,
      price: prices[index],
    })),
  }];
}

function marketMatchesQuery(market, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    market?.question,
    market?.category,
    ...outcomeLabels(market),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

function drawerCopy(lang) {
  return lang === 'en'
    ? {
        title: 'Combo slip',
        eyebrow: 'Available markets',
        search: 'Search market',
        close: 'Close',
        loading: 'Loading markets...',
        empty: 'No active markets available.',
        add: 'Add',
        selected: 'Selected',
        loadError: 'Could not load markets.',
      }
    : {
        title: 'Combinada',
        eyebrow: 'Mercados disponibles',
        search: 'Buscar mercado',
        close: 'Cerrar',
        loading: 'Cargando mercados...',
        empty: 'Sin mercados activos disponibles.',
        add: 'Agregar',
        selected: 'Seleccionado',
        loadError: 'No pudimos cargar los mercados.',
      };
}

export default function CombinadaMarketPickerDrawer({
  open,
  onClose,
  legs,
  stake,
  state,
  rules,
  lang,
  authenticated,
  onStakeChange,
  onQuote,
  onSubmit,
  onRemove,
  onClear,
  onOpenLogin,
  onAddLeg,
}) {
  const copy = drawerCopy(lang);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetchMarkets({ status: 'active', featured: 'all', limit: 240 })
      .then(rows => {
        if (cancelled) return;
        setMarkets(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const selectedByGroup = useMemo(() => {
    const out = new Map();
    for (const leg of legs || []) {
      const groupId = parlayLegGroupId(leg);
      if (groupId) out.set(groupId, leg);
    }
    return out;
  }, [legs]);

  const visibleMarkets = useMemo(() => {
    const now = Date.now();
    return (markets || [])
      .filter(market => activeMarket(market, now))
      .filter(market => marketMatchesQuery(market, query))
      .filter(market => choiceGroupsForMarket(market).length > 0)
      .slice(0, 80);
  }, [markets, query]);

  if (!open || typeof document === 'undefined') return null;

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: 'min(620px, 94vw)',
        height: '100vh',
        overflowY: 'auto',
        background: 'var(--surface1)',
        borderLeft: '1px solid var(--border)',
        padding: '24px 24px 30px',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-body)',
        animation: 'points-drawer-slide-in 0.22s ease-out',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginBottom: 18,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--orange)',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              {copy.eyebrow}
            </div>
            <h2 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              lineHeight: 1,
              color: 'var(--text-primary)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
            }}>
              {copy.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            title={copy.close}
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 18,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            x
          </button>
        </div>

        <CombinadaSlipPanel
          legs={legs}
          stake={stake}
          state={state}
          rules={rules}
          lang={lang}
          authenticated={authenticated}
          onStakeChange={onStakeChange}
          onQuote={onQuote}
          onSubmit={onSubmit}
          onRemove={onRemove}
          onClear={onClear}
          onOpenLogin={onOpenLogin}
        />

        <div style={{ marginTop: 18 }}>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={copy.search}
            style={{
              width: '100%',
              height: 42,
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-primary)',
              padding: '0 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              boxSizing: 'border-box',
              marginBottom: 12,
            }}
          />

          {loading && (
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {copy.loading}
            </p>
          )}
          {!loading && loadError && (
            <p style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {copy.loadError}
            </p>
          )}
          {!loading && !loadError && visibleMarkets.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {copy.empty}
            </p>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            {visibleMarkets.map((market) => {
              const groups = choiceGroupsForMarket(market);
              return (
                <div
                  key={market.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: 'var(--surface2)',
                    padding: '12px',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    marginBottom: 10,
                  }}>
                    <DrawerMarketThumbnail market={market} />
                    <div style={{
                      minWidth: 0,
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      lineHeight: 1.35,
                    }}>
                      {market.question}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {groups.map((group) => {
                      const selectedLeg = selectedByGroup.get(parlayLegGroupId(group.targetMarket));
                      return (
                        <div key={group.key} style={{ display: 'grid', gap: 6 }}>
                          {group.label && (
                            <div style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 9,
                              color: 'var(--text-muted)',
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase',
                            }}>
                              {group.label}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {group.options.map((option) => {
                              const isSelected = selectedLeg
                                && Number(selectedLeg.marketId) === Number(group.targetMarket.id)
                                && Number(selectedLeg.outcomeIndex) === Number(option.outcomeIndex);
                              return (
                                <button
                                  key={`${group.key}:${option.outcomeIndex}`}
                                  type="button"
                                  onClick={() => onAddLeg?.({
                                    market: group.targetMarket,
                                    outcomeIndex: option.outcomeIndex,
                                    outcomeLabel: option.outcomeLabel,
                                    price: option.price,
                                  })}
                                  style={{
                                    minHeight: 32,
                                    borderRadius: 8,
                                    border: `1px solid ${isSelected ? 'rgba(0,232,122,0.45)' : 'rgba(255,85,0,0.32)'}`,
                                    background: isSelected ? 'rgba(0,232,122,0.12)' : 'rgba(255,85,0,0.08)',
                                    color: isSelected ? 'var(--green)' : 'var(--orange)',
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: 10,
                                    fontWeight: 800,
                                    letterSpacing: '0.04em',
                                    cursor: 'pointer',
                                    padding: '0 10px',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {isSelected ? copy.selected : copy.add} {option.displayLabel} {formatPercent(option.price)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
