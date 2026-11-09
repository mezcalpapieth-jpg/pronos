import React from 'react';
import { useT } from '@app/lib/i18n.js';

export default function PriceHistoryNotice({ state }) {
  const t = useT();
  return (
    <p role="status" style={{ margin: '8px 0', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
      {t(`points.priceHistory.${state}`)}
    </p>
  );
}
