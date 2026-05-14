/**
 * MVP per-category page — /mvp/c/:slug.
 *
 * Mirrors PointsCategoryPage, filtered to mode='onchain':
 *   - /c/deportes    → SPORT sub-tabs (soccer, beisbol, NBA, NFL, F1,
 *                      tennis, golf). Soccer + baseball get a league
 *                      sidebar (UCL/La Liga/Premier/…, MLB/LMB).
 *   - /c/porresolver → filters active markets whose endTime passed.
 *   - /c/resueltos   → fetches status='resolved'.
 *   - Everything else → category filter only.
 *
 * Sport + league come from market.sport / market.league, populated by
 * the generator pipeline when markets are approved.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import MarketCard from '../components/MarketCard.jsx';
import { mapProtocolMarketToCard } from '../lib/mvpMarketCard.js';

const CHAIN_ID = Number(import.meta.env.VITE_ONCHAIN_CHAIN_ID || 421614);

const SLUG_LABELS = {
  deportes:    'Deportes',
  musica:      'Música',
  mexico:      'México',
  politica:    'Política',
  crypto:      'Crypto',
  finanzas:    'Finanzas',
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
  { key: 'uefa-cl',        label: 'Champions'      },
  { key: 'la-liga',        label: 'La Liga'        },
  { key: 'premier-league', label: 'Premier League' },
  { key: 'serie-a',        label: 'Serie A'        },
  { key: 'bundesliga',     label: 'Bundesliga'     },
  { key: 'liga-mx',        label: 'Liga MX'        },
  { key: 'mls',            label: 'MLS'            },
];

const BASEBALL_LEAGUES = [
  { key: 'all', label: 'Todas' },
  { key: 'mlb', label: 'MLB'   },
  { key: 'lmb', label: 'LMB'   },
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

export default function CategoryPage({ onOpenLogin }) {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const sport = searchParams.get('sport') || 'all';
  const league = searchParams.get('league') || 'all';

  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const categoryQuery = slug && !PENDING_SLUGS.has(slug) && !RESOLVED_SLUGS.has(slug)
          ? `&category=${encodeURIComponent(slug)}`
          : '';
        const res = await fetch(
          `/api/protocol/markets?status=${fetchStatus}&limit=200&chainId=${CHAIN_ID}${categoryQuery}`,
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
  }, [fetchStatus, slug]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const isPending = (m) =>
      m.status === 'active' && m.endTime && new Date(m.endTime).getTime() < now;

    let out = markets;
    if (PENDING_SLUGS.has(slug)) {
      out = out.filter(isPending);
    } else if (RESOLVED_SLUGS.has(slug)) {
      // resolved already filtered at fetch time.
    } else {
      out = out.filter(m => !isPending(m));
      out = out.filter(m => (m.category || '').toLowerCase() === slug);
    }

    if (slug === 'deportes' && sport !== 'all') {
      out = out.filter(m => (m.sport || '').toLowerCase() === sport);
      if ((sport === 'soccer' || sport === 'baseball' || sport === 'combate') && league !== 'all') {
        out = out.filter(m => (m.league || '').toLowerCase() === league);
      }
    }

    return out;
  }, [markets, slug, sport, league]);

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

  const title = SLUG_LABELS[slug] || (slug || '').replace(/-/g, ' ');
  const showSportTabs = slug === 'deportes';
  const showLeagueSidebar = slug === 'deportes' && (sport === 'soccer' || sport === 'baseball' || sport === 'combate');
  const leagueOptions = sport === 'soccer'
    ? SOCCER_LEAGUES
    : sport === 'baseball'
      ? BASEBALL_LEAGUES
      : COMBATE_LEAGUES;

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
          </div>
        )}

        {/* Layout: sidebar (leagues) + grid — or just grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: showLeagueSidebar ? '200px 1fr' : '1fr',
          gap: 24,
        }}>
          {showLeagueSidebar && (
            <aside style={{
              padding: 14, borderRadius: 12,
              border: '1px solid var(--border)', background: 'var(--surface1)',
              alignSelf: 'start', position: 'sticky', top: 96,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
                color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10,
              }}>
                Ligas
              </div>
              {leagueOptions.map(l => (
                <button
                  key={l.key}
                  onClick={() => setLeague(l.key)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px', borderRadius: 6,
                    background: league === l.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                    border: league === l.key ? '1px solid rgba(0,232,122,0.3)' : '1px solid transparent',
                    color: league === l.key ? 'var(--green)' : 'var(--text-secondary)',
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
