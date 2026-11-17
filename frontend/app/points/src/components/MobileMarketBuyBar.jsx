import React, { useEffect, useState } from 'react';
import { useT } from '@app/lib/i18n.js';

export default function MobileMarketBuyBar({ tradePanelRef, outcomes, onChooseOutcome }) {
  const t = useT();
  const [panelInView, setPanelInView] = useState(false);

  useEffect(() => {
    const panel = tradePanelRef.current;
    if (!panel || typeof IntersectionObserver !== 'function') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      setPanelInView(entry.isIntersecting);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tradePanelRef]);

  if (panelInView) return null;

  return (
    <div className="points-mobile-buy-bar" role="group" aria-label={t('points.buy.title')}>
      {outcomes ? outcomes.map(({ label, percent, onBuy }, index) => (
        <button
          className={`points-mobile-buy-bar__outcome points-mobile-buy-bar__outcome--${index === 0 ? 'yes' : 'no'}`}
          key={index}
          type="button"
          onClick={onBuy}
        >
          <span>{label}</span>
          <strong>{percent}%</strong>
        </button>
      )) : (
        <button className="points-mobile-buy-bar__choose" type="button" onClick={onChooseOutcome}>
          {t('points.detail.chooseOutcomeCta')}
        </button>
      )}
    </div>
  );
}
