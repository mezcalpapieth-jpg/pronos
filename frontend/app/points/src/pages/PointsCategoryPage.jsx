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
import { useParams, useSearchParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { fetchMarkets, fetchPositions } from '../lib/pointsApi.js';
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
// everything deportes-tagged. NFL/tennis/golf are listed but will be
// empty until the corresponding generators ship.
const SPORT_TABS = [
  { key: 'all',    tKey: 'points.sport.all'    },
  { key: 'soccer', tKey: 'points.sport.soccer' },
  { key: 'mlb',    tKey: 'points.sport.mlb'    },
  { key: 'nba',    tKey: 'points.sport.nba'    },
  { key: 'nfl',    tKey: 'points.sport.nfl'    },
  { key: 'f1',     tKey: 'points.sport.f1'     },
  { key: 'tennis', tKey: 'points.sport.tennis' },
  { key: 'golf',   tKey: 'points.sport.golf'   },
];

// Soccer leagues sidebar. `key` maps to market.league as set by the
// generators (see COMPETITION_TO_LEAGUE in market-gen/soccer.js and the
// espn-soccer generator).
const SOCCER_LEAGUES = [
  { key: 'all',            tKey: 'points.league.all'           },
  { key: 'uefa-cl',        tKey: 'points.league.uefaCl'        },
  { key: 'la-liga',        tKey: 'points.league.laLiga'        },
  { key: 'premier-league', tKey: 'points.league.premier'       },
  { key: 'serie-a',        tKey: 'points.league.serieA'        },
  { key: 'bundesliga',     tKey: 'points.league.bundesliga'    },
  { key: 'liga-mx',        tKey: 'points.league.ligaMx'        },
  { key: 'mls',            tKey: 'points.league.mls'           },
];

// Category tabs that want resolved markets instead of active.
const RESOLVED_SLUGS = new Set(['resueltos']);
// Category tabs that want pending markets (active + endTime in the past).
const PENDING_SLUGS = new Set(['porresolver']);

export default function PointsCategoryPage() {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const t = useT();
  const { authenticated } = usePointsAuth();
  const [markets, setMarkets] = useState([]);
  const [positionByMarket, setPositionByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const searchQuery = (searchParams.get('q') || '').trim();
  const sport  = searchParams.get('sport')  || 'all';
  const league = searchParams.get('league') || 'all';

  // Status to fetch — resueltos loads resolved; everything else fetches
  // active and filters client-side for "pending" if needed.
  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const m = await fetchMarkets({ status: fetchStatus });
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
      // Already resolved by fetchStatus — no extra filtering here.
    } else {
      // Regular category: hide pending from the main grid.
      out = out.filter(m => !isPending(m));
      out = out.filter(m => (m.category || '').toLowerCase() === slug);
    }

    // Sports sub-filter: only when on /c/deportes.
    if (slug === 'deportes' && sport !== 'all') {
      out = out.filter(m => (m.sport || '').toLowerCase() === sport);
      // Soccer league sidebar: only when a specific sport is soccer.
      if (sport === 'soccer' && league !== 'all') {
        out = out.filter(m => (m.league || '').toLowerCase() === league);
      }
    }

    if (q) {
      out = out.filter(m => (m.question || '').toLowerCase().includes(q));
    }

    return out;
  }, [markets, slug, sport, league, searchQuery]);

  function setSport(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('sport');
    else params.set('sport', next);
    // Reset league whenever we pivot away from soccer.
    if (next !== 'soccer') params.delete('league');
    setSearchParams(params, { replace: true });
  }

  function setLeague(next) {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('league');
    else params.set('league', next);
    setSearchParams(params, { replace: true });
  }

  const titleKey = SLUG_TO_TITLE_KEY[slug] || null;
  const showSportBar = slug === 'deportes';
  const showLeagueSidebar = slug === 'deportes' && sport === 'soccer';

  return (
    <section style={{
      maxWidth: 1280,
      margin: '0 auto',
      padding: '28px 48px 60px',
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

      {/* Sports sub-filter row — only on /c/deportes */}
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
        </div>
      )}

      {/* Body: soccer view gets a left sidebar; everything else is a
          single column. */}
      {showLeagueSidebar ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '200px 1fr',
          gap: 24,
          alignItems: 'start',
        }}>
          <aside style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            position: 'sticky',
            top: 120, // below nav + category bar
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
            {SOCCER_LEAGUES.map(l => (
              <button
                key={l.key}
                onClick={() => setLeague(l.key)}
                style={{
                  textAlign: 'left',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  padding: '8px 10px',
                  background: league === l.key ? 'var(--green-dim)' : 'transparent',
                  color: league === l.key ? 'var(--green)' : 'var(--text-secondary)',
                  border: `1px solid ${league === l.key ? 'var(--border-active)' : 'var(--border)'}`,
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
