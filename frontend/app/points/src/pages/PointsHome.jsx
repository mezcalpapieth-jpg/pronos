/**
 * Home page for the points-app.
 *
 * Styled to match the main pronos.io landing (not the MVP):
 *   - PointsTicker strip across the top (in App.jsx, not here)
 *   - Hero with two columns: copy + stats on the left, featured card on the right
 *   - Category filter bar under the hero
 *   - Markets grid
 *   - How-it-works section
 *
 * The shared CSS at /css/base.css + /css/components.css + /css/sections.css
 * provides .hero-inner, .hero-left, .hero-badge, .hero-headline, .hero-sub,
 * .hero-btns, .hero-stats, .category-bar, .markets-grid, etc. We reuse the
 * same class names so the look matches pixel-for-pixel.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMarkets, fetchCurrentCycle, fetchPositions } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT } from '@app/lib/i18n.js';
import PointsMarketCard from '../components/PointsMarketCard.jsx';

// Human-readable "2d 14h 37m" style countdown for the cycle deadline.
// Lives at the module scope so React doesn't recreate it each render.
function formatCountdown(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'ciclo terminó';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

// Tab key → translation key. Labels are resolved via useT() so the bar
// flips when the user toggles EN/ES.
const CATEGORIES = [
  { key: 'all',         tKey: 'points.cat.trending'    },
  { key: 'musica',      tKey: 'points.cat.musica'      },
  { key: 'mexico',      tKey: 'points.cat.mexico'      },
  { key: 'politica',    tKey: 'points.cat.politica'    },
  { key: 'deportes',    tKey: 'points.cat.deportes'    },
  { key: 'crypto',      tKey: 'points.cat.crypto'      },
  { key: 'porresolver', tKey: 'points.cat.porresolver' },
  { key: 'resueltos',   tKey: 'points.cat.resueltos'   },
];

export default function PointsHome({ onOpenLogin }) {
  const navigate = useNavigate();
  const { authenticated } = usePointsAuth();
  const t = useT();
  const [searchParams] = useSearchParams();
  const [markets, setMarkets] = useState([]);
  const [positionByMarket, setPositionByMarket] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [cycle, setCycle] = useState(null);
  const [cycleTick, setCycleTick] = useState(0); // forces re-render each minute

  // Search value comes from the nav input (mirrored to ?q=<text>). Living
  // in the URL keeps deep-links work and lets the nav share state without
  // a React context.
  const searchQuery = searchParams.get('q') || '';

  // Load the current cycle once on mount. The countdown updates each
  // minute via a local interval — cheaper than refetching and responsive
  // enough for a 2-week window. When the browser tab is backgrounded,
  // setInterval may fire less often, but re-fetching on mount still gives
  // us a fresh deadline if the admin rolled over while the tab was idle.
  useEffect(() => {
    let cancelled = false;
    fetchCurrentCycle()
      .then(c => { if (!cancelled) setCycle(c); })
      .catch(() => { /* non-critical — home still works without the badge */ });
    const id = setInterval(() => setCycleTick(t => t + 1), 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Compute remaining time fresh each render tick so the countdown
  // visibly ticks down without extra server calls.
  const cycleCountdown = useMemo(() => {
    if (!cycle?.endsAt) return null;
    const sec = Math.max(0, Math.floor((new Date(cycle.endsAt).getTime() - Date.now()) / 1000));
    return { seconds: sec, label: formatCountdown(sec) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle, cycleTick]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        // "Por resolver" and "Trending" plus every category tab all view
        // active rows. The DB has no separate 'pending' state — pending
        // just means status='active' with endTime in the past, so we
        // fetch active and slice client-side in the `filtered` memo.
        const status = activeCategory === 'resueltos' ? 'resolved' : 'active';
        const m = await fetchMarkets({ status });
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
          const parts = [e.code || e.message || 'load_failed'];
          if (e.detail) parts.push(e.detail);
          setError(parts.join(' · '));
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [activeCategory, authenticated]);

  // Layered filtering:
  //   1. Search, when non-empty, bypasses the category tab — a query on
  //      "bitcoin" should surface crypto markets even if the user is
  //      parked on the Deportes tab, otherwise the search feels "broken"
  //      when no results appear in the current category.
  //   2. "Por resolver" = status='active' AND endTime < now. Pending
  //      markets DO appear in Trending too; this tab just isolates them.
  //   3. Regular category tabs filter by m.category.
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let out = markets;

    if (q) {
      // Global search across the loaded status bucket (active or
      // resolved); don't also narrow by category.
      return out.filter(m => (m.question || '').toLowerCase().includes(q));
    }

    if (activeCategory === 'porresolver') {
      const now = Date.now();
      out = out.filter(m => m.status === 'active' && m.endTime && new Date(m.endTime).getTime() < now);
    } else if (activeCategory !== 'all' && activeCategory !== 'resueltos') {
      out = out.filter(m => (m.category || '').toLowerCase() === activeCategory);
    }
    return out;
  }, [markets, activeCategory, searchQuery]);

  // Derived stats for the hero — pulled live from the markets list so they
  // stay honest. Falls back to friendly defaults when markets are loading.
  const stats = useMemo(() => {
    const activeCount = markets.filter(m => m.status === 'active').length;
    const totalVolume = markets.reduce((s, m) => s + (Number(m.tradeVolume || 0)), 0);
    return { activeCount, totalVolume };
  }, [markets]);

  return (
    <>
      {/* ── Category bar ─────────────────────────────────────
          Rendered BEFORE the hero so it sits immediately under the
          sticky nav (top: 64px). That matches the main pronos.io
          landing's layout where the category pills are always visible
          without needing to scroll past the hero first. */}
      <div className="category-bar">
        <div className="category-bar-inner">
          <div className="market-filters">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className={`filter-btn${activeCategory === cat.key ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {t(cat.tKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Hero ───────────────────────────────────────────────
          Grid layout mirrors #hero > .hero-inner from the main site:
          left column = copy + stats, right column = a compact featured
          market card. */}
      <section id="hero">
        <div className="hero-inner">

          {/* Left column */}
          <div className="hero-left">
            <div className="hero-badge">
              <span className="dot" />
              <span>{t('points.hero.badge')}</span>
            </div>

            <h1 className="hero-headline">
              {t('points.hero.headline.a')}<br />
              <span className="accent">{t('points.hero.headline.b')}</span>,<br />
              {t('points.hero.headline.c')}
            </h1>

            {/* Hero subtitle — split on sentinel tags so the two {strong}
                runs render as <strong> without needing dangerouslySetInnerHTML. */}
            <p className="hero-sub">
              {(() => {
                const raw = t('points.hero.sub');
                const parts = raw.split(/\{\/?strong\}/g);
                return parts.map((chunk, i) => i % 2 === 1
                  ? <strong key={i}>{chunk}</strong>
                  : <React.Fragment key={i}>{chunk}</React.Fragment>);
              })()}
            </p>

            <div className="hero-btns">
              {!authenticated ? (
                <button className="btn-primary" onClick={onOpenLogin}>
                  {t('points.hero.cta.createAccount')}
                </button>
              ) : (
                <button className="btn-primary" onClick={() => navigate('/portfolio')}>
                  {t('points.hero.cta.myPortfolio')}
                </button>
              )}
              <a href="#how-it-works" className="btn-ghost">{t('points.nav.howItWorks')}</a>
            </div>

            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">500</span> MXNP
                </span>
                <span className="hero-stat-label">{t('points.hero.stats.welcomeBonus')}</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">100</span>+20/día
                </span>
                <span className="hero-stat-label">{t('points.hero.stats.dailyClaim')}</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">{stats.activeCount}</span>
                </span>
                <span className="hero-stat-label">{t('points.hero.stats.activeMarkets')}</span>
              </div>
            </div>
          </div>

          {/* Right column: prize-pool hero card */}
          <aside className="hmc" style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 24,
          }}>
            <div className="hmc-topbar" style={{ marginBottom: 18 }}>
              <div className="hmc-cat">
                <div className="hmc-live-dot" />
                <span>{cycle?.label ? cycle.label.toUpperCase() : t('points.hero.currentCycle')}</span>
              </div>
              {cycleCountdown && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: cycleCountdown.seconds === 0 ? '#f59e0b' : 'var(--green)',
                  textTransform: 'uppercase',
                }}>
                  {cycleCountdown.seconds === 0 ? t('points.hero.closePending') : `⏳ ${cycleCountdown.label}`}
                </span>
              )}
            </div>

            <div className="hmc-question" style={{ marginBottom: 22 }}>
              {t('points.hero.top10Text')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {[
                { rank: '🥇 1°',    prize: '$5,000 MXN',         accent: true },
                { rank: '🥈 2°',    prize: '$3,000 MXN',         accent: true },
                { rank: '🥉 3°',    prize: '$2,000 MXN',         accent: true },
                { rank: '4°–10°',    prize: t('points.hero.surprisePrize') },
              ].map(p => (
                <div key={p.rank} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  background: 'var(--surface2)',
                  border: `1px solid ${p.accent ? 'rgba(0,232,122,0.18)' : 'var(--border)'}`,
                  borderRadius: 10,
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    letterSpacing: '0.04em',
                    color: 'var(--text-secondary)',
                  }}>
                    {p.rank}
                  </span>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 18,
                    color: p.accent ? 'var(--green)' : 'var(--text-primary)',
                    letterSpacing: '0.02em',
                  }}>
                    {p.prize}
                  </span>
                </div>
              ))}
            </div>

            {/* Eligibility rule — users only qualify for cash prizes if
                they participated in at least 10 markets during the
                cycle. This prevents "claim-and-hoard" strategies that
                don't contribute to the market, and keeps the leaderboard
                tied to actual prediction activity. */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              background: 'rgba(255,85,0,0.06)',
              border: '1px solid rgba(255,85,0,0.25)',
              borderRadius: 10,
              marginBottom: 14,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              letterSpacing: '0.02em',
            }}>
              <span style={{ fontSize: 12, lineHeight: 1, marginTop: 1 }}>⚠️</span>
              <span>
                {(() => {
                  const raw = t('points.hero.eligibility', { n: '10' });
                  // Highlight the "10 mercados" run by colouring the digits.
                  // Simple split since only one number appears in the string.
                  return raw.split('10').map((chunk, i, arr) => (
                    <React.Fragment key={i}>
                      {chunk}
                      {i < arr.length - 1 && (
                        <strong style={{ color: '#ff5500' }}>10</strong>
                      )}
                    </React.Fragment>
                  ));
                })()}
              </span>
            </div>

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 0 0',
              borderTop: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-muted)',
              letterSpacing: '0.04em',
            }}>
              <span>{t('points.hero.rankBy')}</span>
              <span>{t('points.hero.cashPrizes')}</span>
            </div>
          </aside>
        </div>
      </section>

      {/* ── Markets grid ──────────────────────────────────── */}
      <section id="market" style={{ padding: '36px 48px 60px', maxWidth: 1280, margin: '0 auto' }}>
        {loading && (
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
        )}
        {error && !loading && (
          <div style={{
            textAlign: 'center',
            padding: 40,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--red, #ef4444)',
            whiteSpace: 'pre-wrap',
          }}>
            {t('points.home.loadError', { err: error })}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: 60,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            color: 'var(--text-muted)',
          }}>
            {searchQuery
              ? t('points.home.emptySearch', { q: searchQuery })
              : activeCategory === 'porresolver'
                ? `🎯 ${t('points.home.emptyPending')}`
                : `🎯 ${t('points.home.empty')}`}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="markets-grid">
            {filtered.map(m => (
              <PointsMarketCard key={m.id} market={m} userPosition={positionByMarket[m.id]} />
            ))}
          </div>
        )}
      </section>

      {/* ── How it works ──────────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: '60px 48px 80px',
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
        padding: '48px 48px 72px',
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
