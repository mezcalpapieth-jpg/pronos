import React, { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { localizedTitle, useLang, useT } from '@app/lib/i18n.js';
import { fetchRelatedMarkets } from '../lib/pointsApi.js';

function leadingPercent(market) {
  const activeIndices = market.ammMode === 'parallel' ? market.activeOutcomeIndexes : null;
  const prices = (market.prices || []).filter((price, index) => (
    Number.isFinite(price) && (!activeIndices || activeIndices.includes(index))
  ));
  return prices.length ? Math.round(Math.max(...prices) * 100) : null;
}

export default function RelatedMarkets({ marketId }) {
  const lang = useLang();
  const t = useT();
  const headingId = useId();
  const [result, setResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchRelatedMarkets(marketId, { signal: controller.signal })
      .then(markets => {
        if (!controller.signal.aborted) {
          const active = markets.filter(market => market.status === 'active' && String(market.id) !== String(marketId));
          setResult({ marketId, markets: [...new Map(active.map(market => [market.id, market])).values()] });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [marketId]);

  if (result?.marketId !== marketId || !result.markets.length) return null;

  return (
    <section className="points-related-markets" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('points.detail.relatedMarkets')}</h2>
      <ul>
        {result.markets.map(market => {
          const percent = leadingPercent(market);
          return (
            <li key={market.id}>
              <Link to={`/market?id=${encodeURIComponent(market.id)}`}>
                <span>{localizedTitle(market, lang)}</span>
                {percent != null && <strong>{percent}%</strong>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
