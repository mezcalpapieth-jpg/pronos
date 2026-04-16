/**
 * Home page for the points-app.
 *
 * Sections (top to bottom):
 *   1. Compact hero with the competition pitch + CTA
 *   2. Category filter row
 *   3. Markets grid
 *   4. "How it works" — 3-step explainer
 *
 * No waitlist. "Crear cuenta" lives in the nav only; the page itself
 * assumes the user can already browse.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMarkets } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import PointsMarketCard from '../components/PointsMarketCard.jsx';

const CATEGORIES = [
  { key: 'all',          label: '🔥 Todos' },
  { key: 'mexico',       label: '🇲🇽 México' },
  { key: 'politica',     label: '🌎 Política' },
  { key: 'deportes',     label: '⚽ Deportes' },
  { key: 'finanzas',     label: '$ Finanzas' },
  { key: 'crypto',       label: '₿ Crypto' },
  { key: 'musica',       label: '🎵 Farándula' },
  { key: 'resueltos',    label: '🏆 Resueltos' },
];

export default function PointsHome({ onOpenLogin }) {
  const navigate = useNavigate();
  const { authenticated, user } = usePointsAuth();
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
          setError(e.code || e.message || 'load_failed');
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

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section style={{
        padding: '80px 48px 40px',
        maxWidth: 1280,
        margin: '0 auto',
      }}>
        <div style={{ maxWidth: 780 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 20,
            background: 'rgba(0,232,122,0.08)',
            border: '1px solid rgba(0,232,122,0.25)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--green)',
            marginBottom: 24,
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: 'var(--green)',
              boxShadow: '0 0 8px var(--green)',
            }} />
            Beta — Competencia MXNP
          </div>

          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(40px, 6vw, 72px)',
            lineHeight: 1.05,
            letterSpacing: '0.02em',
            color: 'var(--text-primary)',
            marginBottom: 20,
          }}>
            Predice, gana <span style={{ color: 'var(--green)' }}>MXNP</span>,<br />
            compite por <span style={{ color: 'var(--green)' }}>premios reales</span>.
          </h1>

          <p style={{
            fontSize: 18,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: 28,
            maxWidth: 640,
          }}>
            Compra acciones en eventos reales con MXNP — la moneda de Pronos.
            Cada dos semanas, los 3 mejores del leaderboard ganan <strong style={{ color: 'var(--text-primary)' }}>5,000, 3,000 y 2,000 MXN</strong> en efectivo.
            Puestos 4–10 reciben premios sorpresa.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {!authenticated ? (
              <button className="btn-primary" onClick={onOpenLogin}>
                Crear cuenta gratis
              </button>
            ) : (
              <button className="btn-primary" onClick={() => navigate('/portfolio')}>
                Ver mi portafolio
              </button>
            )}
            <a href="#how-it-works" className="btn-ghost">
              Cómo funciona
            </a>
          </div>
        </div>
      </section>

      {/* ── Category filter ─────────────────────────────────── */}
      <section style={{
        padding: '8px 48px',
        maxWidth: 1280,
        margin: '0 auto',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
      }}>
        {CATEGORIES.map(cat => {
          const active = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: `1px solid ${active ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: active ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: active ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {cat.label}
            </button>
          );
        })}
      </section>

      {/* ── Markets grid ────────────────────────────────────── */}
      <section style={{
        padding: '24px 48px 60px',
        maxWidth: 1280,
        margin: '0 auto',
      }}>
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
          }}>
            No pudimos cargar los mercados ({error}). Refresca la página.
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

      {/* ── How it works ────────────────────────────────────── */}
      <section id="how-it-works" style={{
        padding: '60px 48px 80px',
        maxWidth: 1280,
        margin: '0 auto',
        borderTop: '1px solid var(--border)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            color: 'var(--green)',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}>
            Simple · Rápido · Justo
          </div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(32px, 4vw, 48px)',
            color: 'var(--text-primary)',
            letterSpacing: '0.02em',
          }}>
            Cómo funciona
          </h2>
        </div>

        <div className="steps-grid">
          {[
            { n: '01', t: 'Crea tu cuenta', d: 'Email + código. Nada más. Recibes 500 MXNP de bienvenida.' },
            { n: '02', t: 'Predice eventos', d: 'Compra acciones en mercados de deportes, política, crypto y más. Los precios se mueven con la demanda.' },
            { n: '03', t: 'Gana premios reales', d: 'Acumula MXNP ganando tus predicciones. Los Top 10 del leaderboard quincenal reciben premios en efectivo.' },
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
