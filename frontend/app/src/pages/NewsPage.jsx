/**
 * NewsPage — /c/noticias (shared between points-app and MVP)
 *
 * Aggregated Mexican news feed, sourced from /api/points/news. Top of
 * the page surfaces a hero card (the freshest item across all
 * categories) and a sub-tab bar so users can drill into política /
 * economía / seguridad / internacional / cultura / deportes / farándula
 * without leaving the page.
 *
 * Click-throughs:
 *   - Tap a card → opens the source URL in a new tab.
 *   - Admin only: "Crear mercado de esta noticia" pre-fills the admin
 *     CreateMarketForm via a query string handoff. The destination
 *     varies per app (PointsAdmin in points-app, MVP Admin in MVP) —
 *     callers pass the right base path via the `adminPath` prop.
 *
 * Props:
 *   adminPath  — base path for the admin create-market handoff.
 *                Defaults to '/admin' (points-app's admin within
 *                its own basename). Pass '/mvp/admin' from the MVP.
 *   isAdmin    — boolean, derived in each app from its own admin
 *                username allowlist.
 *
 * The feed is cached server-side (5-min TTL via _lib/news-mexico.js)
 * AND CDN-cached (60s s-maxage). On Vercel the second tab/visitor
 * within the cache window gets the response instantly.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchNews, adminLinkNews, adminUnlinkNews, adminListActiveMarkets, adminHideNews } from '@app/lib/newsApi.js';
import { useT } from '@app/lib/i18n.js';

const SUB_TABS = [
  { key: 'featured',      label: 'Destacadas' },
  { key: 'politica',      label: 'Política' },
  { key: 'economia',      label: 'Economía' },
  { key: 'seguridad',     label: 'Seguridad' },
  { key: 'internacional', label: 'Internacional' },
  { key: 'cultura',       label: 'Cultura' },
  { key: 'deportes',      label: 'Deportes' },
  { key: 'farandula',     label: 'Farándula' },
  { key: 'general',       label: 'Otras' },
];

// Defensive client-side HTML-entity decoder. The server-side decoder
// in news-mexico.js does the heavy lifting, but CDN cache + occasional
// double-encoded feeds (Google News re-emitting an already-encoded
// upstream title) can still leak `&#039;`, `&#8216;`, `&amp;` to the
// browser. We re-run the same logic here so the rendered text is
// always clean regardless of where the caching pipe staled.
//
// Two passes catch double-encoded inputs (&amp;#039; → &#039; → ').
// Idempotent on already-decoded strings.
function decodeEntitiesPass(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number.parseInt(n, 10);
      return Number.isFinite(c) && c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const c = Number.parseInt(h, 16);
      return Number.isFinite(c) && c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : '';
    })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lsquo;/g, '‘').replace(/&rsquo;/g, '’')
    .replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
    .replace(/&hellip;/g, '…').replace(/&middot;/g, '·');
}
function decodeText(s) {
  if (!s) return '';
  return decodeEntitiesPass(decodeEntitiesPass(s));
}

function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return 'hace un momento';
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr} h`;
  const d = Math.floor(hr / 24);
  return `hace ${d} d`;
}

// localStorage key for the source-filter dropdown. We store the
// list of DISABLED source ids (not enabled) so newly-added sources
// default to "shown" without anyone having to opt in. Each user's
// preference persists across visits.
const DISABLED_SOURCES_KEY = 'pronos.news.disabledSources.v1';

function loadDisabledSources() {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(DISABLED_SOURCES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveDisabledSources(set) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DISABLED_SOURCES_KEY, JSON.stringify(Array.from(set)));
  } catch { /* private mode etc — silently ignore */ }
}

export default function NewsPage({ isAdmin = false, adminPath = '/admin' }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const t = useT();

  const initialSub = (searchParams.get('sub') || 'featured').toLowerCase();
  const [sub, setSub] = useState(initialSub);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Picker state for admin "Vincular existente" — open when linkPickerFor
  // holds a news item, null when closed.
  const [linkPickerFor, setLinkPickerFor] = useState(null);
  // Source-filter state. We track which source ids the user has
  // DISABLED rather than enabled — new outlets we add later default
  // to visible without forcing existing users to opt them in.
  const [disabledSources, setDisabledSources] = useState(() => loadDisabledSources());
  function toggleSourceDisabled(sourceId) {
    setDisabledSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      saveDisabledSources(next);
      return next;
    });
  }
  function setAllSourcesEnabled() {
    setDisabledSources(prev => {
      const next = new Set();
      saveDisabledSources(next);
      return next;
    });
  }
  function setAllSourcesDisabled(allIds) {
    setDisabledSources(() => {
      const next = new Set(allIds);
      saveDisabledSources(next);
      return next;
    });
  }

  // Persist sub-tab in URL so a refresh keeps you in the same view
  // and so links can deep-link into a category.
  useEffect(() => {
    if (sub === 'featured') {
      // Drop the param when default — cleaner share URL.
      if (searchParams.get('sub')) {
        const next = new URLSearchParams(searchParams);
        next.delete('sub');
        setSearchParams(next, { replace: true });
      }
    } else if (searchParams.get('sub') !== sub) {
      const next = new URLSearchParams(searchParams);
      next.set('sub', sub);
      setSearchParams(next, { replace: true });
    }
  }, [sub, searchParams, setSearchParams]);

  // Fetch ONCE per page visit (and on manual refresh): always pull
  // the full feed regardless of sub-tab so we can drive both the
  // category filter AND the source-filter counts client-side.
  // Server caches for 5 min so the actual HTTP cost is one request
  // per cache-cycle per visitor.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchNews({ category: 'featured', limit: 120 })
      .then(res => {
        if (cancelled) return;
        const payload = res?.data || res;
        if (!payload || payload.error) throw new Error(payload?.error || 'news_failed');
        // Run every fetched title/summary through the entity decoder
        // once at intake so every render site below sees clean text
        // (cheaper than wrapping each {item.title} interpolation, and
        // catches search/filter strings too). Idempotent on already-
        // decoded strings.
        if (Array.isArray(payload.items)) {
          payload.items = payload.items.map(it => ({
            ...it,
            title: decodeText(it.title),
            summary: decodeText(it.summary),
          }));
        }
        setData(payload);
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'news_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Source filter is applied client-side BEFORE the hero/rest split
  // so disabled sources don't take hero slots. Counts in the sub-
  // tabs also reflect the filtered set so users see what they can
  // actually see.
  const visibleItems = useMemo(() => {
    const items = data?.items || [];
    if (disabledSources.size === 0) return items;
    return items.filter(i => !disabledSources.has(i.sourceId));
  }, [data, disabledSources]);

  // Filtered counts per sub-category — drive the sub-tab badges so
  // they reflect what the user actually sees rather than the raw
  // unfiltered server counts. Items can belong to multiple categories
  // (an article about Sheinbaum's security plan tags both politica and
  // seguridad), so each category gets a +1 for every match.
  const visibleCounts = useMemo(() => {
    const counts = {};
    for (const it of visibleItems) {
      const cats = it.categories || (it.category ? [it.category] : []);
      for (const c of cats) counts[c] = (counts[c] || 0) + 1;
    }
    counts.featured = visibleItems.length;
    return counts;
  }, [visibleItems]);

  // Top-of-page carousel for 'featured': horizontal scroll-snap strip.
  // Goal: surface "interesting" curated items, not breaking-news that
  // just came in. We prefer items that have been in the feed for at
  // least 10 minutes — fresh-but-noisy items still appear in the grid
  // below the carousel, so nothing gets buried.
  //
  // Fallback: if there aren't enough aged items (cold start, sparse
  // news cycle, after a feed flush), fall through to the freshest
  // available so the carousel never goes empty.
  const HERO_COUNT = 12;
  const HERO_MIN_AGE_MS = 10 * 60 * 1000;
  const heroItems = useMemo(() => {
    if (sub !== 'featured') return [];
    const cutoff = Date.now() - HERO_MIN_AGE_MS;
    const aged = visibleItems.filter(i => {
      if (!i.publishedAt) return false;
      const t = new Date(i.publishedAt).getTime();
      return Number.isFinite(t) && t <= cutoff;
    });
    if (aged.length >= 3) return aged.slice(0, HERO_COUNT);
    return visibleItems.slice(0, HERO_COUNT);
  }, [sub, visibleItems]);

  const restItems = useMemo(() => {
    if (sub !== 'featured') {
      // Multi-tag: an item shows up under any of its categories.
      return visibleItems.filter(i => {
        const cats = i.categories || (i.category ? [i.category] : []);
        return cats.includes(sub);
      });
    }
    if (heroItems.length === 0) return visibleItems;
    const heroUrls = new Set(heroItems.map(i => i.url));
    return visibleItems.filter(i => !heroUrls.has(i.url));
  }, [sub, visibleItems, heroItems]);

  function handleCreateMarket(item) {
    if (!isAdmin) return;
    const params = new URLSearchParams({
      tab: 'create',
      question: item.title,
      category: sub === 'internacional' ? 'politica' : (sub === 'featured' ? 'mexico' : sub),
    });
    // Earlier versions used window.location.href which 404'd on the
    // points-app preview because Vercel doesn't auto-fall-back
    // non-root SPA paths (the MVP has explicit rewrites, points-app
    // doesn't). Switching to React Router's navigate keeps us inside
    // the SPA, mounts the admin route directly, and the
    // CreateMarketForm reads the new window.location.search on mount.
    //
    // adminPath is relative to each app's basename:
    //   points-app: '/admin'     → BrowserRouter basename '/'    → /admin
    //   MVP:        '/admin' too → BrowserRouter basename '/mvp' → /mvp/admin
    // (Both apps use the same path inside their own router; the
    // basename does the prefixing.)
    const target = `/admin?${params.toString()}`;
    navigate(target);
  }

  function handleOpenLinkPicker(item) {
    if (!isAdmin) return;
    setLinkPickerFor(item);
  }

  // After linking or unlinking, patch the local data in place so the
  // card re-renders with the new state without a full refetch.
  function patchItemLink(newsUrl, linkedMarket) {
    setData(prev => prev && {
      ...prev,
      items: prev.items.map(it =>
        it.url === newsUrl ? { ...it, linkedMarket } : it,
      ),
    });
  }

  async function handleLink(newsItem, market) {
    try {
      await adminLinkNews({
        newsUrl: newsItem.url,
        newsTitle: newsItem.title,
        newsSource: newsItem.sourceName,
        marketId: market.id,
      });
      patchItemLink(newsItem.url, {
        marketId: market.id,
        question: market.question,
        status: market.status,
        category: market.category,
        icon: market.icon,
        outcome: market.outcome ?? null,
      });
      setLinkPickerFor(null);
    } catch (e) {
      // Surface in the picker rather than as a top-level page error.
      throw e;
    }
  }

  async function handleUnlink(newsItem) {
    if (!window.confirm(`¿Quitar el vínculo de mercado de esta noticia?`)) return;
    try {
      await adminUnlinkNews(newsItem.url);
      patchItemLink(newsItem.url, null);
    } catch (e) {
      window.alert(`Error al desvincular: ${e?.message || 'unknown'}`);
    }
  }

  // Admin: hide an irrelevant headline from the feed for everyone.
  // Optimistic — drop locally first, fire-and-forget the persist.
  // If the backend rejects, the next refresh will bring the item
  // back; not worth a confirmation prompt for a non-destructive op.
  async function handleHide(newsItem) {
    setData(prev => prev && {
      ...prev,
      items: prev.items.filter(i => i.url !== newsItem.url),
    });
    try {
      await adminHideNews({ newsUrl: newsItem.url, newsTitle: newsItem.title });
    } catch (e) {
      console.error('[news] hide failed', e);
      // Surface gently; the local removal already happened.
    }
  }

  return (
    <main style={{
      // Match the points-app deportes/soccer page (PointsCategoryPage) so the
      // title + sidebar align horizontally between the two tabs. 1280 max width
      // with 48px gutters anchors the title further left than the previous
      // 1100/clamp setup, and gives the carousel ~160px more breathing room
      // once the league sidebar renders to its left.
      maxWidth: 1280,
      margin: '0 auto',
      padding: 'clamp(16px, 3vw, 28px) clamp(16px, 4vw, 48px) 60px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          letterSpacing: '0.14em', color: 'var(--red, #FF4545)',
          textTransform: 'uppercase',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          marginBottom: 8,
        }}>
          <span aria-hidden="true" style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: 'var(--red, #FF4545)',
            boxShadow: '0 0 0 3px rgba(255,69,69,0.18)',
            animation: 'pronos-news-pulse 1.6s ease-in-out infinite',
          }} />
          en vivo · noticias de méxico
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', flexWrap: 'wrap',
          gap: 16,
        }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(28px, 5vw, 42px)',
            color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}>
            {t('points.cat.noticias') || 'Noticias'}
          </h1>
          {data?.sources && data.sources.length > 0 && (
            <SourceFilter
              sources={data.sources}
              disabled={disabledSources}
              onToggle={toggleSourceDisabled}
              onEnableAll={setAllSourcesEnabled}
              onDisableAll={() => setAllSourcesDisabled(data.sources.map(s => s.id))}
            />
          )}
        </div>
        <p style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--text-secondary)',
          marginTop: 6, maxWidth: 640,
        }}>
          Lo último de los principales medios mexicanos. Tap en una
          noticia para leer el artículo original.
        </p>
        {data?.fetchedAt && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--text-muted)', marginTop: 4,
          }}>
            Actualizado {relativeTime(data.fetchedAt)} · {visibleItems.length} historias · {(data.sources || []).length - disabledSources.size}/{(data.sources || []).length} fuentes
          </div>
        )}
      </div>

      {/* Layout: sub-tab sidebar on the left at desktop widths,
          collapses to a horizontal flex-wrap row at the top on
          tablet/phone (≥900px breakpoint switches between modes). */}
      <div className="news-layout">
        <aside className="news-sidebar">
          {SUB_TABS.map(tab => {
            const isActive = sub === tab.key;
            const count = visibleCounts[tab.key];
            return (
              <button
                key={tab.key}
                onClick={() => setSub(tab.key)}
                className={`news-tab${isActive ? ' active' : ''}`}
              >
                <span>{tab.label}</span>
                {count != null && count > 0 && (
                  <span className="news-tab-count">· {count}</span>
                )}
              </button>
            );
          })}
        </aside>

        <div className="news-main">

      {/* Loading / error / empty states */}
      {loading && !data && (
        <div style={{
          textAlign: 'center', padding: '80px 0',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          Cargando noticias…
        </div>
      )}
      {error && (
        <div style={{
          padding: 16, borderRadius: 10,
          background: 'rgba(255,69,69,0.06)',
          border: '1px solid rgba(255,69,69,0.2)',
          color: 'var(--red, #FF4545)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          marginBottom: 16,
        }}>
          No se pudieron cargar las noticias. {error}
        </div>
      )}
      {!loading && !error && (data?.items?.length === 0) && (
        <div style={{
          textAlign: 'center', padding: '80px 16px',
          fontFamily: 'var(--font-mono)', fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          No hay noticias en esta categoría ahora mismo.
        </div>
      )}

      {/* Carousel hero (only on Featured) — horizontal scroll-snap
          strip with the 6 freshest stories. Each card peeks the
          next one so the user sees there's more to swipe. */}
      {heroItems.length > 0 && (
        <NewsHeroCarousel
          items={heroItems}
          isAdmin={isAdmin}
          onCreateMarket={handleCreateMarket}
          onOpenLinkPicker={handleOpenLinkPicker}
          onUnlink={handleUnlink}
          onHide={handleHide}
        />
      )}

      {/* Mosaic grid — varied card sizes. dense auto-flow lets
          text-only (shorter) cards pack into gaps left by image
          cards, so the layout doesn't read as a uniform 3x3 of
          identical squares. Every 5th item with an image becomes
          a "feature" that spans 2 columns on wide screens. */}
      {restItems.length > 0 && (
        <div className="news-grid" style={{ marginTop: heroItems.length > 0 ? 28 : 0 }}>
          {restItems.map((item, i) => (
            <NewsCard
              key={item.url}
              item={item}
              isAdmin={isAdmin}
              feature={Boolean(item.image) && i % 5 === 0}
              onCreateMarket={handleCreateMarket}
              onOpenLinkPicker={handleOpenLinkPicker}
              onUnlink={handleUnlink}
              onHide={handleHide}
            />
          ))}
        </div>
      )}
        </div>{/* /news-main */}
      </div>{/* /news-layout */}

      {linkPickerFor && (
        <NewsLinkPicker
          item={linkPickerFor}
          onClose={() => setLinkPickerFor(null)}
          onPick={(market) => handleLink(linkPickerFor, market)}
        />
      )}
    </main>
  );
}

// ─── Linked-market chip (shown to all users on linked items) ───────────────
function LinkedMarketChip({ linkedMarket }) {
  if (!linkedMarket?.marketId) return null;
  const isResolved = linkedMarket.status === 'resolved';
  return (
    <Link
      to={`/market?id=${linkedMarket.marketId}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        background: isResolved ? 'rgba(136,136,136,0.10)' : 'rgba(0,201,107,0.10)',
        border: `1px solid ${isResolved ? 'rgba(136,136,136,0.30)' : 'rgba(0,201,107,0.35)'}`,
        color: isResolved ? 'var(--text-muted)' : 'var(--yes, #00C96B)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        textDecoration: 'none',
        marginTop: 8,
        maxWidth: '100%',
      }}
    >
      <span aria-hidden="true">{linkedMarket.icon || '📊'}</span>
      <span style={{
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {isResolved ? 'Mercado resuelto' : 'Ver mercado vinculado'}
      </span>
    </Link>
  );
}

// ─── Hero carousel ──────────────────────────────────────────────────────────
// Horizontal scroll-snap strip with INFINITE LOOP. Items are rendered
// three times back-to-back; on mount we scroll to the start of the
// middle copy. When the user's scroll approaches the start of the
// first copy or the end of the third copy, we instantly teleport
// scrollLeft back to the equivalent position in the middle copy.
// The teleport runs through `behavior: 'auto'` (instant) and is
// debounced ~150ms after the last scroll event — so smooth-scroll
// animations from prev/next clicks complete cleanly first, free
// swipes settle first, and the user never sees a jolt.
//
// Why infinite-loop: the user reported that mass-clicking the right
// arrow at the end of the strip "accidentally pressed the last news
// card" — the original strip had a hard wall at scrollWidth. Now the
// arrows always advance, the carousel cycles, and there's no edge
// state where the next click does nothing or selects an item.
function NewsHeroCarousel({ items, isAdmin, onCreateMarket, onOpenLinkPicker, onUnlink, onHide }) {
  const scrollerRef = useRef(null);
  const teleportTimeoutRef = useRef(null);
  // Guard so we don't cycle handle-init logic on every render.
  const initRef = useRef(false);

  // Triple-render the items so the user can scroll continuously in
  // either direction. The keys include a copy index to avoid React
  // duplicate-key warnings.
  const tripled = useMemo(() => {
    if (!items || items.length === 0) return [];
    return [
      ...items.map((it, i) => ({ ...it, _copy: 0, _key: `0-${it.url}-${i}` })),
      ...items.map((it, i) => ({ ...it, _copy: 1, _key: `1-${it.url}-${i}` })),
      ...items.map((it, i) => ({ ...it, _copy: 2, _key: `2-${it.url}-${i}` })),
    ];
  }, [items]);

  // Measure: width of one full copy of the items strip (cardWidth*N + gap*N).
  function measureSetWidth() {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return 0;
    const cards = el.querySelectorAll('[data-hero-card]');
    if (cards.length < items.length) return 0;
    const gap = parseFloat(getComputedStyle(el).gap) || 16;
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      total += cards[i].getBoundingClientRect().width + gap;
    }
    return total;
  }

  // Teleport check — silently jump back into the middle copy when
  // the user has drifted into the first or third copy. Called from
  // the scroll handler with a debounce so we don't fight an active
  // smooth-scroll or swipe.
  function maybeTeleport() {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return;
    const setWidth = measureSetWidth();
    if (setWidth <= 0) return;
    // Threshold sits 30% into each outer copy — far enough from the
    // boundary that ongoing momentum scrolls don't repeatedly trigger.
    const THRESHOLD = setWidth * 0.3;
    if (el.scrollLeft < setWidth - THRESHOLD) {
      el.scrollLeft += setWidth;
    } else if (el.scrollLeft > setWidth * 2 + THRESHOLD) {
      el.scrollLeft -= setWidth;
    }
  }

  function handleScroll() {
    clearTimeout(teleportTimeoutRef.current);
    teleportTimeoutRef.current = setTimeout(maybeTeleport, 150);
  }

  // On mount + when item count changes, place the viewport at the
  // start of the MIDDLE copy. Using behavior:'auto' so it's instant.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return undefined;
    // Wait one frame so the DOM has actual measured widths.
    const raf = requestAnimationFrame(() => {
      const setWidth = measureSetWidth();
      if (setWidth > 0) {
        el.scrollLeft = setWidth;
        initRef.current = true;
      }
    });
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(teleportTimeoutRef.current);
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  function scrollByDir(dir) {
    const el = scrollerRef.current;
    if (!el) return;
    // Advance by ~one viewport width — on desktop two cards leave,
    // two enter; on mobile one full card swap. The teleport handler
    // takes care of looping when we approach a copy boundary.
    const step = el.clientWidth * 0.95;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      {/* Scroll buttons — always visible since the carousel loops
          infinitely; there's no edge state where one direction
          becomes a no-op. Hidden on touch devices via the @media
          (hover: none) override below. */}
      <CarouselButton
        direction="left"
        visible={true}
        onClick={() => scrollByDir(-1)}
      />
      <CarouselButton
        direction="right"
        visible={true}
        onClick={() => scrollByDir(1)}
      />

      <div
        ref={scrollerRef}
        className="news-hero-scroller"
        style={{
          display: 'flex',
          gap: 16,
          overflowX: 'auto',
          overflowY: 'hidden',
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          paddingBottom: 8,
          // alignItems: flex-start so text-only cards take their
          // natural height instead of stretching to match the
          // tallest image card in the same row. Image cards have
          // their own explicit height cap from CSS.
          alignItems: 'flex-start',
          // Hide scrollbar (cosmetic). Companion ::-webkit-scrollbar
          // rule in components.css under .news-hero-scroller takes
          // care of WebKit; these two cover Firefox + IE/Edge.
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {tripled.map((item) => (
          <div
            key={item._key}
            data-hero-card
            className={`news-hero-card${item.image ? ' has-image' : ''}`}
            style={{
              scrollSnapAlign: 'start',
              borderRadius: 16,
              overflow: 'hidden',
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
              }}
            >
              {item.image ? (
                /* Fixed image height (flex 0 0) so the text section
                   below gets a predictable share of the card height
                   instead of being squeezed when the headline is long.
                   Without this, `flex: 1 1 50%` lets the image shrink
                   the text below its content height — which is what
                   was clipping the titles on Gold Derby / MacRumors
                   cards. The fixed values match the per-breakpoint
                   .news-hero-card heights in components.css so image
                   and text always share the card cleanly. */
                <div className="news-hero-image" style={{ flex: '0 0 auto', position: 'relative' }}>
                  <NewsImage src={item.image} alt={item.title} aspect="auto" fill />
                  {isAdmin && <HideButton onHide={onHide} item={item} />}
                  <div style={{
                    position: 'absolute',
                    top: 12, right: 12,
                    padding: '4px 10px',
                    borderRadius: 999,
                    background: 'rgba(0,0,0,0.65)',
                    backdropFilter: 'blur(6px)',
                    color: '#fff',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>
                    {item.sourceName || 'Noticia'}
                  </div>
                </div>
              ) : (
                /* No image — render only the source pill in a thin
                   strip so the card has visual identity without a
                   placeholder image. The headline + summary below
                   become the focal point. */
                <div style={{
                  position: 'relative',
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--red, #FF4545)',
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                  }}>
                    {item.sourceName || 'Noticia'}
                  </span>
                  {isAdmin && <HideButton onHide={onHide} item={item} inline />}
                </div>
              )}
              <div style={{
                /* flex:1 + min-height:0 + overflow:hidden lets the text
                   section absorb whatever's left after the image and
                   clips gracefully via the line-clamps below — instead
                   of overflowing past the card border. */
                flex: '1 1 auto',
                minHeight: 0,
                overflow: 'hidden',
                padding: 'clamp(14px, 2.4vw, 22px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.08em',
                }}>
                  {relativeTime(item.publishedAt)}
                </div>
                <h2 style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'clamp(18px, 2.4vw, 24px)',
                  lineHeight: 1.25,
                  color: 'var(--text-primary)',
                  margin: 0,
                  letterSpacing: '0.01em',
                  display: '-webkit-box',
                  /* Image cards have less vertical room — clamp the
                     headline to 2 lines so it never gets cut by the
                     card border. Text-only cards still get 3 lines. */
                  WebkitLineClamp: item.image ? 2 : 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>
                  {item.title}
                </h2>
                {item.summary && (
                  <p style={{
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    margin: 0,
                    display: '-webkit-box',
                    /* Image cards: 1-line summary keeps the chip + admin
                       buttons inside the card frame even at desktop's
                       380px height. Text-only cards get 2 lines. */
                    WebkitLineClamp: item.image ? 1 : 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {item.summary}
                  </p>
                )}
                <LinkedMarketChip linkedMarket={item.linkedMarket} />
              </div>
            </a>
            {isAdmin && (
              <div style={{
                padding: '8px 14px 12px',
                borderTop: '1px dashed var(--border)',
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
              }}>
                {item.linkedMarket?.marketId ? (
                  <button
                    onClick={() => onUnlink(item)}
                    style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px', borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}
                  >
                    Desvincular
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => onCreateMarket(item)}
                      style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px' }}
                    >
                      + Crear mercado
                    </button>
                    <button
                      onClick={() => onOpenLinkPicker(item)}
                      style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px', borderColor: 'var(--text-muted)', color: 'var(--text-secondary)' }}
                    >
                      🔗 Vincular
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Page-dot indicator — small visual cue for swipe progress */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 6,
        marginTop: 8,
      }}>
        {items.map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: 6, height: 6,
              borderRadius: '50%',
              background: 'var(--border)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CarouselButton({ direction, visible, onClick }) {
  const isLeft = direction === 'left';
  return (
    <button
      onClick={onClick}
      aria-label={isLeft ? 'Anterior' : 'Siguiente'}
      style={{
        position: 'absolute',
        top: 'calc(50% - 24px)',
        [isLeft ? 'left' : 'right']: -12,
        zIndex: 2,
        width: 40, height: 40,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.18)',
        color: '#fff',
        fontSize: 18,
        cursor: 'pointer',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.2s',
        // Hide on touch devices — they'll swipe naturally.
        // (Inline style can't @media; this stays visible on touch
        // but the carousel still scrolls fine. Acceptable.)
      }}
    >
      {isLeft ? '‹' : '›'}
    </button>
  );
}

// (NewsHero — single big top story — was replaced by NewsHeroCarousel
// above. The carousel handles the same layout for each of the top
// items individually, plus inline scroll buttons + page-dot strip.)

// ─── News card with 3 layout variants ──────────────────────────────────────
//   image card     — image on top, headline + summary below (default)
//   feature card   — wide (2-col span on desktop), image on left,
//                    headline + summary on right
//   text-only card — no image area at all, compact, just a thin
//                    source strip + headline + summary. Used when
//                    item.image is null (couldn't fetch og:image).
//
// The mix of these three variants gives the grid visual rhythm
// instead of the previous uniform-3x3 look.
function NewsCard({ item, isAdmin, feature, onCreateMarket, onOpenLinkPicker, onUnlink, onHide }) {
  const hasImage = Boolean(item.image);
  const isFeature = feature && hasImage;
  const className = ['news-card', isFeature ? 'news-card-feature' : ''].filter(Boolean).join(' ');

  return (
    <article
      className={className}
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        display: 'flex',
        flexDirection: isFeature ? 'row' : 'column',
        position: 'relative',
      }}
    >
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          flex: 1,
          display: 'flex',
          flexDirection: isFeature ? 'row' : 'column',
        }}
      >
        {hasImage && (
          <div style={{
            position: 'relative',
            ...(isFeature
              ? { flex: '0 0 42%', minHeight: 200 }
              : {}),
          }}>
            <NewsImage
              src={item.image}
              alt={item.title}
              aspect={isFeature ? 'auto' : '16/10'}
              fill={isFeature}
            />
            {isAdmin && <HideButton onHide={onHide} item={item} />}
          </div>
        )}
        <div style={{
          padding: 14,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}>
          {/* Text-only cards put the source strip with a tiny live-dot
              up top so the card has a visual anchor without an image.
              Image cards keep the standard SourceBadge below the
              picture. */}
          {!hasImage ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 10,
            }}>
              <span aria-hidden="true" style={{
                width: 5, height: 5, borderRadius: '50%',
                background: 'var(--red, #FF4545)',
                flexShrink: 0,
              }} />
              <span style={{ color: 'var(--red, #FF4545)', fontWeight: 600 }}>
                {item.sourceName || 'Noticia'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(item.publishedAt)}</span>
              {isAdmin && <HideButton onHide={onHide} item={item} inline />}
            </div>
          ) : (
            <SourceBadge sourceName={item.sourceName} publishedAt={item.publishedAt} />
          )}
          <h3 style={{
            fontFamily: 'var(--font-display)',
            fontSize: isFeature ? 19 : 16,
            lineHeight: 1.25,
            color: 'var(--text-primary)',
            margin: hasImage ? '6px 0 6px' : '0 0 6px',
            letterSpacing: '0.01em',
            display: '-webkit-box',
            WebkitLineClamp: isFeature ? 4 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {item.title}
          </h3>
          {item.summary && (
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: hasImage ? 3 : 5,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {item.summary}
            </p>
          )}
          <LinkedMarketChip linkedMarket={item.linkedMarket} />
        </div>
      </a>
      {isAdmin && (
        <div style={{
          padding: '8px 14px 12px',
          borderTop: '1px dashed var(--border)',
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
        }}>
          {item.linkedMarket?.marketId ? (
            <button
              onClick={() => onUnlink(item)}
              style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px', borderColor: 'var(--text-muted)', color: 'var(--text-muted)' }}
            >
              Desvincular
            </button>
          ) : (
            <>
              <button
                onClick={() => onCreateMarket(item)}
                style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px' }}
              >
                + Crear mercado
              </button>
              <button
                onClick={() => onOpenLinkPicker(item)}
                style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px', borderColor: 'var(--text-muted)', color: 'var(--text-secondary)' }}
              >
                🔗 Vincular
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Source / time-ago badge ───────────────────────────────────────────────
function SourceBadge({ sourceName, publishedAt }) {
  return (
    <div style={{
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      fontFamily: 'var(--font-mono)',
      fontSize: 10,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
    }}>
      <span style={{
        color: 'var(--red, #FF4545)',
        fontWeight: 600,
      }}>
        {sourceName}
      </span>
      {publishedAt && (
        <>
          <span aria-hidden="true">·</span>
          <span>{relativeTime(publishedAt)}</span>
        </>
      )}
    </div>
  );
}

// ─── Image wrapper with onError fallback ───────────────────────────────────
// Some Mexican news outlets block hotlinking — when the request 4xxs we
// hide the broken image rather than show the gray frame icon.
function NewsImage({ src, alt, aspect = '16/9', fill = false }) {
  const [broken, setBroken] = useState(false);
  // No src OR the load failed — render NOTHING. Earlier versions
  // showed a "broken image" gradient placeholder and a favicon, but
  // the news.google.com favicon turned out to be a Google Docs
  // glyph (because the URL is on news.google.com), which looked
  // wrong on every text-only card. The new contract: parents must
  // check item.image before rendering NewsImage at all; if NewsImage
  // ends up here without a src, we're a no-op.
  if (!src || broken) return null;
  const wrapStyle = fill
    ? { width: '100%', height: '100%', overflow: 'hidden', background: 'var(--surface2)' }
    : { aspectRatio: aspect, width: '100%', overflow: 'hidden', background: 'var(--surface2)' };
  return (
    <div style={wrapStyle}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setBroken(true)}
        style={{
          width: '100%', height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );
}

const adminBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--green, #00C96B)',
  color: 'var(--green, #00C96B)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
};

// ─── Source filter dropdown ────────────────────────────────────────────────
// Sits inline next to the page title. Click to open a panel with a
// checkbox per source — disabled sources are filtered out of the
// feed client-side. Selection persists in localStorage so user
// preferences survive refreshes. New outlets added later default
// to "shown" because we store DISABLED ids, not enabled.
function SourceFilter({ sources, disabled, onToggle, onEnableAll, onDisableAll }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Click-outside-to-close behavior. Tap target outside the panel
  // → close. Doesn't run when the panel is closed (cheap).
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Close on Esc.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const enabledCount = sources.length - disabled.size;
  const allEnabled = disabled.size === 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          borderRadius: 999,
          background: allEnabled ? 'var(--surface1)' : 'rgba(255,69,69,0.08)',
          border: `1px solid ${allEnabled ? 'var(--border)' : 'var(--red, #FF4545)'}`,
          color: allEnabled ? 'var(--text-secondary)' : 'var(--red, #FF4545)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Fuentes
        <span style={{ opacity: 0.7, fontWeight: 500 }}>
          {enabledCount}/{sources.length}
        </span>
        <span aria-hidden="true" style={{
          fontSize: 9,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
        }}>
          ▼
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          zIndex: 10,
          minWidth: 260,
          maxWidth: 'calc(100vw - 32px)',
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          padding: '8px 0',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 14px',
            borderBottom: '1px solid var(--border)',
            marginBottom: 4,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.12em', color: 'var(--text-muted)',
              textTransform: 'uppercase',
            }}>
              Fuentes
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={onEnableAll}
                style={miniBtnStyle}
              >
                Todas
              </button>
              <button
                onClick={onDisableAll}
                style={miniBtnStyle}
              >
                Ninguna
              </button>
            </div>
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {sources.map(s => {
              const isDisabled = disabled.has(s.id);
              return (
                <label
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)',
                    fontSize: 13,
                    color: isDisabled ? 'var(--text-muted)' : 'var(--text-primary)',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={() => onToggle(s.id)}
                    style={{
                      cursor: 'pointer',
                      accentColor: 'var(--red, #FF4545)',
                      width: 16, height: 16,
                    }}
                  />
                  <span style={{ flex: 1 }}>{s.name}</span>
                  {s.lean && (
                    <span style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                    }}>
                      {s.lean}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtnStyle = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
};

// ─── Admin hide button ──────────────────────────────────────────────────────
// Default mode: "−" overlay at top-left of an image, dark pill so it
// reads against any background. Inline mode: small ghost button used
// on text-only cards where there's no image to overlay against —
// renders inside the source strip so admins still get a one-tap
// hide control without breaking the layout.
function HideButton({ onHide, item, inline = false }) {
  function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();
    onHide?.(item);
  }
  if (inline) {
    return (
      <button
        onClick={handleClick}
        title="Ocultar de la lista"
        aria-label="Ocultar noticia"
        style={{
          marginLeft: 'auto',
          width: 22, height: 22,
          borderRadius: '50%',
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        −
      </button>
    );
  }
  return (
    <button
      onClick={handleClick}
      title="Ocultar de la lista"
      aria-label="Ocultar noticia"
      style={{
        position: 'absolute',
        top: 8, left: 8,
        zIndex: 3,
        width: 28, height: 28,
        borderRadius: '50%',
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.2)',
        color: '#fff',
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      −
    </button>
  );
}

// ─── Link picker modal ──────────────────────────────────────────────────────
// Admin opens this from any news card. Fetches active markets once on
// mount, supports a fuzzy text search, and POSTs the link on selection.
function NewsLinkPicker({ item, onClose, onPick }) {
  const [markets, setMarkets] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  // Start with empty search — pre-filling the full headline made it
  // impossible to find any market (no market title is going to
  // contain the whole news headline verbatim). Admin types one or
  // two keywords; we filter from there.
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(null); // marketId being linked
  const [submitErr, setSubmitErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminListActiveMarkets()
      .then(res => {
        if (cancelled) return;
        const arr = Array.isArray(res?.markets) ? res.markets : [];
        setMarkets(arr);
      })
      .catch(e => { if (!cancelled) setLoadErr(e?.message || 'load_failed'); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!markets) return [];
    const q = query.trim().toLowerCase();
    if (!q) return markets.slice(0, 80);
    // Cheap match: every word in query must appear somewhere in the
    // question or category. Picks the obvious matches without
    // dragging in a fuzzy library.
    const words = q.split(/\s+/).filter(Boolean);
    return markets.filter(m => {
      const hay = `${m.question || ''} ${m.category || ''}`.toLowerCase();
      return words.every(w => hay.includes(w));
    }).slice(0, 80);
  }, [markets, query]);

  async function handleSelect(market) {
    setSubmitting(market.id);
    setSubmitErr(null);
    try {
      await onPick(market);
    } catch (e) {
      setSubmitErr(e?.message || 'link_failed');
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        width: 'min(640px, 96vw)', maxHeight: '88vh',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            letterSpacing: '0.12em', color: 'var(--text-muted)',
            textTransform: 'uppercase', marginBottom: 4,
          }}>
            Vincular noticia con mercado existente
          </div>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 14,
            color: 'var(--text-primary)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {item.title}
          </div>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar mercado por palabra clave…"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {!markets && !loadErr && (
            <div style={{
              padding: 24, textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              Cargando mercados…
            </div>
          )}
          {loadErr && (
            <div style={{
              padding: 16, color: 'var(--red, #FF4545)',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}>
              No se pudieron cargar los mercados: {loadErr}
            </div>
          )}
          {markets && filtered.length === 0 && (
            <div style={{
              padding: 24, textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 12,
              color: 'var(--text-muted)',
            }}>
              Sin resultados.
            </div>
          )}
          {filtered.map(m => {
            const isSubmitting = submitting === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleSelect(m)}
                disabled={Boolean(submitting)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 18px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting && !isSubmitting ? 0.4 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
                  {m.icon || '📈'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 14,
                    color: 'var(--text-primary)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {m.question}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: 'var(--text-muted)', marginTop: 2,
                  }}>
                    #{m.id} · {m.category || 'general'} · {m.status || 'active'}
                  </div>
                </div>
                {isSubmitting && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
                    vinculando…
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {submitErr && (
          <div style={{
            padding: 12,
            background: 'rgba(255,69,69,0.08)',
            color: 'var(--red, #FF4545)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            borderTop: '1px solid rgba(255,69,69,0.2)',
          }}>
            Error: {submitErr}
          </div>
        )}

        <div style={{
          padding: 12,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            disabled={Boolean(submitting)}
            style={{
              ...adminBtnStyle,
              borderColor: 'var(--text-muted)',
              color: 'var(--text-muted)',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
