/**
 * Per-category market page — rendered at /c/:slug.
 *
 * Behaves like a narrowed version of Home: just the markets grid for
 * that category (no hero, no partners). The shared CategoryBar sits
 * at the top so users can still hop between categories.
 *
 * Special cases:
 *   - /c/deportes  → adds a SPORT sub-filter bar (MLB / NBA / Soccer /
 *                    F1). When sport=soccer, a LEFT SIDEBAR with league
 *                    pills appears (UCL / La Liga / Premier / Serie A /
 *                    Bundesliga / Liga MX / MLS).
 *   - /c/porresolver → filters to markets whose trading window has
 *                      closed but that are still status='active'.
 *   - /c/resueltos   → fetches status='resolved' instead of 'active'.
 *
 * Sport / league classification relies on the `sport` + `league` fields
 * emitted by the generator pipeline. Existing markets approved before
 * that plumbing will have null values and fall into the "Todos" bucket.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { fetchMarkets, fetchPositions } from '../lib/pointsApi.js';
import {
  PUBLIC_GEO_FILTERS,
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from '../lib/pointsCategoryFilters.js';
import PointsMarketCard from '../components/PointsMarketCard.jsx';

// Slug → i18n key for the page header. Falls back to the category
// itself when missing (so adding a new /c/foo route "just works").
const SLUG_TO_TITLE_KEY = {
  deportes:    'points.cat.deportes',
  musica:      'points.cat.musica',
  mexico:      'points.cat.mexico',
  politica:    'points.cat.politica',
  crypto:      'points.cat.crypto',
  finanzas:    'points.cat.finanzas',
  porresolver: 'points.cat.porresolver',
  resueltos:   'points.cat.resueltos',
};

// Sports sub-filter tabs. `key` maps to market.sport. 'all' shows
// everything deportes-tagged. NFL is listed but will be empty until
// a generator ships. Baseball is a family — MLB + LMB share the
// 'baseball' sport and are split by league in the sidebar below.
const SPORT_TABS = [
  { key: 'all',      tKey: 'points.sport.all'      },
  { key: 'soccer',   tKey: 'points.sport.soccer'   },
  { key: 'baseball', tKey: 'points.sport.baseball' },
  { key: 'nba',      tKey: 'points.sport.nba'      },
  { key: 'nfl',      tKey: 'points.sport.nfl'      },
  { key: 'f1',       tKey: 'points.sport.f1'       },
  { key: 'tennis',   tKey: 'points.sport.tennis'   },
  { key: 'golf',     tKey: 'points.sport.golf'     },
  // Combate = fighting umbrella. Markets land here with sport='combate'
  // and league='ufc' or 'boxing'. Generator: market-gen/ufc.js; boxing
  // generator pending a data source decision.
  { key: 'combate',  tKey: 'points.sport.combate',  fallback: 'Combate' },
];

// Soccer leagues sidebar. `key` maps to market.league as set by the
// generators (see COMPETITION_TO_LEAGUE in market-gen/soccer.js and the
// espn-soccer generator).
const SOCCER_LEAGUES = [
  { key: 'all',            tKey: 'points.league.all'           },
  { key: 'uefa-cl',        tKey: 'points.league.uefaCl', hubPath: '/c/deportes/uefa-champions-league' },
  { key: 'uefa-europa-league', tKey: 'points.league.europa' },
  { key: 'uefa-conference-league', tKey: 'points.league.conference' },
  { key: 'la-liga',        tKey: 'points.league.laLiga'        },
  { key: 'premier-league', tKey: 'points.league.premier'       },
  { key: 'serie-a',        tKey: 'points.league.serieA'        },
  { key: 'bundesliga',     tKey: 'points.league.bundesliga'    },
  { key: 'copa-libertadores', tKey: 'points.league.libertadores' },
  { key: 'liga-mx',        tKey: 'points.league.ligaMx'        },
  { key: 'mls',            tKey: 'points.league.mls'           },
];

// Baseball leagues sidebar — MLB vs LMB. Both markets live under
// sport='baseball'; this splits them further.
const BASEBALL_LEAGUES = [
  { key: 'all', tKey: 'points.league.all' },
  { key: 'mlb', tKey: 'points.league.mlb' },
  { key: 'lmb', tKey: 'points.league.lmb' },
];

// Combate (fighting) leagues sidebar — UFC + Boxing today, with
// kickboxing / Bellator / PFL slots reserved for future generators.
const COMBATE_LEAGUES = [
  { key: 'all',    tKey: 'points.league.all', fallback: 'Todos' },
  { key: 'ufc',    tKey: 'points.league.ufc', fallback: 'UFC' },
  { key: 'boxing', tKey: 'points.league.boxing', fallback: 'Boxeo' },
];

// Category tabs that want resolved markets instead of active.
const RESOLVED_SLUGS = new Set(['resueltos']);
// Category tabs that want pending markets (active + endTime in the past).
const PENDING_SLUGS = new Set(['porresolver']);

// Top-level category chips on /c/resueltos. Without these the resolved
// view dumps every settled market into one wall — and the 5-min crypto
// rollover history drowns the rest. With the chips the user can scope
// down to one category and then drill further via the existing sport /
// crypto-type filters.
const RESUELTOS_CATEGORIES = [
  { key: 'all',      tKey: 'points.cat.trending',  fallback: 'Todas' },
  { key: 'deportes', tKey: 'points.cat.deportes'   },
  { key: 'musica',   tKey: 'points.cat.musica'     },
  { key: 'mexico',   tKey: 'points.cat.mexico'     },
  { key: 'politica', tKey: 'points.cat.politica'   },
  { key: 'crypto',   tKey: 'points.cat.crypto'     },
  { key: 'finanzas', tKey: 'points.cat.finanzas'   },
];

// Crypto type sub-row — splits the BTC/ETH 5-min "sube o baja" rollover
// markets out of the broader crypto bucket so users can drill into one
// or the other without the 5-min stream dominating the count. The
// crypto5min flag is computed server-side from resolver_config.shape.
const CRYPTO_TYPE_TABS = [
  { key: 'all',     fallback: 'Todos'     },
  { key: 'general', fallback: 'Eventos'   },
  { key: '5min',    fallback: '5 minutos' },
];

const MEXICO_TOPIC_TABS = [
  { key: 'all',      tKey: 'points.topic.all' },
  { key: 'general',  tKey: 'points.topic.general' },
  { key: 'politica', tKey: 'points.topic.politica' },
  { key: 'deportes', tKey: 'points.topic.deportes' },
  { key: 'finanzas', tKey: 'points.topic.finanzas' },
  { key: 'musica',   tKey: 'points.topic.musica' },
  { key: 'weather',  tKey: 'points.topic.weather' },
];

const GEO_FILTER_EXCLUDED_CATEGORIES = new Set(['all', 'crypto', 'world-cup', 'porresolver', 'resueltos', 'noticias']);

export default function PointsCategoryPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const t = useT();
  const { authenticated } = usePointsAuth();
  // Drives layout collapses for the league sidebar + page padding on
  // phones. The sport sub-filter row is already overflow-scrollable
  // via existing inline styles, so it doesn't need this hook.
  const isMobile = useIsMobile();
  const [markets, setMarkets] = useState([]);
  const [positionByMarket, setPositionByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const searchQuery = (searchParams.get('q') || '').trim();
  const sport  = searchParams.get('sport')  || 'all';
  const league = searchParams.get('league') || 'all';
  // Category narrower for /c/resueltos: 'all' shows every resolved
  // market; otherwise scopes to a single category and lets the
  // existing sport / crypto-type sub-filters work inside it.
  const resueltosCat = searchParams.get('cat') || 'all';
  // Crypto-type narrower: 'all' shows everything, 'general' hides
  // 5-min rollover markets, '5min' shows only them. Applies on
  // /c/crypto and on /c/resueltos?cat=crypto.
  const cryptoType = searchParams.get('ctype') || 'all';
  const geo = searchParams.get('geo') || 'all';
  const topic = searchParams.get('topic') || 'all';

  // Status to fetch — resueltos loads resolved; everything else fetches
  // active and filters client-side for "pending" if needed.
  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';
  const activeFilterCategory = RESOLVED_SLUGS.has(slug) ? resueltosCat : slug;
  const supportsGeoFilters = !GEO_FILTER_EXCLUDED_CATEGORIES.has(activeFilterCategory);
  const supportsTopicFilters = activeFilterCategory === 'mexico';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Category pages show EVERY market in the category, not just
        // the featured ones. Pass `featured: 'all'` so the API
        // doesn't apply its Trending default filter.
        const m = await fetchMarkets({
          status: fetchStatus,
          limit: 2000,
          featured: 'all',
        });
        if (cancelled) return;
        setMarkets(m);
        setLoading(false);
        if (authenticated) {
          try {
            const res = await fetchPositions();
            if (cancelled) return;
            const idx = {};
            for (const p of res.positions || []) {
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
          setError(e.code || e.message || 'load_failed');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fetchStatus, authenticated]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const now = Date.now();
    const isPending = (m) =>
      m.status === 'active'
      && m.endTime
      && new Date(m.endTime).getTime() < now;

    let out = markets;

    if (PENDING_SLUGS.has(slug)) {
      out = out.filter(isPending);
    } else if (RESOLVED_SLUGS.has(slug)) {
      // Already resolved by fetchStatus. Apply the resueltos-only
      // top-level category narrower so the page can scope down to a
      // single bucket before any sub-filters fire.
      if (resueltosCat !== 'all') {
        out = out.filter(m => marketInCategory(m, resueltosCat));
      }
    } else {
      // Regular category: hide pending from the main grid.
      out = out.filter(m => !isPending(m));
      out = out.filter(m => marketInCategory(m, slug));
    }

    // Sports sub-filter: only when on /c/deportes OR when scoping
    // /c/resueltos to category=deportes.
    const inDeportesContext = slug === 'deportes'
      || (RESOLVED_SLUGS.has(slug) && resueltosCat === 'deportes');
    if (inDeportesContext && sport !== 'all') {
      out = out.filter(m => (m.sport || '').toLowerCase() === sport);
      // League sidebars on soccer + baseball + combate (combat sports).
      if ((sport === 'soccer' || sport === 'baseball' || sport === 'combate') && league !== 'all') {
        out = out.filter(m => (m.league || '').toLowerCase() === league);
      }
    }

    // Crypto-type sub-filter: only when on /c/crypto OR when scoping
    // /c/resueltos to category=crypto. Server sets crypto5min=true on
    // resolver_config.shape='binary-direction' rows.
    const inCryptoContext = slug === 'crypto'
      || (RESOLVED_SLUGS.has(slug) && resueltosCat === 'crypto');
    if (inCryptoContext && cryptoType !== 'all') {
      if (cryptoType === '5min') out = out.filter(m => m.crypto5min === true);
      else if (cryptoType === 'general') out = out.filter(m => !m.crypto5min);
    }

    if (supportsGeoFilters && geo !== 'all') {
      out = out.filter(m => marketInGeo(m, geo));
    }
    if (supportsTopicFilters && topic !== 'all') {
      out = out.filter(m => marketInTopic(m, topic));
    }

    if (q) {
      out = out.filter(m => (m.question || '').toLowerCase().includes(q));
    }

    return out;
  }, [markets, slug, sport, league, resueltosCat, cryptoType, geo, topic, supportsGeoFilters, supportsTopicFilters, searchQuery]);

  function setSport(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('sport');
    else params.set('sport', next);
    // Reset league whenever we pivot away from a sport that has
    // a league sidebar (soccer / baseball / combate).
    if (next !== 'soccer' && next !== 'baseball' && next !== 'combate') {
      params.delete('league');
    }
    setSearchParams(params, { replace: true });
  }

  function setLeague(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('league');
    else params.set('league', next);
    setSearchParams(params, { replace: true });
  }

  function setResueltosCat(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('cat');
    else params.set('cat', next);
    // Switching the top-level category invalidates inner sub-filters
    // that don't apply outside their parent (sport only matters when
    // cat=deportes; ctype only when cat=crypto). Clear them so a
    // stale ?sport=combate doesn't filter out every musica row.
    params.delete('sport');
    params.delete('league');
    params.delete('ctype');
    params.delete('geo');
    params.delete('topic');
    setSearchParams(params, { replace: true });
  }

  function setCryptoType(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('ctype');
    else params.set('ctype', next);
    setSearchParams(params, { replace: true });
  }

  function setGeo(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('geo');
    else params.set('geo', next);
    setSearchParams(params, { replace: true });
  }

  function setTopic(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('topic');
    else params.set('topic', next);
    setSearchParams(params, { replace: true });
  }

  const titleKey = SLUG_TO_TITLE_KEY[slug] || null;
  const isResueltos = RESOLVED_SLUGS.has(slug);
  // /c/deportes always shows the sport bar; /c/resueltos shows it only
  // when the user has scoped to category=deportes via the chip row.
  const showSportBar = slug === 'deportes'
    || (isResueltos && resueltosCat === 'deportes');
  const showLeagueSidebar = (slug === 'deportes' || (isResueltos && resueltosCat === 'deportes'))
    && (sport === 'soccer' || sport === 'baseball' || sport === 'combate');
  // Crypto-type sub-row: /c/crypto, or /c/resueltos?cat=crypto.
  const showCryptoTypeBar = slug === 'crypto'
    || (isResueltos && resueltosCat === 'crypto');
  const showGeoBar = supportsGeoFilters;
  const showTopicBar = supportsTopicFilters;
  const leagueTabs = sport === 'baseball'
    ? BASEBALL_LEAGUES
    : sport === 'combate'
      ? COMBATE_LEAGUES
      : SOCCER_LEAGUES;
  // Friendly sidebar header. "Disciplinas" feels right for combat
  // sports vs "Ligas" for soccer / baseball.
  const leagueSidebarLabel = sport === 'combate' ? 'Disciplinas' : 'Ligas';

  return (
    <section style={{
      maxWidth: 1280,
      margin: '0 auto',
      padding: isMobile ? '16px 16px 48px' : '28px 48px 60px',
    }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        letterSpacing: '0.02em',
        color: 'var(--text-primary)',
        margin: '0 0 6px',
      }}>
        {titleKey ? t(titleKey) : slug}
      </h1>
      <p style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        margin: '0 0 20px',
      }}>
        {t('points.catpage.eyebrow', { n: filtered.length })}
      </p>

      {/* Top-level category chips — only on /c/resueltos. Lets users
          scope an otherwise-huge resolved list to one category before
          the existing sport / crypto-type sub-rows kick in. */}
      {isResueltos && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 16,
          paddingBottom: 4,
        }}>
          {RESUELTOS_CATEGORIES.map(c => (
            <button
              key={c.key}
              className={`filter-btn${resueltosCat === c.key ? ' active' : ''}`}
              onClick={() => setResueltosCat(c.key)}
            >
              {c.tKey ? (t(c.tKey) || c.fallback) : c.fallback}
            </button>
          ))}
        </div>
      )}

      {/* Region sub-filter — mirrors the admin taxonomy on public
          category pages without pulling crypto / World Cup into Mexico. */}
      {showGeoBar && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 16,
          paddingBottom: 4,
        }}>
          {PUBLIC_GEO_FILTERS.map(g => (
            <button
              key={g.key}
              className={`filter-btn${geo === g.key ? ' active' : ''}`}
              onClick={() => setGeo(g.key)}
            >
              {t(g.tKey)}
            </button>
          ))}
        </div>
      )}

      {/* Mexico & Latam topic sub-filter — public counterpart to the
          admin topic chips. Weather is labelled "Clima" in Spanish. */}
      {showTopicBar && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 20,
          paddingBottom: 4,
        }}>
          {MEXICO_TOPIC_TABS.map(item => (
            <button
              key={item.key}
              className={`filter-btn${topic === item.key ? ' active' : ''}`}
              onClick={() => setTopic(item.key)}
            >
              {t(item.tKey)}
            </button>
          ))}
        </div>
      )}

      {/* Sports sub-filter row — /c/deportes always, /c/resueltos
          when scoped to cat=deportes. */}
      {showSportBar && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 20,
          paddingBottom: 4,
        }}>
          {SPORT_TABS.map(s => (
            <button
              key={s.key}
              className={`filter-btn${sport === s.key ? ' active' : ''}`}
              onClick={() => setSport(s.key)}
            >
              {t(s.tKey)}
            </button>
          ))}
          <button
            type="button"
            className="filter-btn"
            onClick={() => navigate('/teams')}
            style={{ color: 'var(--orange)', borderColor: 'rgba(255,85,0,0.35)' }}
          >
            Equipos
          </button>
        </div>
      )}

      {/* Crypto-type sub-filter row — /c/crypto always, /c/resueltos
          when scoped to cat=crypto. Separates the BTC/ETH 5-min
          rollover stream from the broader crypto markets. */}
      {showCryptoTypeBar && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 20,
          paddingBottom: 4,
        }}>
          {CRYPTO_TYPE_TABS.map(c => (
            <button
              key={c.key}
              className={`filter-btn${cryptoType === c.key ? ' active' : ''}`}
              onClick={() => setCryptoType(c.key)}
            >
              {c.fallback}
            </button>
          ))}
        </div>
      )}

      {/* Body: soccer view gets a left sidebar; everything else is a
          single column. On phones the sidebar collapses above the
          grid (full-width row of league pills) so we don't lose half
          the viewport to a 200px column. */}
      {showLeagueSidebar ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '200px 1fr',
          gap: isMobile ? 12 : 24,
          alignItems: 'start',
        }}>
          <aside style={{
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            flexWrap: isMobile ? 'wrap' : 'nowrap',
            gap: 6,
            // Sticky only on desktop — on mobile the sidebar sits
            // inline above the grid and shouldn't follow scroll.
            position: isMobile ? 'static' : 'sticky',
            top: isMobile ? undefined : 120,
            overflowX: isMobile ? 'auto' : undefined,
            paddingBottom: isMobile ? 4 : undefined,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}>
              {t('points.catpage.leagues')}
            </div>
            {leagueTabs.map(l => (
              <button
                key={l.key}
                onClick={() => l.hubPath ? navigate(l.hubPath) : setLeague(l.key)}
                style={{
                  textAlign: 'left',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  padding: '8px 10px',
                  background: l.hubPath
                    ? 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(250,204,21,0.1))'
                    : league === l.key ? 'var(--green-dim)' : 'transparent',
                  color: l.hubPath || league === l.key ? 'var(--green)' : 'var(--text-secondary)',
                  border: `1px solid ${l.hubPath || league === l.key ? 'var(--border-active)' : 'var(--border)'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                {t(l.tKey)}
              </button>
            ))}
          </aside>
          <MarketsGrid
            loading={loading}
            error={error}
            filtered={filtered}
            positionByMarket={positionByMarket}
            emptyKey={slug === 'porresolver' ? 'points.home.emptyPending' : 'points.home.empty'}
            searchQuery={searchQuery}
            t={t}
          />
        </div>
      ) : (
        <MarketsGrid
          loading={loading}
          error={error}
          filtered={filtered}
          positionByMarket={positionByMarket}
          emptyKey={slug === 'porresolver' ? 'points.home.emptyPending' : 'points.home.empty'}
          searchQuery={searchQuery}
          t={t}
        />
      )}
    </section>
  );
}

function MarketsGrid({ loading, error, filtered, positionByMarket, emptyKey, searchQuery, t }) {
  if (loading) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 60,
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
      }}>
        {t('points.home.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 40,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--red, #ef4444)',
      }}>
        {t('points.home.loadError', { err: error })}
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 60,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--text-muted)',
      }}>
        {searchQuery
          ? t('points.home.emptySearch', { q: searchQuery })
          : `🎯 ${t(emptyKey)}`}
      </div>
    );
  }
  return (
    <div className="markets-grid">
      {filtered.map(m => (
        <PointsMarketCard key={m.id} market={m} userPosition={positionByMarket[m.id]} />
      ))}
    </div>
  );
}
