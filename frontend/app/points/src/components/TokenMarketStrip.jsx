import React from 'react';
import { useT } from '@app/lib/i18n.js';
import { tokenMarketMeta } from '../lib/tokenMarkets.js';

/**
 * Token identity block for CoinGecko token market-cap markets — the
 * token art, its contract address and a link to the CoinGecko chart the
 * market resolves against. Renders nothing for every other market.
 */
export default function TokenMarketStrip({ market }) {
  const t = useT();
  const meta = tokenMarketMeta(market);
  if (!meta) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      flexWrap: 'wrap',
      padding: 14,
      borderRadius: 14,
      border: '1px solid var(--border)',
      background: 'var(--surface1)',
      marginBottom: 22,
    }}>
      {meta.imageUrl && (
        <img
          src={meta.imageUrl}
          alt={meta.symbol ? `$${meta.symbol}` : ''}
          style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {meta.symbol && (
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-primary)' }}>
            ${meta.symbol}
          </div>
        )}
        {meta.tokenAddress && (
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text-muted)',
            wordBreak: 'break-all',
          }}>
            {t('points.detail.tokenContract')}: {meta.tokenAddress}
          </div>
        )}
        <a
          href={meta.coingeckoUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            alignSelf: 'flex-start',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--orange)',
            textDecoration: 'none',
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid rgba(255,85,0,0.35)',
            background: 'rgba(255,85,0,0.08)',
          }}
        >
          {t('points.detail.tokenCoingecko')} ↗
        </a>
      </div>
    </div>
  );
}
