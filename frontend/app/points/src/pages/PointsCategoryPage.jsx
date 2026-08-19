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
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { prioritizeFeaturedMarkets, useFeaturedTeamKeys } from '@app/lib/featuredTeams.js';
import { fetchMarkets, fetchPositions } from '../lib/pointsApi.js';
import {
  PUBLIC_GEO_FILTERS,
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from '../lib/pointsCategoryFilters.js';
import PointsMarketCard from '../components/PointsMarketCard.jsx';
import { MarketGridSkeleton } from '../components/PointsSkeleton.jsx';

// Slug → i18n key for the page header. Falls back to the category
// itself when missing (so adding a new /c/foo route "just works").
const SLUG_TO_TITLE_KEY = {
  deportes:    'points.cat.deportes',
  musica:      'points.cat.musica',
  mexico:      'points.cat.mexico',
  infraestructura: 'points.cat.infraestructura',
  'nuevos-mercados': 'points.cat.worldCup',
  'world-cup':       'points.cat.worldCup',
  politica:    'points.cat.politica',
  crypto:      'points.cat.crypto',
  finanzas:    'points.cat.finanzas',
  porresolver: 'points.cat.porresolver',
  resueltos:   'points.cat.resueltos',
};

// Sports sub-filter tabs. `key` maps to market.sport. 'all' shows
// everything deportes-tagged. Baseball is a family — MLB + LMB share the
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
  { key: 'leagues-cup',    tKey: 'points.league.leaguesCup'    },
  { key: 'international',  tKey: 'points.league.international' },
  { key: 'club-friendlies', tKey: 'points.league.clubFriendlies' },
  { key: 'liga-mx',        tKey: 'points.league.ligaMx'        },
  { key: 'mls',            tKey: 'points.league.mls'           },
];

// Baseball leagues sidebar — MLB, LMB, and LMP. All markets live under
// sport='baseball'; this splits them further.
const BASEBALL_LEAGUES = [
  { key: 'all', tKey: 'points.league.all' },
  { key: 'mlb', tKey: 'points.league.mlb' },
  { key: 'lmb', tKey: 'points.league.lmb' },
  { key: 'lmp', tKey: 'points.league.lmp' },
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
  { key: 'infraestructura', tKey: 'points.cat.infraestructura' },
];

// Crypto type sub-row — splits the BTC/ETH rapid "sube o baja" rollover
// markets out of the broader crypto bucket so users can drill into one
// or the other without the rapid stream dominating the count. The
// crypto5min flag is computed server-side from resolver_config.shape.
const CRYPTO_TYPE_TABS = [
  { key: 'all',     fallback: 'Todos'     },
  { key: 'general', fallback: 'Eventos'   },
  { key: '5min',    fallback: 'Rápidos' },
];

const MEXICO_TOPIC_TABS = [
  { key: 'all',      tKey: 'points.topic.all' },
  { key: 'general',  tKey: 'points.topic.general' },
  { key: 'politica', tKey: 'points.topic.politica' },
  { key: 'deportes', tKey: 'points.topic.deportes' },
  { key: 'finanzas', tKey: 'points.topic.finanzas' },
  { key: 'musica',   tKey: 'points.topic.musica' },
  { key: 'cine',     tKey: 'points.topic.cine' },
  { key: 'tv',       tKey: 'points.topic.tv' },
  { key: 'farandula', tKey: 'points.topic.farandula' },
  { key: 'weather',  tKey: 'points.topic.weather' },
];

const ENTERTAINMENT_TOPIC_TABS = [
  { key: 'all',      tKey: 'points.topic.all' },
  { key: 'musica',   tKey: 'points.topic.musica' },
  { key: 'cine',     tKey: 'points.topic.cine' },
  { key: 'tv',       tKey: 'points.topic.tv' },
  { key: 'farandula', tKey: 'points.topic.farandula' },
];

const CATEGORY_SLUG_ALIASES = {
  'world-cup': 'nuevos-mercados',
};

const TOURNAMENT_SHELF_SLUGS = new Set(['nuevos-mercados']);
const AICM_HUB_PATH = '/c/infraestructura/aicm';
const AICM_DELAY_SOURCES = new Set([
  'aicm-official-flight-board',
  'aviation-edge-timetable',
]);
const AICM_HUB_SEARCH_TEXT = [
  'aicm',
  'pulso',
  'infraestructura',
  'aeropuerto',
  'aeropuertos',
  'ciudad de mexico',
  'mexico',
  'salidas',
  'demoras',
  'vuelos',
].join(' ');

function canonicalCategorySlug(value) {
  return CATEGORY_SLUG_ALIASES[value] || value;
}

const GEO_FILTER_EXCLUDED_CATEGORIES = new Set(['all', 'crypto', 'world-cup', 'nuevos-mercados', 'porresolver', 'resueltos', 'noticias']);

function isAicmDelayMarket(m) {
  return AICM_DELAY_SOURCES.has(String(m?.source || ''))
    && String(m?.sourceEventId || '').includes(':departure:')
    && String(m?.resolverConfig?.shape || '') === 'delay-bucket';
}

function isPromotedAicmChildMarket(m) {
  return !isAicmDelayMarket(m)
    || m?.featured === true
    || m?.tournamentFeatured === true;
}

function aicmHubMatchesSearch(searchQuery) {
  const q = String(searchQuery || '').trim().toLowerCase();
  return !q || AICM_HUB_SEARCH_TEXT.includes(q);
}

export default function PointsCategoryPage() {
  const { slug: routeSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const { authenticated } = usePointsAuth();
  const slug = canonicalCategorySlug(routeSlug);
  const categoryFilter = slug;
  const isTournamentShelf = TOURNAMENT_SHELF_SLUGS.has(slug);
  // Drives layout collapses for the league sidebar + page padding on
  // phones. The sport sub-filter row is already overflow-scrollable
  // via existing inline styles, so it doesn't need this hook.
  const isMobile = useIsMobile();
  const [markets, setMarkets] = useState([]);
  const [positionByMarket, setPositionByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const featuredTeamKeys = useFeaturedTeamKeys();

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

  useEffect(() => {
    if (routeSlug !== slug) {
      navigate(`/c/${slug}${location.search || ''}`, { replace: true });
    }
  }, [routeSlug, slug, location.search, navigate]);

  // Status to fetch — resueltos loads resolved; everything else fetches
  // active and filters client-side for "pending" if needed.
  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';
  const activeFilterCategory = RESOLVED_SLUGS.has(slug) ? resueltosCat : categoryFilter;
  const supportsGeoFilters = !GEO_FILTER_EXCLUDED_CATEGORIES.has(activeFilterCategory);
  const supportsTopicFilters = activeFilterCategory === 'mexico' || activeFilterCategory === 'musica';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Category pages show every public-visible market in the category,
        // not just the featured ones. Pass `featured: 'all'` so the API
        // doesn't apply its Trending curation filter.
        const m = await fetchMarkets({
          status: fetchStatus,
          limit: 2000,
          featured: isTournamentShelf ? 'tournament' : 'all',
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
          setError('load_failed');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [fetchStatus, isTournamentShelf, authenticated]);

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
    } else if (isTournamentShelf) {
      // Nuevos mercados is a curated shelf keyed by the admin trophy
      // flag. Markets keep their real taxonomy category.
      out = out.filter(m => !isPending(m));
      out = out.filter(m => m.tournamentFeatured === true);
    } else {
      // Regular category: hide pending from the main grid.
      out = out.filter(m => !isPending(m));
      out = out.filter(m => marketInCategory(m, categoryFilter));
      if (slug === 'infraestructura') {
        // Infrastructure has persistent "main" hubs. AICM child markets
        // still exist as normal markets, but only surface in the category
        // grid when the admin promotes them with the flame or trophy flags.
        out = out.filter(isPromotedAicmChildMarket);
      }
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

    return prioritizeFeaturedMarkets(out, featuredTeamKeys);
  }, [markets, slug, categoryFilter, isTournamentShelf, sport, league, resueltosCat, cryptoType, geo, topic, supportsGeoFilters, supportsTopicFilters, searchQuery, featuredTeamKeys]);

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
  const topicTabs = activeFilterCategory === 'musica'
    ? ENTERTAINMENT_TOPIC_TABS
    : MEXICO_TOPIC_TABS;
  const leagueTabs = sport === 'baseball'
    ? BASEBALL_LEAGUES
    : sport === 'combate'
      ? COMBATE_LEAGUES
      : SOCCER_LEAGUES;
  // Friendly sidebar header. "Disciplinas" feels right for combat
  // sports vs "Ligas" for soccer / baseball.
  const leagueSidebarLabel = sport === 'combate' ? 'Disciplinas' : 'Ligas';
  const showAicmHubCard = slug === 'infraestructura' && aicmHubMatchesSearch(searchQuery);
  const visibleCount = filtered.length + (showAicmHubCard ? 1 : 0);

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
        {t('points.catpage.eyebrow', { n: visibleCount })}
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

      {/* Topic sub-filter — Mexico & Latam uses broad subject buckets;
          Entertainment narrows to Música / Cine / TV / Farándula. */}
      {showTopicBar && (
        <div style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          overflowX: 'auto',
          marginBottom: 20,
          paddingBottom: 4,
        }}>
          {topicTabs.map(item => (
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
            before={showAicmHubCard ? <AicmInfrastructureHubCard /> : null}
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
          before={showAicmHubCard ? <AicmInfrastructureHubCard /> : null}
        />
      )}
    </section>
  );
}

function AicmInfrastructureHubCard() {
  const navigate = useNavigate();
  const open = () => navigate(AICM_HUB_PATH);
  return (
    <div
      className="mock-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      style={{
        borderColor: 'rgba(96,165,250,0.36)',
        background: 'linear-gradient(145deg, rgba(96,165,250,0.12), rgba(255,85,0,0.08) 58%, rgba(0,232,122,0.08))',
      }}
    >
      <div className="mock-card-header">
        <span className="mock-card-cat">Infraestructura</span>
        <span className="mock-card-badge" style={{
          background: 'rgba(96,165,250,0.14)',
          border: '1px solid rgba(96,165,250,0.36)',
          color: '#60a5fa',
          padding: '2px 6px',
          borderRadius: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
        }}>
          HUB
        </span>
      </div>
      <div className="mock-card-body">
        <p className="mock-card-title">Pulso AICM: demoras de salida</p>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          margin: '12px 0 4px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-secondary)',
        }}>
          {[
            ['Tablero oficial', 'salidas'],
            ['Mercado diario', '24h'],
            ['Hora y semana', 'cerrados'],
          ].map(([label, value]) => (
            <div key={label} style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              alignItems: 'center',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '9px 10px',
            }}>
              <span>{label}</span>
              <strong style={{ color: 'var(--text-primary)' }}>{value}</strong>
            </div>
          ))}
        </div>
      </div>
      <div className="mock-card-footer">
        <span className="mock-card-vol">
          AICM <span>MEX</span>
        </span>
        <span className="mock-card-deadline">
          Abrir
        </span>
      </div>
    </div>
  );
}

function MarketsGrid({ loading, error, filtered, positionByMarket, emptyKey, searchQuery, t, before = null }) {
  if (loading) {
    return <MarketGridSkeleton count={6} />;
  }
  if (error) {
    return (
      <div style={{
        textAlign: 'center',
        padding: 40,
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        color: 'var(--danger)',
      }}>
        {t('points.home.loadError')}
      </div>
    );
  }
  if (filtered.length === 0 && !before) {
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
          : t(emptyKey)}
      </div>
    );
  }
  return (
    <div className="markets-grid">
      {before}
      {filtered.map(m => (
        <PointsMarketCard key={m.id} market={m} userPosition={positionByMarket[m.id]} />
      ))}
    </div>
  );
}
