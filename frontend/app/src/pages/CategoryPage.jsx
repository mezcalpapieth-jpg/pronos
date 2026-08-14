/**
 * MVP per-category page — /mvp/c/:slug.
 *
 * Mirrors PointsCategoryPage, filtered to mode='onchain':
 *   - /c/deportes    → SPORT sub-tabs (soccer, beisbol, NBA, NFL, F1,
 *                      tennis, golf). Soccer + baseball get a league
 *                      sidebar (UCL/La Liga/Premier/…, MLB/LMB/LMP).
 *   - /c/porresolver → filters active markets whose endTime passed.
 *   - /c/resueltos   → fetches status='resolved'.
 *   - Everything else → category filter only.
 *
 * Sport + league come from market.sport / market.league, populated by
 * the generator pipeline when markets are approved.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketCard from '../components/MarketCard.jsx';
import { mapProtocolMarketToCard } from '../lib/mvpMarketCard.js';
import { useIsMobile } from '../lib/useIsMobile.js';
import { prioritizeFeaturedMarkets, useFeaturedTeamKeys } from '../lib/featuredTeams.js';
import {
  MVP_PUBLIC_GEO_FILTERS,
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from '../lib/mvpCategoryFilters.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 42161);

const SLUG_LABELS = {
  deportes:    'Deportes',
  musica:      'Entretenimiento',
  mexico:      'Mexico & Latam',
  politica:    'Política',
  crypto:      'Crypto',
  finanzas:    'Finanzas',
  'world-cup': 'Copa del Mundo',
  porresolver: 'Por resolver',
  resueltos:   'Resueltos',
};

// Sports sub-filter tabs. `key` maps to market.sport.
const SPORT_TABS = [
  { key: 'all',      label: 'Todos'    },
  { key: 'soccer',   label: 'Soccer'   },
  { key: 'baseball', label: 'Béisbol'  },
  { key: 'nba',      label: 'NBA'      },
  { key: 'nfl',      label: 'NFL'      },
  // Combate = combat-sports umbrella. Markets land here with
  // sport='combate' and league='ufc' or 'boxing'. Generator:
  // market-gen/ufc.js + market-gen/boxing.js.
  { key: 'combate',  label: 'Combate'  },
  { key: 'f1',       label: 'F1'       },
  { key: 'tennis',   label: 'Tenis'    },
  { key: 'golf',     label: 'Golf'     },
];

const SOCCER_LEAGUES = [
  { key: 'all',            label: 'Todas'          },
  { key: 'uefa-cl',        label: 'UEFA Champions League', hubPath: '/c/deportes/uefa-champions-league' },
  { key: 'uefa-europa-league', label: 'UEFA Europa League' },
  { key: 'uefa-conference-league', label: 'UEFA Conference League' },
  { key: 'la-liga',        label: 'La Liga'        },
  { key: 'premier-league', label: 'Premier League' },
  { key: 'serie-a',        label: 'Serie A'        },
  { key: 'bundesliga',     label: 'Bundesliga'     },
  { key: 'copa-libertadores', label: 'Copa Libertadores' },
  { key: 'leagues-cup',    label: 'Leagues Cup'    },
  { key: 'international',  label: 'Internacional'  },
  { key: 'club-friendlies', label: 'Amistosos de clubes' },
  { key: 'liga-mx',        label: 'Liga MX'        },
  { key: 'mls',            label: 'MLS'            },
];

const BASEBALL_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'mlb', label: 'MLB'   },
  { key: 'lmb', label: 'LMB'   },
  { key: 'lmp', label: 'LMP'   },
];

// Combate league sidebar — UFC + Boxing. Matches the points-app's
// PointsCategoryPage COMBATE_LEAGUES so the two surfaces filter the
// same data the same way.
const COMBATE_LEAGUES = [
  { key: 'all',    label: 'Todas' },
  { key: 'ufc',    label: 'UFC'   },
  { key: 'boxing', label: 'Boxeo' },
];

const RESOLVED_SLUGS = new Set(['resueltos']);
const PENDING_SLUGS = new Set(['porresolver']);

const RESUELTOS_CATEGORIES = [
  { key: 'all',      label: 'Todas' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'musica',   label: 'Entretenimiento' },
  { key: 'mexico',   label: 'Mexico & Latam' },
  { key: 'politica', label: 'Política' },
  { key: 'crypto',   label: 'Crypto' },
  { key: 'finanzas', label: 'Finanzas' },
];

const CRYPTO_TYPE_TABS = [
  { key: 'all',     label: 'Todos' },
  { key: 'general', label: 'Eventos' },
  { key: '5min',    label: 'Rápidos' },
];

const MEXICO_TOPIC_TABS = [
  { key: 'all',      label: 'Todas' },
  { key: 'general',  label: 'General' },
  { key: 'politica', label: 'Política' },
  { key: 'deportes', label: 'Deportes' },
  { key: 'finanzas', label: 'Finanzas' },
  { key: 'musica',   label: 'Música' },
  { key: 'cine',     label: 'Cine' },
  { key: 'tv',       label: 'TV' },
  { key: 'farandula', label: 'Farándula' },
  { key: 'weather',  label: 'Clima' },
];

const ENTERTAINMENT_TOPIC_TABS = [
  { key: 'all',      label: 'Todas' },
  { key: 'musica',   label: 'Música' },
  { key: 'cine',     label: 'Cine' },
  { key: 'tv',       label: 'TV' },
  { key: 'farandula', label: 'Farándula' },
];

const GEO_FILTER_EXCLUDED_CATEGORIES = new Set(['all', 'crypto', 'world-cup', 'porresolver', 'resueltos', 'noticias']);

export default function CategoryPage({ onOpenLogin }) {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isMobile = useIsMobile();
  const featuredTeamKeys = useFeaturedTeamKeys();

  const sport = searchParams.get('sport') || 'all';
  const league = searchParams.get('league') || 'all';
  const resueltosCat = searchParams.get('cat') || 'all';
  const cryptoType = searchParams.get('ctype') || 'all';
  const geo = searchParams.get('geo') || 'all';
  const topic = searchParams.get('topic') || 'all';

  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';
  const activeFilterCategory = RESOLVED_SLUGS.has(slug) ? resueltosCat : slug;
  const supportsGeoFilters = !GEO_FILTER_EXCLUDED_CATEGORIES.has(activeFilterCategory);
  const supportsTopicFilters = activeFilterCategory === 'mexico' || activeFilterCategory === 'musica';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/protocol/markets?status=${fetchStatus}&limit=200&chainId=${CHAIN_ID}`,
          { credentials: 'include' },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'load_failed');
        if (!cancelled) setMarkets(Array.isArray(data?.markets) ? data.markets : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchStatus]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const isPending = (m) =>
      m.status === 'active' && m.endTime && new Date(m.endTime).getTime() < now;

    let out = markets;
    if (PENDING_SLUGS.has(slug)) {
      out = out.filter(isPending);
    } else if (RESOLVED_SLUGS.has(slug)) {
      if (resueltosCat !== 'all') {
        out = out.filter(m => marketInCategory(m, resueltosCat));
      }
    } else {
      out = out.filter(m => !isPending(m));
      out = out.filter(m => marketInCategory(m, slug));
    }

    const inSportsContext = slug === 'deportes'
      || (RESOLVED_SLUGS.has(slug) && resueltosCat === 'deportes');
    if (inSportsContext && sport !== 'all') {
      out = out.filter(m => (m.sport || '').toLowerCase() === sport);
      if ((sport === 'soccer' || sport === 'baseball' || sport === 'combate') && league !== 'all') {
        out = out.filter(m => (m.league || '').toLowerCase() === league);
      }
    }

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

    return prioritizeFeaturedMarkets(out, featuredTeamKeys);
  }, [markets, slug, sport, league, resueltosCat, cryptoType, geo, topic, supportsGeoFilters, supportsTopicFilters, featuredTeamKeys]);

  // Sport-tab click updates ?sport= and clears ?league=
  function setSport(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('sport');
    else params.set('sport', next);
    params.delete('league');
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

  const title = SLUG_LABELS[slug] || (slug || '').replace(/-/g, ' ');
  const isResueltos = RESOLVED_SLUGS.has(slug);
  const showSportTabs = slug === 'deportes' || (isResueltos && resueltosCat === 'deportes');
  const showLeagueSidebar = showSportTabs && (sport === 'soccer' || sport === 'baseball' || sport === 'combate');
  const showCryptoTypeBar = slug === 'crypto' || (isResueltos && resueltosCat === 'crypto');
  const showGeoBar = supportsGeoFilters;
  const showTopicBar = supportsTopicFilters;
  const topicTabs = activeFilterCategory === 'musica'
    ? ENTERTAINMENT_TOPIC_TABS
    : MEXICO_TOPIC_TABS;
  const leagueOptions = sport === 'soccer'
    ? SOCCER_LEAGUES
    : sport === 'baseball'
      ? BASEBALL_LEAGUES
      : COMBATE_LEAGUES;
  const leagueSidebarLabel = sport === 'combate' ? 'Disciplinas' : 'Ligas';

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>

      <main style={{
        padding: 'clamp(20px, 4vw, 28px) clamp(14px, 4vw, 48px) 64px',
        maxWidth: 1280,
        margin: '0 auto',
      }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '0.04em',
          color: 'var(--text-primary)', marginBottom: 16, textTransform: 'capitalize',
        }}>
          {title}
        </h1>

        {isResueltos && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            marginBottom: 16, paddingBottom: 4, overflowX: 'auto',
          }}>
            {RESUELTOS_CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setResueltosCat(c.key)}
                className={`filter-btn${resueltosCat === c.key ? ' active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {showGeoBar && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            marginBottom: 16, paddingBottom: 4, overflowX: 'auto',
          }}>
            {MVP_PUBLIC_GEO_FILTERS.map(g => (
              <button
                key={g.key}
                onClick={() => setGeo(g.key)}
                className={`filter-btn${geo === g.key ? ' active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {g.label}
              </button>
            ))}
          </div>
        )}

        {showTopicBar && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            marginBottom: 20, paddingBottom: 4, overflowX: 'auto',
          }}>
            {topicTabs.map(item => (
              <button
                key={item.key}
                onClick={() => setTopic(item.key)}
                className={`filter-btn${topic === item.key ? ' active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Sport sub-tabs (only on /c/deportes) */}
        {showSportTabs && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            marginBottom: 20, paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            {SPORT_TABS.map(s => (
              <button
                key={s.key}
                onClick={() => setSport(s.key)}
                className={`filter-btn${sport === s.key ? ' active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {s.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => navigate('/teams')}
              className="filter-btn"
              style={{ fontSize: 11, color: 'var(--orange)', borderColor: 'rgba(255,85,0,0.35)' }}
            >
              Equipos
            </button>
          </div>
        )}

        {showCryptoTypeBar && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
            marginBottom: 20, paddingBottom: 12,
            borderBottom: '1px solid var(--border)',
          }}>
            {CRYPTO_TYPE_TABS.map(c => (
              <button
                key={c.key}
                onClick={() => setCryptoType(c.key)}
                className={`filter-btn${cryptoType === c.key ? ' active' : ''}`}
                style={{ fontSize: 11 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* Layout: sidebar (leagues) + grid — or just grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: showLeagueSidebar && !isMobile ? '200px 1fr' : '1fr',
          gap: isMobile ? 12 : 24,
        }}>
          {showLeagueSidebar && (
            <aside style={{
              padding: 14, borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--surface1)',
              alignSelf: 'start',
              position: isMobile ? 'static' : 'sticky',
              top: isMobile ? undefined : 96,
              display: isMobile ? 'flex' : 'block',
              gap: isMobile ? 6 : undefined,
              flexWrap: isMobile ? 'wrap' : undefined,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
                color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10,
                flexBasis: isMobile ? '100%' : undefined,
              }}>
                {leagueSidebarLabel}
              </div>
              {leagueOptions.map(l => (
                <button
                  key={l.key}
                  onClick={() => l.hubPath ? navigate(l.hubPath) : setLeague(l.key)}
                  style={{
                    display: 'block', width: isMobile ? 'auto' : '100%', textAlign: 'left',
                    padding: '6px 10px', borderRadius: 6,
                    background: l.hubPath
                      ? 'linear-gradient(135deg, rgba(59,130,246,0.12), rgba(250,204,21,0.1))'
                      : league === l.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                    border: l.hubPath || league === l.key ? '1px solid rgba(0,232,122,0.3)' : '1px solid transparent',
                    color: l.hubPath || league === l.key ? 'var(--green)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font-mono)', fontSize: 11,
                    cursor: 'pointer', marginBottom: 4, letterSpacing: '0.04em',
                  }}
                >
                  {l.label}
                </button>
              ))}
            </aside>
          )}

          <div>
            {loading && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Cargando…
              </div>
            )}
            {error && (
              <div style={{ padding: 20, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>
            )}
            {!loading && !error && filtered.length === 0 && (
              <div style={{
                padding: 40, textAlign: 'center', border: '1px dashed var(--border)',
                borderRadius: 14, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13,
              }}>
                Sin mercados en esta categoría por ahora.
              </div>
            )}
            {!loading && !error && filtered.length > 0 && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
              }}>
                {filtered.map(m => (
                  <MarketCard
                    key={m.id}
                    market={mapProtocolMarketToCard(m)}
                    onOpenLogin={onOpenLogin}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
