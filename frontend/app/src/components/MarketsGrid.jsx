import React, { useState, useEffect } from 'react';
import MarketCard from './MarketCard.jsx';
import { gmFetchMarkets, gmFetchMarketsBySlugs } from '../lib/gamma.js';
import { fetchResolutions } from '../lib/resolutions.js';
import { fetchGeneratedMarkets } from '../lib/generatedMarkets.js';
import { fetchApprovedPolymarket, applyApprovals } from '../lib/polymarketApproved.js';
import { fetchPriceHistory, collectTokenIds } from '../lib/priceHistory.js';
import { isExpired } from '../lib/deadline.js';
import { useT } from '../lib/i18n.js';
import MARKETS from '../lib/markets.js';
import { getProtocolMode } from '../lib/protocol.js';
import { fetchProtocolMarkets } from '../lib/protocolMarkets.js';

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

async function includeApprovedPolymarketSlugs(liveMarkets, approvedRows) {
  const map = new Map();
  for (const market of liveMarkets || []) {
    if (market?.id) map.set(market.id, market);
  }
  const missingSlugs = (approvedRows || [])
    .map(row => row?.slug)
    .filter(slug => slug && !map.has(slug));
  if (missingSlugs.length > 0) {
    const fetched = await gmFetchMarketsBySlugs(missingSlugs, { relevantOnly: true });
    for (const market of fetched) {
      if (market?.id) map.set(market.id, market);
    }
  }
  return Array.from(map.values());
}

export default function MarketsGrid({ activeFilter }) {
  const t = useT();
  const [markets, setMarkets] = useState([]);
  const [history, setHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [protocolMode, setProtocolModeState] = useState(getProtocolMode);

  useEffect(() => {
    const handler = (e) => setProtocolModeState(e.detail);
    window.addEventListener('pronos-protocol-change', handler);
    return () => window.removeEventListener('pronos-protocol-change', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Fetch live markets, AI-generated, resolutions, and the polymarket
        // approval allow-list in parallel.
        const [live, generated, resolutions, approved, protocolMarkets] = await Promise.all([
          gmFetchMarkets({ limit: 60 }).catch(() => null),
          fetchGeneratedMarkets('approved').catch(() => []),
          fetchResolutions().catch(() => []),
          fetchApprovedPolymarket().catch(() => []),
          protocolMode === 'own' ? fetchProtocolMarkets().catch(() => []) : Promise.resolve([]),
        ]);

        if (cancelled) return;

        let allMarkets;
        if (live) {
          // Gate live polymarket markets behind admin approval. Only those with
          // a row in `polymarket_approved` survive — and they get their title +
          // option labels swapped to the cached Spanish translation.
          const liveWithApprovedSlugs = await includeApprovedPolymarketSlugs(live, approved);
          if (cancelled) return;
          const filteredLive = applyApprovals(liveWithApprovedSlugs, approved);
          const liveIds = new Set(filteredLive.map(m => m.id));
          // Hardcoded polymarket markets must ALSO pass the approval gate.
          // Without this, markets.js entries with _source='polymarket' would
          // appear on the public site even if no admin approved them.
          const approvedSlugs = new Set((approved || []).map(a => a.slug));
          const local = MARKETS.filter(m => {
            if (liveIds.has(m.id)) return false; // already in live list
            if (m._source === 'polymarket' && m._polyId) return approvedSlugs.has(m.id);
            return true;
          });
          // Apply translations to approved hardcoded polymarket markets too
          const localApproved = applyApprovals(local.filter(m => m._source === 'polymarket' && m._polyId), approved);
          const localOther = local.filter(m => !(m._source === 'polymarket' && m._polyId));
          allMarkets = [...protocolMarkets, ...filteredLive, ...generated, ...localApproved, ...localOther];
        } else {
          // Fallback: only show local non-polymarket markets (polymarket ones need approval)
          const localOnly = MARKETS.filter(m => !(m._source === 'polymarket' && m._polyId));
          allMarkets = [...protocolMarkets, ...generated, ...localOnly];
          setError('Usando datos locales — API no disponible.');
        }

        // Apply resolution data from our DB
        const withResolutions = applyResolutions(allMarkets, resolutions);
        setMarkets(withResolutions);
        setLoading(false);

        // Then batch-fetch real price history for all markets with clobTokenIds
        // (runs after initial render so the grid shows instantly with mock data).
        // The last point of each token's series is also the current live
        // probability — use it to refresh options[i].pct on hardcoded markets
        // whose baked-in percentages would otherwise stay stale.
        const tokenIds = collectTokenIds(withResolutions);
        if (tokenIds.length > 0) {
          const hist = await fetchPriceHistory(tokenIds, { interval: '1w', fidelity: 60 });
          if (cancelled) return;
          setHistory(hist);

          const refreshed = withResolutions.map(m => {
            const ids = m?._clobTokenIds;
            if (!Array.isArray(ids) || ids.length === 0) return m;
            if (!Array.isArray(m.options)) return m;
            let changed = false;
            const nextOpts = m.options.map((opt, i) => {
              const tid = ids[i];
              const pts = tid && hist[tid];
              if (!Array.isArray(pts) || pts.length === 0) return opt;
              const livePct = Math.round(Number(pts[pts.length - 1].p));
              if (!Number.isFinite(livePct) || livePct === opt.pct) return opt;
              changed = true;
              return { ...opt, pct: livePct };
            });
            return changed ? { ...m, options: nextOpts } : m;
          });
          setMarkets(refreshed);
        }
      } catch (err) {
        console.warn('Error loading markets:', err.message);
        if (!cancelled) {
          setMarkets(MARKETS);
          setError('fallback');
          setLoading(false);
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [protocolMode]);

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
        {t('grid.loading')}
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div style={{ textAlign: 'center', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
          {t('grid.fallback')}
        </div>
      )}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          {t('grid.empty')}
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
