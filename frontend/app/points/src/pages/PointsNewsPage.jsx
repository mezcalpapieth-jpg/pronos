/**
 * PointsNewsPage — /c/noticias
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
 *     CreateMarketForm via a query string handoff:
 *       /admin?tab=create&question=...&category=...
 *
 * The feed is cached server-side (5-min TTL via _lib/news-mexico.js)
 * AND CDN-cached (60s s-maxage). On Vercel the second tab/visitor
 * within the cache window gets the response instantly.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchNews } from '../lib/pointsApi.js';
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

export default function PointsNewsPage({ isAdmin = false }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const t = useT();

  const initialSub = (searchParams.get('sub') || 'featured').toLowerCase();
  const [sub, setSub] = useState(initialSub);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const featuredHero = useMemo(() => {
    // For the 'featured' tab, pick the freshest item with an image to
    // anchor the hero card. Fall back to first item if no images.
    if (sub !== 'featured') return null;
    const items = data?.items || [];
    return items.find(i => i.image) || items[0] || null;
  }, [sub, data]);

  const restItems = useMemo(() => {
    const items = data?.items || [];
    if (sub !== 'featured') return items;
    if (!featuredHero) return items;
    return items.filter(i => i.url !== featuredHero.url);
  }, [sub, data, featuredHero]);

  function handleCreateMarket(item) {
    if (!isAdmin) return;
    const params = new URLSearchParams({
      tab: 'create',
      question: item.title,
      category: sub === 'internacional' ? 'politica' : (sub === 'featured' ? 'mexico' : sub),
    });
    // Window navigate so the admin URL is on the MVP host. The points
    // app and MVP are separate Vite builds; cross-app navigation has
    // to be a full-page request.
    window.location.href = `/mvp/admin?${params.toString()}`;
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

      {/* Hero card (only on Featured) */}
      {featuredHero && (
        <NewsHero
          item={featuredHero}
          isAdmin={isAdmin}
          onCreateMarket={handleCreateMarket}
        />
      )}

      {/* Card grid */}
      {restItems.length > 0 && (
        <div style={{
          display: 'grid',
          gap: 16,
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          marginTop: featuredHero ? 22 : 0,
        }}>
          {restItems.map(item => (
            <NewsCard
              key={item.url}
              item={item}
              isAdmin={isAdmin}
              onCreateMarket={handleCreateMarket}
            />
          ))}
        </div>
      )}
    </main>
  );
}

// ─── Hero card (top story, big image) ─────────────────────────────────────────
function NewsHero({ item, isAdmin, onCreateMarket }) {
  return (
    <article style={{
      borderRadius: 16,
      overflow: 'hidden',
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
    }}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'block',
        }}
      >
        {item.image ? (
          <NewsImage src={item.image} alt={item.title} aspect="16/9" />
        ) : (
          <div style={{
            height: 220, width: '100%',
            background: 'linear-gradient(135deg, rgba(255,69,69,0.10), rgba(255,69,69,0.02))',
          }} />
        )}
        <div style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
          <SourceBadge sourceName={item.sourceName} publishedAt={item.publishedAt} />
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(20px, 3.2vw, 28px)',
            lineHeight: 1.2,
            color: 'var(--text-primary)',
            margin: '8px 0 10px',
            letterSpacing: '0.01em',
          }}>
            {item.title}
          </h2>
          {item.summary && (
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
              margin: 0,
            }}>
              {item.summary}
            </p>
          )}
        </div>
      </a>
      {isAdmin && (
        <div style={{
          padding: '10px 16px 14px',
          borderTop: '1px dashed var(--border)',
        }}>
          <button
            onClick={() => onCreateMarket(item)}
            style={adminBtnStyle}
          >
            + Crear mercado de esta noticia
          </button>
        </div>
      )}
    </article>
  );
}

// ─── Standard news card ─────────────────────────────────────────────────────
function NewsCard({ item, isAdmin, onCreateMarket }) {
  return (
    <article style={{
      borderRadius: 12,
      overflow: 'hidden',
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {item.image ? (
          <NewsImage src={item.image} alt={item.title} aspect="16/10" />
        ) : (
          <div style={{
            height: 130, width: '100%',
            background: 'linear-gradient(135deg, rgba(255,69,69,0.08), rgba(0,0,0,0))',
          }} />
        )}
        <div style={{
          padding: 14,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <SourceBadge sourceName={item.sourceName} publishedAt={item.publishedAt} />
          <h3 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            lineHeight: 1.25,
            color: 'var(--text-primary)',
            margin: '6px 0 6px',
            letterSpacing: '0.01em',
            // Clamp to 3 lines so cards have a consistent height.
            display: '-webkit-box',
            WebkitLineClamp: 3,
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
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {item.summary}
            </p>
          )}
        </div>
      </a>
      {isAdmin && (
        <div style={{
          padding: '8px 14px 12px',
          borderTop: '1px dashed var(--border)',
        }}>
          <button
            onClick={() => onCreateMarket(item)}
            style={{ ...adminBtnStyle, fontSize: 11, padding: '6px 10px' }}
          >
            + Crear mercado
          </button>
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
function NewsImage({ src, alt, aspect = '16/9' }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div style={{
        aspectRatio: aspect,
        width: '100%',
        background: 'linear-gradient(135deg, rgba(255,69,69,0.08), rgba(0,0,0,0))',
      }} />
    );
  }
  return (
    <div style={{ aspectRatio: aspect, width: '100%', overflow: 'hidden', background: 'var(--surface2)' }}>
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
