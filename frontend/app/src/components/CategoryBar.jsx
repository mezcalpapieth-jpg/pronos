/**
 * MVP sticky category bar — route-based, mirroring the Points layout.
 *
 * Order of buttons (visual → route):
 *   Trending       → /
 *   Mundial 2026   → /c/world-cup   (highlighted tri-color gradient)
 *   Deportes       → /c/deportes
 *   Música         → /c/musica
 *   México         → /c/mexico
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
  { slug: 'all',         label: 'Trending'     },
  { slug: 'world-cup',   label: 'Mundial 2026', highlight: true },
  { slug: 'deportes',    label: 'Deportes'     },
  { slug: 'musica',      label: 'Música'       },
  { slug: 'mexico',      label: 'México'       },
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
