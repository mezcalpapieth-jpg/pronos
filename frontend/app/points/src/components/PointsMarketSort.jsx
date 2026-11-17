import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '@app/lib/i18n.js';
import { POINTS_MARKET_SORTS } from '@app/lib/pointsMarketOrdering.js';
import './points-browse.css';

export default function PointsMarketSort() {
  const [params, setParams] = useSearchParams();
  const t = useT();
  const current = params.get('sort');

  function update(sort) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (sort === 'trending') next.delete('sort');
      else next.set('sort', sort);
      return next;
    });
  }

  return (
    <div className="points-market-sort">
      <fieldset className="points-market-sort-options" aria-label={t('points.sort.label')}>
        {POINTS_MARKET_SORTS.map(sort => (
          <button
            key={sort}
            className="filter-btn"
            type="button"
            aria-pressed={sort === (POINTS_MARKET_SORTS.includes(current) ? current : 'trending')}
            onClick={() => update(sort)}
          >
            {t(`points.sort.${sort}`)}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
