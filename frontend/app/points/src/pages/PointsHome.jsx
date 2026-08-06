/**
 * Home page for the points-app.
 *
 * Styled to match the main pronos.io landing (not the MVP):
 *   - PointsTicker strip across the top (in App.jsx, not here)
 *   - Most-traded carousel
 *   - Markets grid
 *   - How-it-works section
 *
 * There is no hero here any more. The pitch copy and the prize table moved
 * out: the copy to PointsIntroModal (shown to logged-out first-time
 * visitors, who are the only ones who needed it), and the prize table to
 * /torneo, which already renders it alongside the live leaderboard. Home
 * opens straight onto what people came for — the markets.
 *
 * The shared CSS at /css/base.css + /css/components.css + /css/sections.css
 * provides .category-bar, .markets-grid, .section-header, etc.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchMarkets, fetchPositions } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT } from '@app/lib/i18n.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import {
  marketMatchesFeaturedTeam,
  prioritizeFeaturedMarkets,
  useFeaturedTeamKeys,
} from '@app/lib/featuredTeams.js';
import { fetchNews, fetchPublicMapMarkets } from '@app/lib/newsApi.js';
import { enrichNewsItemsWithGeo } from '@app/lib/newsGeo.js';
import NewsMapView from '@app/components/NewsMapView.jsx';
import PointsMarketCard from '../components/PointsMarketCard.jsx';
import PointsActivityCarousel from '../components/PointsActivityCarousel.jsx';
import { ActivityCarouselSkeleton, MarketGridSkeleton } from '../components/PointsSkeleton.jsx';

function isPendingMarket(market, now = Date.now()) {
  return market?.status === 'active'
    && market?.endTime
    && new Date(market.endTime).getTime() < now;
}

export default function PointsHome() {
  const { authenticated } = usePointsAuth();
  const t = useT();
  const [searchParams] = useSearchParams();
  // Used to tighten section padding (60px → 24px horizontal) on phones.
  // The Hero + markets grid get their responsive treatment from CSS;
  // this hook only flips inline-styled sections lower on the page.
  const isMobile = useIsMobile();
  const [markets, setMarkets] = useState([]);
  const [positionByMarket, setPositionByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trendingView, setTrendingView] = useState('markets');
  const [mapRegion, setMapRegion] = useState('all');
  const [mapNewsItems, setMapNewsItems] = useState([]);
  const [sharedMapMarkets, setSharedMapMarkets] = useState([]);
  const [sharedMapLoaded, setSharedMapLoaded] = useState(false);
  const featuredTeamKeys = useFeaturedTeamKeys();
  // Search value comes from the nav input (mirrored to ?q=<text>). Living
  // in the URL keeps deep-links work and lets the nav share state without
  // a React context.
  const searchQuery = searchParams.get('q') || '';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Home is always the "Trending" view — all active markets minus
        // pending (endTime in past). Category routes handle everything
        // else via /c/:slug.
        const m = await fetchMarkets({ status: 'active', featured: 'all' });
        if (cancelled) return;
        setMarkets(m);
        setLoading(false);

        // If the caller is signed in, fetch their open positions and
        // index them by market id. Cards use this to show a "Tienes
        // posición" badge without needing to click through. Silently
        // skipped when unauthenticated — positions endpoint 401s and
        // we don't want to surface that on a public grid.
        if (authenticated) {
          try {
            const res = await fetchPositions();
            if (cancelled) return;
            const idx = {};
            for (const p of res.positions || []) {
              // Cards only need to know "has the user bet here" — pick
              // the largest holding in case the user split across
              // outcomes.
              const cur = idx[p.marketId];
              if (!cur || Number(p.shares) > Number(cur.shares)) {
                idx[p.marketId] = { outcomeIndex: p.outcomeIndex, shares: Number(p.shares) };
              }
            }
            setPositionByMarket(idx);
          } catch { /* silently best-effort */ }
        } else {
          setPositionByMarket({});
        }
      } catch (e) {
        if (!cancelled) {
          setError('load_failed');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [authenticated]);

  useEffect(() => {
    if (trendingView !== 'map' || sharedMapLoaded) return;
    let cancelled = false;
    Promise.allSettled([
      fetchNews({ category: 'featured', limit: 120 }),
      fetchPublicMapMarkets({ limit: 160 }),
    ]).then(([newsResult, marketResult]) => {
      if (cancelled) return;
      if (newsResult.status === 'fulfilled') {
        const payload = newsResult.value?.data || newsResult.value || {};
        const items = Array.isArray(payload.items) ? payload.items : [];
        setMapNewsItems(enrichNewsItemsWithGeo(items));
      }
      if (marketResult.status === 'fulfilled') {
        setSharedMapMarkets(Array.isArray(marketResult.value) ? marketResult.value : []);
      }
    }).finally(() => {
      if (!cancelled) setSharedMapLoaded(true);
    });
    return () => { cancelled = true; };
  }, [trendingView, sharedMapLoaded]);

  // Map mode is broader than the home cards: it should expose every
  // active market with a geo signal, while the card grid stays curated.
  const mapMarkets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    let out = markets.filter(m => !isPendingMarket(m, now));
    if (q) out = out.filter(m => (m.question || '').toLowerCase().includes(q));
    return prioritizeFeaturedMarkets(out, featuredTeamKeys);
  }, [markets, searchQuery, featuredTeamKeys]);

  // Home = Trending. Always active, never pending (those live on
  // /c/porresolver). Search narrows the visible list through mapMarkets.
  const filtered = useMemo(() => {
    const out = mapMarkets.filter(m => m.trending || marketMatchesFeaturedTeam(m, featuredTeamKeys));
    return prioritizeFeaturedMarkets(out, featuredTeamKeys);
  }, [mapMarkets, featuredTeamKeys]);

  const homeMapMarkets = useMemo(() => (
    sharedMapLoaded && sharedMapMarkets.length > 0 ? sharedMapMarkets : mapMarkets
  ), [sharedMapLoaded, sharedMapMarkets, mapMarkets]);

  return (
    <>

      {/* ── Most-traded carousel ──────────────────────────────
          Ranked by real fills in the last 24h (/api/points/trade-activity),
          each slide
          pairing the price chart with a live buy/sell tape. Reads from
          the same `markets` list the grid below already fetched, so it
          costs no extra market call — only the chart + tape batches it
          fires itself. Hidden while searching: a query means the user is
          hunting for one market, not browsing what's hot. */}
      {!error && !searchQuery && trendingView === 'markets' && (
        loading
          ? <ActivityCarouselSkeleton isMobile={isMobile} />
          : <PointsActivityCarousel markets={markets} count={5} />
      )}

      {/* ── Markets grid ──────────────────────────────────── */}
      <section id="market" style={{ padding: '36px 48px 60px', maxWidth: 1280, margin: '0 auto' }}>
        {!loading && !error && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}>
            <button
              type="button"
              className={`filter-btn${trendingView === 'markets' ? ' active' : ''}`}
              onClick={() => setTrendingView('markets')}
              style={{ fontSize: 11 }}
            >
              Mercados
            </button>
            <button
              type="button"
              className={`filter-btn${trendingView === 'map' ? ' active' : ''}`}
              onClick={() => setTrendingView('map')}
              style={{ fontSize: 11 }}
            >
              Mapa
            </button>
          </div>
        )}
        {loading && <MarketGridSkeleton count={6} />}
        {error && !loading && (
          <div style={{
            textAlign: 'center',
            padding: 40,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--danger)',
            whiteSpace: 'pre-wrap',
          }}>
            {t('points.home.loadError')}
          </div>
        )}
        {!loading && !error && (trendingView === 'map' ? (homeMapMarkets.length + mapNewsItems.length) : filtered.length) === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 60,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--text-muted)',
          }}>
            {searchQuery
              ? t('points.home.emptySearch', { q: searchQuery })
              : t('points.home.empty')}
          </div>
        )}
        {!loading && !error && (trendingView === 'map' ? (homeMapMarkets.length + mapNewsItems.length) : filtered.length) > 0 && (
          trendingView === 'map' ? (
            <NewsMapView
              items={mapNewsItems}
              markets={homeMapMarkets}
              activeRegion={mapRegion}
              onRegionChange={setMapRegion}
            />
          ) : (
            <div className="markets-grid">
              {filtered.map(m => (
                <PointsMarketCard key={m.id} market={m} userPosition={positionByMarket[m.id]} />
              ))}
            </div>
          )
        )}
      </section>

      {/* ── How it works ──────────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: isMobile ? '40px 16px 56px' : '60px 48px 80px',
        maxWidth: 1280,
        margin: '0 auto',
        borderTop: '1px solid var(--border)',
      }}>
        <div className="section-header" style={{ textAlign: 'center', marginBottom: 48 }}>
          <div className="section-eyebrow">{t('points.how.eyebrow')}</div>
          <div className="section-title">{t('points.how.title')}</div>
        </div>

        <div className="steps-grid">
          {[
            { n: '01', tKey: 'points.how.step1.t', dKey: 'points.how.step1.d' },
            { n: '02', tKey: 'points.how.step2.t', dKey: 'points.how.step2.d' },
            { n: '03', tKey: 'points.how.step3.t', dKey: 'points.how.step3.d' },
          ].map(s => (
            <div key={s.n} className="step">
              <div className="step-num">{s.n}</div>
              <div className="step-title">{t(s.tKey)}</div>
              <p className="step-desc">{t(s.dKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Partners ───────────────────────────────────────────
          Sits below "Cómo funciona" as the last section on home.
          Meant to build credibility — Turnkey powers the embedded
          wallet infra, Bitso is the LATAM exchange of reference, and
          MXNB is the peso-pegged stablecoin we'll eventually use for
          on-chain settlement. Logos are text badges for now to keep
          the build self-contained — can swap in SVG art later. */}
      <section id="partners" style={{
        padding: isMobile ? '32px 16px 48px' : '48px 48px 72px',
        maxWidth: 1280,
        margin: '0 auto',
        borderTop: '1px solid var(--border)',
      }}>
        <div className="section-header" style={{ textAlign: 'center', marginBottom: 32 }}>
          <div className="section-eyebrow">{t('points.partners.eyebrow')}</div>
          <div className="section-title">{t('points.partners.title')}</div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          maxWidth: 960,
          margin: '0 auto',
        }}>
          {[
            { name: 'Turnkey',   href: 'https://turnkey.com', role: t('points.partners.turnkey.role'),   description: t('points.partners.turnkey.desc') },
            { name: 'Bitso',     href: 'https://bitso.com',   role: t('points.partners.bitso.role'),     description: t('points.partners.bitso.desc') },
            { name: 'MXNB',      href: 'https://mxnb.mx',     role: t('points.partners.mxnb.role'),      description: t('points.partners.mxnb.desc') },
            { name: 'Chainlink', href: 'https://chain.link',  role: t('points.partners.chainlink.role'), description: t('points.partners.chainlink.desc') },
          ].map(p => (
            <a
              key={p.name}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block',
                padding: '20px 22px',
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                textDecoration: 'none',
                transition: 'border-color 0.18s, transform 0.18s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--green)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                letterSpacing: '0.04em',
                color: 'var(--text-primary)',
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                {p.name}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--green)',
                textTransform: 'uppercase',
                marginBottom: 10,
              }}>
                {p.role}
              </div>
              <p style={{
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.55,
                margin: 0,
              }}>
                {p.description}
              </p>
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
