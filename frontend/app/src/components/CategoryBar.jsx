/**
 * MVP sticky category bar — route-based, mirroring the Points layout.
 *
 * Order of buttons (visual → route):
 *   Trending       → /
 *   Mundial 2026   → /c/world-cup   (highlighted tri-color gradient)
 *   Mexico & Latam → /c/mexico      (softer regional spark)
 *   Deportes       → /c/deportes
 *   Música         → /c/musica
 *   Política       → /c/politica
 *   Crypto         → /c/crypto
 *   Finanzas       → /c/finanzas
 *   Por resolver   → /c/porresolver
 *   Resueltos      → /c/resueltos
 *
 * The active slug is derived from the current URL so the bar stays in
 * sync regardless of which page renders it (Home, CategoryPage,
 * MarketDetail, WorldCupPage, etc).
 */
import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

export const CATEGORY_TABS = [
  { slug: 'noticias',    label: 'Noticias',    news: true },
  { slug: 'all',         label: 'Trending'     },
  { slug: 'world-cup',   label: 'Mundial 2026', highlight: true },
  { slug: 'mexico',      label: 'Mexico & Latam', regional: true },
  { slug: 'deportes',    label: 'Deportes'     },
  { slug: 'musica',      label: 'Música'       },
  { slug: 'politica',    label: 'Política'     },
  { slug: 'crypto',      label: 'Crypto'       },
  { slug: 'finanzas',    label: 'Finanzas'     },
  { slug: 'porresolver', label: 'Por resolver' },
  { slug: 'resueltos',   label: 'Resueltos'    },
];

export function activeSlugFromLocation(pathname, params) {
  if (params?.slug) return params.slug;
  if (pathname === '/' || pathname === '/mvp' || pathname === '/mvp/') return 'all';
  const m = pathname.match(/^\/c\/([^/]+)/);
  return m ? m[1] : null;
}

export default function CategoryBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
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
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  style={{
                    background: isActive
                      ? 'linear-gradient(130deg, rgba(22,163,74,0.35), rgba(220,38,38,0.32) 50%, rgba(59,130,246,0.38))'
                      : 'linear-gradient(130deg, rgba(22,163,74,0.18), rgba(220,38,38,0.15) 50%, rgba(59,130,246,0.2))',
                    borderColor: isActive ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.18)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                  }}
                >
                  {cat.label}
                </button>
              );
            }
            if (cat.regional) {
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  aria-label={`${cat.label} destacado`}
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
                    gap: 7,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: 'var(--gold, #f59e0b)',
                      fontSize: 10,
                      lineHeight: 1,
                      textShadow: '0 0 8px rgba(245,158,11,0.35)',
                    }}
                  >
                    ✦
                  </span>
                  {cat.label}
                </button>
              );
            }
            if (cat.news) {
              // Same Noticias treatment as the points-app's CategoryBar
              // (red gradient + pulsing live-dot) so the tab feels
              // identical regardless of which app the user is on.
              return (
                <button
                  key={cat.slug}
                  onClick={() => handleClick(cat.slug)}
                  className="filter-btn"
                  style={{
                    background: isActive
                      ? 'linear-gradient(130deg, rgba(220,38,38,0.35), rgba(255,69,69,0.20))'
                      : 'linear-gradient(130deg, rgba(220,38,38,0.16), rgba(255,69,69,0.08))',
                    borderColor: isActive ? 'var(--red, #FF4545)' : 'rgba(255,69,69,0.35)',
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
                      background: 'var(--red, #FF4545)',
                      boxShadow: '0 0 0 3px rgba(255,69,69,0.18)',
                      animation: 'pronos-news-pulse 1.6s ease-in-out infinite',
                    }}
                  />
                  {cat.label}
                </button>
              );
            }
            return (
              <button
                key={cat.slug}
                className={`filter-btn${isActive ? ' active' : ''}`}
                onClick={() => handleClick(cat.slug)}
              >
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
