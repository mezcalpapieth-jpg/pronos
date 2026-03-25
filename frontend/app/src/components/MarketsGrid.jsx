import React, { useState, useEffect } from 'react';
import MarketCard from './MarketCard.jsx';
import { gmFetchMarkets } from '../lib/gamma.js';
import MARKETS from '../lib/markets.js';

export default function MarketsGrid({ activeFilter }) {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const live = await gmFetchMarkets({ limit: 60 });
        if (!cancelled) {
          // Merge: live Polymarket markets + local markets (de-dupe by id)
          const liveIds = new Set(live.map(m => m.id));
          const local = MARKETS.filter(m => !liveIds.has(m.id));
          setMarkets([...live, ...local]);
        }
      } catch (err) {
        console.warn('Gamma API unavailable, using local markets:', err.message);
        if (!cancelled) {
          setMarkets(MARKETS);
          setError('Usando datos locales — API no disponible.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // Filter logic
  const filtered = markets.filter(m => {
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
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
