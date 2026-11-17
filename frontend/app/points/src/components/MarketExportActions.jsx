import React from 'react';
import { useT } from '@app/lib/i18n.js';
import { downloadMarketExport, marketCloseCalendar } from '../lib/marketExports.js';

export default function MarketExportActions({ marketId, title, endTime, csv }) {
  const t = useT();
  const hasCloseDate = endTime != null && endTime !== '' && Number.isFinite(new Date(endTime).getTime());

  return (
    <div className="points-market-exports">
      {hasCloseDate && (
        <button
          type="button"
          onClick={() => downloadMarketExport({
            content: marketCloseCalendar({ marketId, title, endTime, origin: window.location.origin }),
            filename: `pronos-market-${marketId}.ics`,
            type: 'text/calendar;charset=utf-8',
          })}
        >
          {t('points.detail.addToCalendar')}
        </button>
      )}
      <button
        type="button"
        disabled={!csv}
        onClick={() => downloadMarketExport({
          content: `\uFEFF${csv}`,
          filename: `pronos-market-${marketId}-chart.csv`,
          type: 'text/csv;charset=utf-8',
        })}
      >
        {t('points.detail.downloadChartCsv')}
      </button>
    </div>
  );
}
