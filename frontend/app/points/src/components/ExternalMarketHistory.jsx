import React, { useId, useMemo, useState } from 'react';
import MultiSparkline from '@app/components/MultiSparkline.jsx';
import MarketExportActions from './MarketExportActions.jsx';
import { marketProbabilityCsv } from '../lib/marketExports.js';
import './ExternalMarketHistory.css';

const OUTCOMES = [
  { key: 'yes', es: 'Sí', en: 'Yes', color: 'var(--yes, #3FAE72)' },
  { key: 'no', es: 'No', en: 'No', color: 'var(--red, #E2574F)' },
];
const TIME_ZONE = 'America/Mexico_City';

function formatDate(value, locale) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(value);
}

function HistoryTime({ seconds, locale }) {
  const date = new Date(seconds * 1000);
  return <time dateTime={date.toISOString()}>{formatDate(date, locale)} (CDMX)</time>;
}

function outcomeSeries(history, language) {
  return OUTCOMES.map(outcome => {
    const original = history?.series?.find(series => series.key === outcome.key);
    const samples = new Map();
    for (const point of original?.data ?? []) {
      const { t, p } = point ?? {};
      const validTime = Number.isFinite(t) && t > 0 && Number.isFinite(new Date(t * 1000).getTime());
      if (validTime && Number.isFinite(p) && p >= 0 && p <= 100) {
        samples.set(t, { t, p });
      }
    }
    const data = [...samples.values()].sort((a, b) => a.t - b.t);
    return { key: outcome.key, label: outcome[language], color: outcome.color, data };
  });
}

function HistorySource({ history, en }) {
  if (history.source === 'polymarket') {
    return (
      <p className="external-panel-note">
        {en
          ? 'Polymarket CLOB reference prices, requested at one-hour resolution.'
          : 'Precios de referencia del libro de Polymarket, solicitados con resolución de una hora.'}
      </p>
    );
  }
  if (history.source === 'hyperliquid') {
    return (
      <p className="external-panel-note">
        {en
          ? 'Closing price of completed Hyperliquid one-hour outcome candles with trades.'
          : 'Precio de cierre de las velas completas de una hora con operaciones en Hyperliquid.'}
      </p>
    );
  }
  return null;
}

export default function ExternalMarketHistory({ history, marketId, lang }) {
  const headingId = useId();
  const graphId = useId();
  const [selectedKey, setSelectedKey] = useState(null);
  const en = lang === 'en';
  const locale = en ? 'en-US' : 'es-MX';
  const series = useMemo(() => outcomeSeries(history, en ? 'en' : 'es'), [history, en]);
  const active = series.find(row => row.key === selectedKey)
    ?? series.find(row => row.data.length > 0)
    ?? series[0];
  const anySamples = series.some(row => row.data.length > 0);
  const csv = useMemo(() => marketProbabilityCsv(series), [series]);
  const first = active.data[0];
  const last = active.data.at(-1);
  const capturedSeconds = history?.sampledAt ? Date.parse(history.sampledAt) / 1000 : null;
  const pointLabel = en ? ['sample', 'samples'] : ['punto', 'puntos'];

  return (
    <section className="external-panel external-market-history" aria-labelledby={headingId}>
      <h2 id={headingId}>{en ? 'Price history' : 'Historial de precios'}</h2>
      {history && <HistorySource history={history} en={en} />}
      {anySamples && (
        <div className="external-market-filters external-history-outcomes" role="group" aria-label={en ? 'Outcome' : 'Resultado'}>
          {series.map(row => (
            <button
              key={row.key}
              type="button"
              aria-pressed={row.key === active.key}
              aria-controls={graphId}
              onClick={() => setSelectedKey(row.key)}
            >
              {row.label} · {row.data.length} {pointLabel[row.data.length === 1 ? 0 : 1]}
            </button>
          ))}
        </div>
      )}
      <div id={graphId} className="external-history-plot">
        {active.data.length >= 2 ? (
          <>
            <MultiSparkline
              key={active.key}
              height={210}
              series={[active]}
              domainMin={0}
              domainMax={100}
              timeMin={first.t}
              timeMax={last.t}
              timeZone={TIME_ZONE}
              maxGapSeconds={history.source === 'hyperliquid' ? 3600 : 5400}
              showActivity={false}
            />
            <p className="external-panel-note">
              <HistoryTime seconds={first.t} locale={locale} />
              {' – '}
              <HistoryTime seconds={last.t} locale={locale} />
            </p>
          </>
        ) : first ? (
          <p>
            {en ? 'One recorded price' : 'Un solo precio registrado'} · <strong>{new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(first.p)}%</strong>
            {' · '}
            <HistoryTime seconds={first.t} locale={locale} />
          </p>
        ) : (
          <p>
            {anySamples
              ? (en ? 'No history was available for this outcome.' : 'No encontramos historial de este resultado.')
              : (en ? 'No verified price history in this capture.' : 'Esta captura no contiene un historial de precios verificado.')}
          </p>
        )}
      </div>
      {Number.isFinite(capturedSeconds) && (
        <p className="external-panel-note">
          {en ? 'Captured' : 'Captura del'} <HistoryTime seconds={capturedSeconds} locale={locale} />
        </p>
      )}
      {csv && <MarketExportActions marketId={marketId} csv={csv} />}
    </section>
  );
}
