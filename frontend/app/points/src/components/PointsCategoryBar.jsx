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
import { Sparkles } from 'lucide-react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import { Pill } from '../ui/index.jsx';
import { stocksEnabled } from '../lib/stockApi.js';
import { usePointsExecution } from '../lib/PointsExecution.jsx';

// Order here = visual order in the bar. Each entry maps a URL slug
// (used in /c/<slug>) to the i18n key that produces the label.
export const CATEGORY_TABS = [
  { slug: 'noticias',    tKey: 'points.cat.noticias',   news: true },
  { slug: 'all',         tKey: 'points.cat.trending'    },
  ...(stocksEnabled ? [{ slug: 'stocks', tKey: 'points.cat.stocks' }] : []),
  { slug: 'nuevos-mercados', tKey: 'points.cat.worldCup', highlight: true },
  { slug: 'mexico',      tKey: 'points.cat.mexico'      },
  { slug: 'deportes',    tKey: 'points.cat.deportes'    },
  { slug: 'musica',      tKey: 'points.cat.musica'      },
  { slug: 'politica',    tKey: 'points.cat.politica'    },
  { slug: 'ai',          tKey: 'points.cat.ai'           },
  { slug: 'crypto',      tKey: 'points.cat.crypto'      },
  { slug: 'finanzas',    tKey: 'points.cat.finanzas'    },
  { slug: 'infraestructura', tKey: 'points.cat.infraestructura' },
  { slug: 'porresolver', tKey: 'points.cat.porresolver' },
  { slug: 'resueltos',   tKey: 'points.cat.resueltos'   },
];

/**
 * Resolve the "active" category slug from the current URL. Home (/) is
 * 'all'; /c/<slug> extracts the slug.
 */
export function activeSlugFromLocation(pathname, params) {
  if (pathname === '/stocks' || pathname.startsWith('/stocks/')) return 'stocks';
  if (params?.slug) return params.slug;
  if (pathname === '/' || pathname === '') return 'all';
  const m = pathname.match(/^\/c\/([^/]+)/);
  return m ? m[1] : null; // null on unrelated pages (market detail, portfolio)
}

export default function PointsCategoryBar() {
  const { mode } = usePointsExecution();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const t = useT();
  const active = activeSlugFromLocation(location.pathname, params);

  function handleClick(slug) {
    if (slug === 'stocks') navigate('/stocks');
    else if (slug === 'all') navigate('/');
    else navigate(`/c/${slug}`);
  }

  return (
    <nav className="category-bar points-category-bar" aria-label={t('points.cat.navigation')}>
      <div className="category-bar-inner">
        <div className="market-filters">
          {CATEGORY_TABS.filter(cat => mode !== 'onchain' || !cat.stocks).map(cat => (
            <Pill
              as="button"
              type="button"
              key={cat.slug}
              className="points-category-pill"
              aria-current={active === cat.slug ? 'page' : undefined}
              onClick={() => handleClick(cat.slug)}
            >
              {cat.news && <span className="points-category-news-dot" aria-hidden="true" />}
              {cat.highlight && <Sparkles size={14} aria-hidden="true" />}
              {cat.label || t(cat.tKey)}
            </Pill>
          ))}
        </div>
      </div>
    </nav>
  );
}
