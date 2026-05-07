/**
 * MVP markets grid.
 *
 * Single source: GET /api/protocol/markets (indexer-owned table).
 * The Polymarket / gamma / polymarketApproved / generated-markets
 * pipeline is gone — this build is an own-protocol-only client.
 *
 * Resolution + final-prices come back inline from the API: a market
 * row carries its own `status`, `outcome`, `prices`, `endTime`, etc.
 * No separate /api/resolutions or /api/price-history fetch needed.
 *
 * Caching: results are stashed in localStorage keyed by status filter
 * so the grid renders instantly on revisit. Cache is invalidated on
 * the next successful fetch.
 */
import React, { useEffect, useMemo, useState } from 'react';
import MarketCard from './MarketCard.jsx';
import { useT } from '../lib/i18n.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 421614);
const GRID_CACHE_KEY = 'pronos-protocol-grid-cache-v1';

const CATEGORY_LABEL = {
  general:  'General',
  mexico:   'México',
  politica: 'Política',
  deportes: 'Deportes',
  finanzas: 'Finanzas',
  crypto:   'Crypto',
  musica:   'Música',
};

const CATEGORY_ICON = {
  general:  '🌎',
  mexico:   '🇲🇽',
  politica: '🏛️',
  deportes: '⚽',
  finanzas: '💵',
  crypto:   '₿',
  musica:   '🎵',
};

function readCache(key) {
  try {
    const raw = localStorage.getItem(`${GRID_CACHE_KEY}:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.markets) ? parsed.markets : null;
  } catch { return null; }
}

function writeCache(key, markets) {
  try {
    localStorage.setItem(`${GRID_CACHE_KEY}:${key}`, JSON.stringify({
      savedAt: Date.now(),
      markets,
    }));
  } catch {}
}

function formatDeadline(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

// Translate the API row shape into the legacy `market` shape that
// MarketCard reads (id, icon, categoryLabel, options[], _resolved, …).
// Single place to keep the mapping so we don't poke MarketCard.
function apiToCard(row) {
  const outcomes = Array.isArray(row.outcomes) ? row.outcomes : [];
  const prices = Array.isArray(row.prices) ? row.prices : [];
  const options = outcomes.map((label, i) => ({
    label,
    pct: Math.round(Number(prices[i] || 0) * 100),
  }));
  const cat = (row.category || 'general').toLowerCase();
  const winnerIndex = row.outcome != null ? Number(row.outcome) : null;
  return {
    id: row.id,
    source: 'protocol',
    _source: 'protocol',
    _resolved: row.status === 'resolved',
    _winner: winnerIndex != null ? outcomes[winnerIndex] : null,
    _winnerShort: winnerIndex != null ? outcomes[winnerIndex] : null,
    _resolvedDate: row.resolvedAt
      ? new Date(row.resolvedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
      : null,
    // Live markets (currently in their game window) get promoted to
    // the trending bucket so they surface in the Trending sub-tab on
    // top of being ordered to the front of the grid by the API.
    trending: !!row.live,
    _live: !!row.live,
    icon: CATEGORY_ICON[cat] || '🌎',
    category: cat,
    categoryLabel: CATEGORY_LABEL[cat] || cat,
    question: row.question,
    options,
    deadline: formatDeadline(row.endTime),
    endTime: row.endTime,
    volume: Math.round(Number(row.liquidity || 0)).toLocaleString('en-US'),
  };
}

export default function MarketsGrid({ activeFilter }) {
  const t = useT();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const status = activeFilter === 'resueltos' ? 'resolved' : 'active';

  useEffect(() => {
    let cancelled = false;
    const cached = readCache(status);
    if (cached?.length) {
      setMarkets(cached);
      setLoading(false);
    } else {
      setMarkets([]);
      setLoading(true);
    }

    (async () => {
      try {
        const url = `/api/protocol/markets?status=${status}&limit=200&chainId=${CHAIN_ID}`;
        const res = await fetch(url, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'load_failed');
        if (cancelled) return;
        const mapped = (Array.isArray(data?.markets) ? data.markets : []).map(apiToCard);
        setMarkets(mapped);
        writeCache(status, mapped);
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || 'load_failed');
          // Keep whatever cached rows we already painted; don't fall
          // back to hardcoded markets.js entries (those were Polymarket).
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [status]);

  const filtered = useMemo(() => {
    if (!Array.isArray(markets)) return [];
    if (activeFilter === 'resueltos') return markets;
    if (!activeFilter || activeFilter === 'todos') return markets;
    if (activeFilter === 'trending') return markets.filter(m => m.trending);
    return markets.filter(m => m.category === activeFilter);
  }, [markets, activeFilter]);

  if (loading && filtered.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 0',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em',
      }}>
        {t('grid.loading')}
      </div>
    );
  }

  return (
    <div>
      {error && filtered.length === 0 && (
        <div style={{
          textAlign: 'center', marginBottom: 16,
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--text-muted)', letterSpacing: '0.06em',
        }}>
          {t('grid.fallback')}
        </div>
      )}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 0',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          {t('grid.empty')}
        </div>
      ) : (
        <div className="markets-grid">
          {filtered.map(market => (
            <MarketCard key={market.id} market={market} history={{}} />
          ))}
        </div>
      )}
    </div>
  );
}
