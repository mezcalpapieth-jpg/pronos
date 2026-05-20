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
import { mapProtocolMarketToCard } from '../lib/mvpMarketCard.js';
import {
  marketMatchesFeaturedTeam,
  prioritizeFeaturedMarkets,
  useFeaturedTeamKeys,
} from '../lib/featuredTeams.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);
const GRID_CACHE_KEY = 'pronos-protocol-grid-cache-v1';

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

export default function MarketsGrid({ activeFilter, onOpenLogin }) {
  const t = useT();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const featuredTeamKeys = useFeaturedTeamKeys();

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
        const mapped = (Array.isArray(data?.markets) ? data.markets : []).map(mapProtocolMarketToCard);
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
    let out = markets;
    if (activeFilter === 'resueltos') return prioritizeFeaturedMarkets(out, featuredTeamKeys);
    if (!activeFilter || activeFilter === 'todos') return prioritizeFeaturedMarkets(out, featuredTeamKeys);
    if (activeFilter === 'trending') {
      out = out.filter(m => m.trending || marketMatchesFeaturedTeam(m, featuredTeamKeys));
      return prioritizeFeaturedMarkets(out, featuredTeamKeys);
    }
    out = out.filter(m => m.category === activeFilter);
    return prioritizeFeaturedMarkets(out, featuredTeamKeys);
  }, [markets, activeFilter, featuredTeamKeys]);

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
            <MarketCard key={market.id} market={market} onOpenLogin={onOpenLogin} />
          ))}
        </div>
      )}
    </div>
  );
}
