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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import CategoryBar from '../components/CategoryBar.jsx';
import BetModal from '../components/BetModal.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';

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

const RESOLVED_SLUGS = new Set(['resueltos']);
const PENDING_SLUGS = new Set(['porresolver']);

function pricesFromReserves(reserves) {
  if (!Array.isArray(reserves) || reserves.length < 2) return [];
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function MarketTile({ m, onBet }) {
  const navigate = useNavigate();
  const prices = useMemo(() => {
    if (Array.isArray(m.prices) && m.prices.length > 0) return m.prices;
    return pricesFromReserves(m.reserves || []);
  }, [m]);

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--surface1)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/market?id=${m.id}`)}
          style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4 }}
        >
          {m.question}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
          padding: '3px 6px', borderRadius: 6,
          background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)',
          color: '#60a5fa', textTransform: 'uppercase', whiteSpace: 'nowrap',
        }}>
          on-chain
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(m.outcomes || []).map((label, i) => {
          const pct = Math.round((prices[i] || 0) * 100);
          return (
            <button
              key={i}
              onClick={() => onBet({ market: m, outcomeIndex: i, outcome: label, outcomePct: pct })}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--surface2)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <span style={{ textAlign: 'left' }}>{label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: 'var(--text-muted)', letterSpacing: '0.04em',
              }}>
                {pct}¢
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                padding: '2px 8px', borderRadius: 6,
                background: 'rgba(0,232,122,0.12)', color: 'var(--green)',
                letterSpacing: '0.06em',
              }}>
                APOSTAR
              </span>
            </button>
          );
        })}
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
        letterSpacing: '0.04em', borderTop: '1px solid var(--border)', paddingTop: 10,
      }}>
        <span>#{m.id}</span>
        <span>{m.endTime ? `cierra ${formatDate(m.endTime)}` : ''}</span>
      </div>
    </div>
  );
}

export default function CategoryPage({ onOpenLogin }) {
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authenticated } = usePointsAuth();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [bet, setBet] = useState(null);

  const sport = searchParams.get('sport') || 'all';
  const league = searchParams.get('league') || 'all';

  const fetchStatus = RESOLVED_SLUGS.has(slug) ? 'resolved' : 'active';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/points/markets?mode=onchain&status=${fetchStatus}&featured=all&limit=2000&chain_id=${CHAIN_ID}`,
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
      // resolved already filtered at fetch time.
    } else {
      out = out.filter(m => !isPending(m));
      out = out.filter(m => (m.category || '').toLowerCase() === slug);
    }

    if (slug === 'deportes' && sport !== 'all') {
      out = out.filter(m => (m.sport || '').toLowerCase() === sport);
      if ((sport === 'soccer' || sport === 'baseball') && league !== 'all') {
        out = out.filter(m => (m.league || '').toLowerCase() === league);
      }
    }

    return out;
  }, [markets, slug, sport, league]);

  function handleBet({ market, outcomeIndex, outcome, outcomePct }) {
    if (!authenticated) { onOpenLogin?.(); return; }
    setBet({ market, outcomeIndex, outcome, outcomePct });
  }

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
  const showLeagueSidebar = slug === 'deportes' && (sport === 'soccer' || sport === 'baseball');
  const leagueOptions = sport === 'soccer' ? SOCCER_LEAGUES : BASEBALL_LEAGUES;

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <div className="category-bar-sticky">
        <CategoryBar />
      </div>

      <main style={{ padding: '28px 48px 80px', maxWidth: 1280, margin: '0 auto' }}>
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
                {filtered.map(m => <MarketTile key={m.id} m={m} onBet={handleBet} />)}
              </div>
            )}
          </div>
        </div>
      </main>

      <BetModal
        open={!!bet}
        onClose={() => setBet(null)}
        outcome={bet?.outcome}
        outcomePct={bet?.outcomePct}
        outcomeIndex={bet?.outcomeIndex}
        marketId={bet?.market?.id}
        marketTitle={bet?.market?.question}
        market={bet?.market}
        onOpenLogin={onOpenLogin}
      />

      <Footer />
    </>
  );
}
