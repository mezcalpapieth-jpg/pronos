/**
 * Sticky category bar — the horizontal filter row that sits just under
 * the nav. Shared across Home, Market detail, and per-category pages so
 * users can jump between categories from any page.
 *
 * Every button is now a navigation link:
 *   - `all` / `trending`  → /
 *   - named category      → /c/<slug>
 *
 * The `active` slug is derived from the current URL, so the bar stays
 * in sync with the route regardless of which page it's rendered on.
 *
 * Horizontally scrollable on narrow viewports via CSS rules in
 * frontend/css/components.css (`.category-bar .market-filters`).
 */
import React from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';

// Order here = visual order in the bar. Each entry maps a URL slug
// (used in /c/<slug>) to the i18n key that produces the label.
// `highlight: true` applies the attention-grabbing Pronos treatment
// for the daily tournament-market bucket.
// `regional: true` applies a softer green/gold treatment for Mexico & Latam.
// `news: true` applies a red-gradient + live-dot treatment for the
// Noticias tab, distinctive but calmer than the highlighted bucket.
export const CATEGORY_TABS = [
  { slug: 'noticias',    tKey: 'points.cat.noticias',   news: true },
  { slug: 'all',         tKey: 'points.cat.trending'    },
  { slug: 'nuevos-mercados', tKey: 'points.cat.worldCup', highlight: true },
  { slug: 'mexico',      tKey: 'points.cat.mexico',      regional: true },
  { slug: 'infraestructura', tKey: 'points.cat.infraestructura' },
  { slug: 'deportes',    tKey: 'points.cat.deportes'    },
  { slug: 'musica',      tKey: 'points.cat.musica'      },
  { slug: 'politica',    tKey: 'points.cat.politica'    },
  { slug: 'crypto',      tKey: 'points.cat.crypto'      },
  { slug: 'finanzas',    tKey: 'points.cat.finanzas'    },
  { slug: 'porresolver', tKey: 'points.cat.porresolver' },
  { slug: 'resueltos',   tKey: 'points.cat.resueltos'   },
];

/**
 * Resolve the "active" category slug from the current URL. Home (/) is
 * 'all'; /c/<slug> extracts the slug.
 */
export function activeSlugFromLocation(pathname, params) {
  if (params?.slug) return params.slug;
  if (pathname === '/' || pathname === '') return 'all';
  const m = pathname.match(/^\/c\/([^/]+)/);
  return m ? m[1] : null; // null on unrelated pages (market detail, portfolio)
}

export default function PointsCategoryBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const t = useT();
  const active = activeSlugFromLocation(location.pathname, params);

  function handleClick(slug) {
    if (slug === 'all') navigate('/');
    else navigate(`/c/${slug}`);
  }

  return (
    <div className="category-bar">
      <div className="category-bar-inner">
        <div className="market-filters">
          {CATEGORY_TABS.map(cat => {
            const isActive = active === cat.slug;
            if (cat.highlight) {
              // Special treatment for the tournament drop bucket: a
              // Pronos orange/green treatment so it catches the eye
              // without reading as the archived tournament tab.
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  style={{
                    background: isActive
                      ? 'linear-gradient(130deg, rgba(255,85,0,0.28), rgba(0,232,122,0.20))'
                      : 'linear-gradient(130deg, rgba(255,85,0,0.15), rgba(0,232,122,0.09))',
                    borderColor: isActive ? 'var(--border-active)' : 'var(--border)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  {t(cat.tKey)}
                </button>
              );
            }
            if (cat.regional) {
              // Mexico & Latam should invite exploration without
              // competing with the highlighted tournament bucket.
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  aria-label={`${t(cat.tKey)} destacado`}
                  style={{
                    background: isActive
                      ? 'linear-gradient(130deg, rgba(22,163,74,0.24), rgba(245,158,11,0.20))'
                      : 'linear-gradient(130deg, rgba(22,163,74,0.11), rgba(245,158,11,0.08))',
                    borderColor: isActive ? 'rgba(245,158,11,0.55)' : 'rgba(245,158,11,0.32)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    display: 'inline-flex',
                    alignItems: 'center',
                  }}
                >
                  {t(cat.tKey)}
                </button>
              );
            }
            if (cat.news) {
              // Noticias tab — single-hue red gradient + a pulsing
              // live-dot. Distinctive but less loud than the
              // highlighted tournament bucket.
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  style={{
                    background: isActive
                      ? 'linear-gradient(130deg, rgba(220,38,38,0.35), rgba(255,69,69,0.20))'
                      : 'linear-gradient(130deg, rgba(220,38,38,0.16), rgba(255,69,69,0.08))',
                    borderColor: isActive ? 'var(--danger)' : 'rgba(255,69,69,0.35)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: 'var(--danger)',
                      boxShadow: '0 0 0 3px rgba(255,69,69,0.18)',
                      animation: 'pronos-news-pulse 1.6s ease-in-out infinite',
                    }}
                  />
                  {t(cat.tKey)}
                </button>
              );
            }
            return (
              <button
                key={cat.slug}
                className={`filter-btn${isActive ? ' active' : ''}`}
                onClick={() => handleClick(cat.slug)}
              >
                {t(cat.tKey)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
