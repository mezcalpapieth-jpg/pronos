import React, { useState, useEffect } from 'react';
import MarketCard from './MarketCard.jsx';
import { gmFetchMarkets } from '../lib/gamma.js';
import { fetchResolutions } from '../lib/resolutions.js';
import { fetchGeneratedMarkets } from '../lib/generatedMarkets.js';
import { fetchPriceHistory, collectTokenIds } from '../lib/priceHistory.js';
import { isExpired } from '../lib/deadline.js';
import MARKETS from '../lib/markets.js';

function applyResolutions(markets, resolutions) {
  if (!resolutions || resolutions.length === 0) return markets;
  const map = Object.fromEntries(resolutions.map(r => [r.market_id, r]));
  return markets.map(m => {
    const r = map[m.id];
    if (!r) return m;
    return {
      ...m,
      _resolved: true,
      _winner: r.winner,
      _winnerShort: r.winner_short || r.winner,
      _resolvedDate: new Date(r.resolved_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }),
      _resolvedBy: r.resolved_by,
      _description: r.description,
    };
  });
}

export default function MarketsGrid({ activeFilter }) {
  const [markets, setMarkets] = useState([]);
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetch live markets, AI-generated markets, and resolutions in parallel
        const [live, generated, resolutions] = await Promise.all([
          gmFetchMarkets({ limit: 60 }).catch(() => null),
          fetchGeneratedMarkets('approved').catch(() => []),
          fetchResolutions().catch(() => []),
        ]);

        if (cancelled) return;

        let allMarkets;
        if (live) {
          const liveIds = new Set(live.map(m => m.id));
          const local = MARKETS.filter(m => !liveIds.has(m.id));
          allMarkets = [...live, ...generated, ...local];
        } else {
          allMarkets = [...generated, ...MARKETS];
          setError('Usando datos locales — API no disponible.');
        }

        // Apply resolution data from our DB
        const withResolutions = applyResolutions(allMarkets, resolutions);
        setMarkets(withResolutions);
        setLoading(false);

        // Then batch-fetch real price history for all markets with clobTokenIds
        // (runs after initial render so the grid shows instantly with mock data)
        const tokenIds = collectTokenIds(withResolutions);
        if (tokenIds.length > 0) {
          const hist = await fetchPriceHistory(tokenIds, { interval: '1w', fidelity: 60 });
          if (!cancelled) setHistory(hist);
        }
      } catch (err) {
        console.warn('Error loading markets:', err.message);
        if (!cancelled) {
          setMarkets(MARKETS);
          setError('Usando datos locales — API no disponible.');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Annotate expired-but-not-yet-resolved markets so MarketCard can render
  // a distinct "CERRADO" badge while we wait for the auto-resolve cron.
  const annotated = markets.map(m => {
    if (m._resolved) return m;
    return isExpired(m) ? { ...m, _awaitingResolution: true } : m;
  });

  // Filter logic — resolved + expired markets only show in "Resueltos" tab.
  // The auto-resolve cron promotes _awaitingResolution → _resolved once a
  // winner is known; until then the market is hidden from active tabs.
  const filtered = annotated.filter(m => {
    if (activeFilter === 'resueltos') return !!m._resolved || !!m._awaitingResolution;
    if (m._resolved || m._awaitingResolution) return false;
    if (!activeFilter || activeFilter === 'todos') return true;
    if (activeFilter === 'trending') return m.trending;
    return m.category === activeFilter;
  });

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em' }}>
        CARGANDO MERCADOS…
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ textAlign: 'center', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {error}
        </div>
      )}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          No hay mercados en esta categoría.
        </div>
      ) : (
        <div className="markets-grid">
          {filtered.map(market => (
            <MarketCard key={market.id} market={market} history={history} />
          ))}
        </div>
      )}
    </div>
  );
}
