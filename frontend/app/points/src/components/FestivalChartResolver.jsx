import React, { useCallback, useRef, useState } from 'react';
import {
  FESTIVAL_CHART_SETTLEMENT_MS, FESTIVAL_MINUTE, isFestivalChartMarket,
} from '../../../../shared/trading-festival.js';
import { postJson } from '../lib/pointsApi.js';
import { festivalDate, festivalTime } from '../lib/tradingFestival.js';
import TradingFestivalChart from './TradingFestivalChart.jsx';

function ChartCapture({ slot, now }) {
  const { market } = slot;
  const start = Date.parse(slot.startTime);
  const end = Date.parse(slot.endTime);
  const opening = market?.threshold == null;
  const boundary = opening ? start : end;
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);
  const pending = useRef(false);
  const barStart = market?.status === 'active' && now >= boundary && saved !== boundary
    ? boundary - FESTIVAL_MINUTE : null;

  const record = useCallback(async ({ symbol, barStart: timestamp, price }) => {
    if (pending.current) return;
    pending.current = true;
    try {
      await postJson('/api/points/admin/festival-chart', { key: slot.key, symbol, barStart: timestamp, price });
      setError(null);
      setSaved(timestamp + FESTIVAL_MINUTE);
    } catch (error) {
      setError(error.status === 401 || error.status === 403
        ? 'Vuelve a iniciar sesión como administrador.'
        : 'No se pudo guardar el precio. Se volverá a intentar.');
    } finally {
      pending.current = false;
    }
  }, [slot.key]);

  return (
    <article className="tf-feature">
      <div className="tf-market-heading">
        <div>
          <h2>{slot.name}</h2>
          <div className="tf-caption">{festivalTime(start)}–{festivalTime(end)} CDMX</div>
        </div>
      </div>
      <TradingFestivalChart slot={slot} resolver barStart={barStart} onBar={record} />
      <p className="tf-notice" role="status">
        {error || (barStart == null ? 'Esperando el siguiente precio del mercado.'
          : `Esperando el cierre de la vela de las ${festivalTime(barStart)} CDMX.`)}
      </p>
    </article>
  );
}

export default function FestivalChartResolver({ slots, now, scheduleError }) {
  const markets = slots.filter(isFestivalChartMarket);
  const active = markets.find(slot => (
    now >= Date.parse(slot.startTime) - 5 * FESTIVAL_MINUTE
    && now < Date.parse(slot.endTime) + FESTIVAL_CHART_SETTLEMENT_MS
    && slot.market?.status !== 'resolved' && slot.market?.status !== 'canceled'
  ));
  const next = markets.find(slot => now < Date.parse(slot.startTime));

  return (
    <main className="tf-page tf-points">
      <div className="tf-shell">
        <header className="tf-header">
          <h1>Resolución de <span>gráficas</span></h1>
          <p>Mantén esta pestaña visible para guardar los precios de Vunelix automáticamente.</p>
          <a className="tf-caption" href="/points/c/tradingfestival">Volver a los mercados ↗</a>
        </header>
        {scheduleError && <p className="tf-notice" role="status">Reconectando al horario del festival…</p>}
        {active ? <ChartCapture key={active.key} slot={active} now={now} /> : (
          <p className="tf-notice">
            {next ? `Siguiente mercado · ${next.name} · ${festivalDate(next.startTime)}, ${festivalTime(next.startTime)} CDMX`
              : 'No hay más mercados de Vunelix pendientes.'}
          </p>
        )}
      </div>
    </main>
  );
}
