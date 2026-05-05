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

  // Fetch on sub change. Server caches across requests so this is cheap.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchNews({ category: sub, limit: 60 })
      .then(res => {
        if (cancelled) return;
        // postJson / getJson wrapper returns { ok, data, status } in the
        // points-app, but lib/pointsApi.fetchNews returns raw JSON via
        // getJson — match the actual shape.
        const payload = res?.data || res;
        if (!payload || payload.error) throw new Error(payload?.error || 'news_failed');
        setData(payload);
      })
      .catch(e => { if (!cancelled) setError(e?.message || 'news_failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sub]);

  // Top-of-page carousel for 'featured': take the 6 freshest stories
  // and present them in a horizontal scroll-snap strip. Each card
  // peeks the next one to telegraph "swipeable for more." Below the
  // carousel sits a standard grid with the rest.
  const HERO_COUNT = 6;
  const heroItems = useMemo(() => {
    if (sub !== 'featured') return [];
    const items = data?.items || [];
    return items.slice(0, HERO_COUNT);
  }, [sub, data]);

  const restItems = useMemo(() => {
    const items = data?.items || [];
    if (sub !== 'featured') return items;
    if (heroItems.length === 0) return items;
    const heroUrls = new Set(heroItems.map(i => i.url));
    return items.filter(i => !heroUrls.has(i.url));
  }, [sub, data, heroItems]);

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
      maxWidth: 1100,
      margin: '0 auto',
      padding: 'clamp(20px, 4vw, 40px) clamp(14px, 4vw, 32px) 56px',
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
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(28px, 5vw, 42px)',
          color: 'var(--text-primary)', margin: 0, letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}>
          {t('points.cat.noticias') || 'Noticias'}
        </h1>
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
            Actualizado {relativeTime(data.fetchedAt)} · {data.totalCount || 0} historias · {(data.sources || []).length} fuentes
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 22,
        flexWrap: 'wrap',
      }}>
        {SUB_TABS.map(tab => {
          const isActive = sub === tab.key;
          const count = data?.counts?.[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => setSub(tab.key)}
              className={`filter-btn${isActive ? ' active' : ''}`}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11, padding: '7px 14px',
                letterSpacing: '0.06em',
                borderColor: isActive ? 'var(--red, #FF4545)' : 'var(--border)',
                color: isActive ? 'var(--red, #FF4545)' : 'var(--text-muted)',
                background: isActive ? 'rgba(255,69,69,0.08)' : 'var(--surface1)',
              }}
            >
              {tab.label}
              {count != null && count > 0 && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>· {count}</span>
              )}
            </button>
          );
        })}
      </div>

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
// Horizontal scroll-snap strip. Each item is ~50% viewport width on
// desktop so the user sees the next card peeking on the right —
// telegraphs "swipe for more". Mobile cards are 92% width with a
// gap so the next one peeks ~3% in. Scroll buttons appear on hover
// for desktop users who don't realize they can swipe.
function NewsHeroCarousel({ items, isAdmin, onCreateMarket, onOpenLinkPicker, onUnlink, onHide }) {
  const scrollerRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  function updateScrollState() {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }
  useEffect(() => {
    updateScrollState();
    const el = scrollerRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
    };
  }, [items.length]);

  function scrollByDir(dir) {
    const el = scrollerRef.current;
    if (!el) return;
    // Advance by the FULL visible width (one "page" of the
    // carousel) so on desktop where 2 cards fit, a click moves
    // both cards out of view and the next 2 in. Avoids the
    // "card 2 stays half-visible" behavior the user flagged.
    const step = el.clientWidth * 0.95;
    el.scrollBy({ left: dir * step, behavior: 'smooth' });
  }

  return (
    <div style={{ position: 'relative', marginBottom: 4 }}>
      {/* Scroll buttons — desktop only, faded out at edges. Hidden
          on touch devices via the @media (hover: none) override
          inline below. */}
      <CarouselButton
        direction="left"
        visible={canScrollLeft}
        onClick={() => scrollByDir(-1)}
      />
      <CarouselButton
        direction="right"
        visible={canScrollRight}
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
          // Hide scrollbar (cosmetic). Companion ::-webkit-scrollbar
          // rule in components.css under .news-hero-scroller takes
          // care of WebKit; these two cover Firefox + IE/Edge.
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {items.map((item) => (
          <div
            key={item.url}
            data-hero-card
            className="news-hero-card"
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
                <div style={{ flex: '1 1 60%', minHeight: 220, position: 'relative' }}>
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
                  WebkitLineClamp: 3,
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
                    WebkitLineClamp: 2,
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
