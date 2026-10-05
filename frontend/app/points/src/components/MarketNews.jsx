/**
 * Linked-news widget for the market detail sidebar.
 *
 * Admins curate these links from /c/noticias. This panel performs the inverse
 * lookup so a market also shows the headlines that were linked to it.
 */
import React, { useEffect, useState } from 'react';
import { useT } from '@app/lib/i18n.js';
import { fetchMarketNews } from '../lib/pointsApi.js';

function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export default function MarketNews({ marketId }) {
  const t = useT();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!marketId) return undefined;
    let cancelled = false;
    setLoading(true);
    fetchMarketNews(marketId, { limit: 6 })
      .then(r => {
        if (cancelled) return;
        setItems(Array.isArray(r?.items) ? r.items : []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [marketId]);

  if (!loading && items.length === 0) return null;

  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '18px 20px',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.12em',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        marginBottom: 12,
      }}>
        {t('points.marketNews.title')}
      </div>

      {loading ? (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', margin: 0 }}>
          {t('points.marketNews.loading')}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => {
            const source = item.source || hostnameFor(item.url);
            const title = item.title || item.url;
            return (
              <a
                key={item.url}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  color: 'inherit',
                  textDecoration: 'none',
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }}>
                  {title}
                </div>
                {source && (
                  <div style={{
                    marginTop: 5,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {source}
                  </div>
                )}
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
