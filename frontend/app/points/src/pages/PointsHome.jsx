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
import { useNavigate } from 'react-router-dom';
import { fetchMarkets } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import PointsMarketCard from '../components/PointsMarketCard.jsx';

const CATEGORIES = [
  { key: 'all',       label: '🔥 Trending' },
  { key: 'musica',    label: '🎵 Música & Farándula' },
  { key: 'mexico',    label: '🇲🇽 México & CDMX' },
  { key: 'politica',  label: '🌎 Política Internacional' },
  { key: 'deportes',  label: '⚽ Deportes' },
  { key: 'crypto',    label: '₿ Crypto' },
  { key: 'resueltos', label: '🏆 Resueltos' },
];

export default function PointsHome({ onOpenLogin }) {
  const navigate = useNavigate();
  const { authenticated } = usePointsAuth();
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const status = activeCategory === 'resueltos' ? 'resolved' : 'active';
        const m = await fetchMarkets({ status });
        if (!cancelled) {
          setMarkets(m);
          setLoading(false);
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
  }, [activeCategory]);

  const filtered = useMemo(() => {
    if (activeCategory === 'all' || activeCategory === 'resueltos') return markets;
    return markets.filter(m => (m.category || '').toLowerCase() === activeCategory);
  }, [markets, activeCategory]);

  // Derived stats for the hero — pulled live from the markets list so they
  // stay honest. Falls back to friendly defaults when markets are loading.
  const stats = useMemo(() => {
    const activeCount = markets.filter(m => m.status === 'active').length;
    const totalVolume = markets.reduce((s, m) => s + (Number(m.tradeVolume || 0)), 0);
    return { activeCount, totalVolume };
  }, [markets]);

  return (
    <>
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
              <span>Beta · Competencia MXNP</span>
            </div>

            <h1 className="hero-headline">
              Predice, gana<br />
              <span className="accent">MXNP</span>,<br />
              compite por premios
            </h1>

            <p className="hero-sub">
              Compra acciones en eventos reales con MXNP — la moneda de Pronos.
              Cada dos semanas los <strong>3 mejores</strong> del leaderboard ganan
              <strong> $5,000, $3,000 y $2,000 MXN</strong> en efectivo.
              Puestos 4–10 reciben premios sorpresa.
            </p>

            <div className="hero-btns">
              {!authenticated ? (
                <button className="btn-primary" onClick={onOpenLogin}>
                  Crear cuenta gratis
                </button>
              ) : (
                <button className="btn-primary" onClick={() => navigate('/portfolio')}>
                  Ver mi portafolio
                </button>
              )}
              <a href="#how-it-works" className="btn-ghost">Cómo funciona</a>
            </div>

            <div className="hero-stats">
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">500</span> MXNP
                </span>
                <span className="hero-stat-label">bono de bienvenida</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">+20</span>/día
                </span>
                <span className="hero-stat-label">bono por racha</span>
              </div>
              <div className="hero-stat">
                <span className="hero-stat-val">
                  <span className="green">{stats.activeCount}</span>
                </span>
                <span className="hero-stat-label">mercados activos</span>
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
                <span>CICLO ACTUAL · PREMIOS</span>
              </div>
            </div>

            <div className="hmc-question" style={{ marginBottom: 22 }}>
              Top 10 del leaderboard cada quincena
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
              {[
                { rank: '🥇 1°',    prize: '$5,000 MXN',  accent: true },
                { rank: '🥈 2°',    prize: '$3,000 MXN',  accent: true },
                { rank: '🥉 3°',    prize: '$2,000 MXN',  accent: true },
                { rank: '4°–10°',    prize: '🎁 Premio sorpresa' },
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
              <span>RANKING POR P&amp;L</span>
              <span>REWARDS EN EFECTIVO</span>
            </div>
          </aside>
        </div>
      </section>

      {/* ── Category bar ─────────────────────────────────────
          Same shell classes the landing uses so the pill styles + horizontal
          scroll behavior on mobile match. */}
      <div className="category-bar">
        <div className="category-bar-inner">
          <div className="market-filters">
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                className={`filter-btn${activeCategory === cat.key ? ' active' : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      </div>

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
            Cargando mercados…
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
            No pudimos cargar los mercados · {error}
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
            🎯 No hay mercados en esta categoría todavía.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="markets-grid">
            {filtered.map(m => (
              <PointsMarketCard key={m.id} market={m} />
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
          <div className="section-eyebrow">Simple · Rápido · Justo</div>
          <div className="section-title">Cómo funciona</div>
        </div>

        <div className="steps-grid">
          {[
            { n: '01', t: 'Crea tu cuenta',    d: 'Email + código. Nada más. Recibes 500 MXNP de bienvenida.' },
            { n: '02', t: 'Predice eventos',   d: 'Compra acciones en mercados de deportes, política, crypto y más. Los precios se mueven con la demanda.' },
            { n: '03', t: 'Gana premios reales', d: 'Acumula MXNP acertando predicciones. Los Top 10 del leaderboard quincenal reciben premios en efectivo.' },
          ].map(s => (
            <div key={s.n} className="step">
              <div className="step-num">{s.n}</div>
              <div className="step-title">{s.t}</div>
              <p className="step-desc">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
