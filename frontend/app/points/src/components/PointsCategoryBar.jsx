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
export const CATEGORY_TABS = [
  { slug: 'all',         tKey: 'points.cat.trending'    },
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
          {CATEGORY_TABS.map(cat => (
            <button
              key={cat.slug}
              className={`filter-btn${active === cat.slug ? ' active' : ''}`}
              onClick={() => handleClick(cat.slug)}
            >
              {t(cat.tKey)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
