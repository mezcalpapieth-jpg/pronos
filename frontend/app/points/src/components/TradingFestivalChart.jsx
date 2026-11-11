import React, { useMemo } from 'react';
import LivePriceChart from '@app/components/LivePriceChart.jsx';
import { FESTIVAL_CHART_LEAD_MS, FESTIVAL_MINUTE } from '../../../../shared/trading-festival.js';
import { buildFestivalPriceHistory } from '../lib/festivalChartHistory.js';
import { festivalPrice, festivalTickTime, festivalTime, useFestivalBars, useFestivalClock } from '../lib/tradingFestival.js';
import { useFestivalBitcoinTicks } from '../lib/useFestivalBitcoinTicks.js';
import './trading-festival.css';

const NO_TICKS = [];

export default function TradingFestivalChart({ slot, market = slot.market }) {
  const now = useFestivalClock();
  const start = Date.parse(slot.startTime);
  const end = Date.parse(slot.endTime);
  const isBitcoin = slot.key === 'btc';
  const ticker = useFestivalBitcoinTicks(isBitcoin ? slot.ticker : null, start, end);
  const { data, error } = useFestivalBars(slot.key);
  const threshold = market?.threshold ?? null;
  const finalPrice = market?.closePrice ?? null;
  const from = slot.requiresReschedule && data.bars.length
    ? data.bars[0].t
    : Math.min(now, start) - FESTIVAL_CHART_LEAD_MS;
  const to = Math.min(end, Math.max(now, ticker.history.at(-1)?.t ?? 0));
  const points = useMemo(() => buildFestivalPriceHistory({
    bars: data.bars,
    ticks: data.ticks ?? NO_TICKS,
    live: ticker.history,
    from,
    to,
    opening: threshold == null ? null : { t: start, price: threshold },
    closing: finalPrice == null ? null : { t: end, price: finalPrice },
  }), [data.bars, data.ticks, ticker.history, from, to, threshold, start, finalPrice, end]);

  const first = points[0];
  const last = points.at(-1);
  const fresh = last && last.t <= now + 2000 && now - last.t < 2 * FESTIVAL_MINUTE && now < end;
  const streaming = isBitcoin && ticker.status === 'open' && now - (ticker.history.at(-1)?.t ?? 0) < 15_000;
  const status = finalPrice != null ? 'Precio de cierre'
    : streaming && fresh ? 'En vivo'
      : error ? 'Datos no disponibles'
        : fresh ? 'Datos por minuto'
          : last ? 'Último dato'
            : data.status === 'unavailable' ? 'Datos por confirmar' : 'Esperando datos';
  const chartEnd = slot.requiresReschedule && last ? last.t : to;

  return (
    <section className="tf-chart" aria-label={`Precio de ${slot.symbol}`}>
      <div className="tf-chart-meta">
        <div>
          <div className="tf-caption">{slot.symbol}</div>
          <div className="tf-price">{festivalPrice(slot, last?.price)}{last && <small>{slot.currency || 'pts'}</small>}</div>
        </div>
        <div className="tf-reference">
          <div className="tf-caption">Precio de apertura</div>
          {threshold == null ? <span className="tf-reference-pending">Se fija al abrir</span> : <strong>{festivalPrice(slot, threshold)}</strong>}
        </div>
      </div>
      {last ? (
        <>
          <div className="tf-live-plot">
            <LivePriceChart
              history={points}
              threshold={threshold}
              xStart={from}
              xEnd={Math.max(chartEnd, from + FESTIVAL_MINUTE)}
              highlightStart={slot.requiresReschedule ? undefined : start}
              highlightEnd={slot.requiresReschedule ? undefined : end}
              formatPrice={price => festivalPrice(slot, price)}
              formatTime={festivalTickTime}
              interpolate={false}
              label={`Gráfica de ${slot.symbol}`}
              height={240}
            />
          </div>
          <div className="tf-axis">
            <time dateTime={new Date(first.t).toISOString()}>{festivalTime(first.t)}</time>
            <time dateTime={new Date(last.t).toISOString()}>{festivalTime(last.t)} CDMX</time>
          </div>
        </>
      ) : (
        <div className="tf-chart-empty">{status}</div>
      )}
      <div className="tf-chart-status">
        {last && <span className={fresh && (!error || streaming) ? 'tf-signal is-live' : 'tf-signal'}>{status}</span>}
        <span className="tf-chart-source">{slot.provider}{slot.requiresReschedule && ' · Sesión regular'}</span>
      </div>
    </section>
  );
}
