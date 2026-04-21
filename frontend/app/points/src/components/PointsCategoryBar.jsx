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
// `highlight: true` applies the attention-grabbing tri-color
// gradient treatment — used for the World Cup tab so it pops.
export const CATEGORY_TABS = [
  { slug: 'all',         tKey: 'points.cat.trending'    },
  { slug: 'world-cup',   tKey: 'points.cat.worldCup',   highlight: true },
  { slug: 'deportes',    tKey: 'points.cat.deportes'    },
  { slug: 'musica',      tKey: 'points.cat.musica'      },
  { slug: 'mexico',      tKey: 'points.cat.mexico'      },
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
              // Special treatment for the World Cup tab — tri-color
              // gradient (green/red/blue host flags) with a subtle
              // shine so it catches the eye in the row.
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
