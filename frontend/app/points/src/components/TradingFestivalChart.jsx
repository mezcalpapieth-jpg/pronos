import React, { useId } from 'react';
import { FESTIVAL_MINUTE } from '../../../../shared/trading-festival.js';
import { useCryptoTicker } from '../lib/useCryptoTicker.js';
import { festivalPrice, festivalTime, useFestivalBars, useFestivalClock } from '../lib/tradingFestival.js';
import './trading-festival.css';

const GRID_LEVELS = [0.18, 0.5, 0.82];

function PricePlot({ slot, points, threshold }) {
  const fillId = useId();
  const first = points[0];
  const last = points.at(-1);
  const prices = points.map(point => point.price);
  if (threshold != null) prices.push(threshold);

  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const padding = Math.max((high - low) * 0.19, low * 0.00006);
  const chartMin = low - padding;
  const chartMax = high + padding;
  const tMin = first.t;
  const tMax = Math.max(last.t, tMin + FESTIVAL_MINUTE);
  const width = 800;
  const height = 240;
  const margin = 9;
  const x = t => margin + (t - tMin) / (tMax - tMin) * (width - margin * 2);
  const y = price => margin + (chartMax - price) / (chartMax - chartMin) * (height - margin * 2);
  const line = points.map(({ t, price }) => `${x(t).toFixed(1)},${y(price).toFixed(1)}`).join(' ');
  const lineColor = threshold == null ? 'var(--tf-accent)' : last.price < threshold ? 'var(--tf-down)' : 'var(--tf-up)';

  return (
    <>
      <div className="tf-plot-frame">
        <div className="tf-plot">
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
            aria-label={`Gráfica de ${slot.symbol}, de ${festivalTime(first.t)} a ${festivalTime(last.t)} CDMX`}>
            <defs>
              <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={lineColor} stopOpacity="0.24" />
                <stop offset="1" stopColor={lineColor} stopOpacity="0.03" />
              </linearGradient>
            </defs>
            {GRID_LEVELS.map(position => (
              <line key={position} x1="0" x2={width} y1={height * position} y2={height * position}
                stroke="var(--tf-grid)" vectorEffect="non-scaling-stroke" />
            ))}
            <polygon points={`${x(first.t)},${height} ${line} ${x(last.t)},${height}`} fill={`url(#${fillId})`} />
            {threshold != null && (
              <line x1="0" x2={width} y1={y(threshold)} y2={y(threshold)}
                stroke="var(--tf-reference)" strokeDasharray="6 5" vectorEffect="non-scaling-stroke" />
            )}
            <polyline points={line} fill="none" stroke={lineColor} strokeWidth="2.75"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <circle cx={x(last.t)} cy={y(last.price)} r="4" fill={lineColor} />
          </svg>
        </div>
        <div className="tf-plot-scale" aria-hidden="true">
          {GRID_LEVELS.map(position => {
            const price = chartMax - (height * position - margin) / (height - margin * 2) * (chartMax - chartMin);
            return <span key={position} style={{ top: `${position * 100}%` }}>{festivalPrice(slot, price)}</span>;
          })}
        </div>
      </div>
      <div className="tf-axis">
        <time dateTime={new Date(first.t).toISOString()}>{festivalTime(first.t)}</time>
        <time dateTime={new Date(last.t).toISOString()}>{festivalTime(last.t)} CDMX</time>
      </div>
    </>
  );
}

export default function TradingFestivalChart({ slot, market = slot.market }) {
  const now = useFestivalClock();
  const start = Date.parse(slot.startTime);
  const end = Date.parse(slot.endTime);
  const bitcoinLive = slot.key === 'btc' && now < end;
  const ticker = useCryptoTicker(bitcoinLive ? slot.ticker : null);
  const { data, error } = useFestivalBars(slot.key);
  const threshold = market?.threshold ?? null;
  const finalPrice = market?.closePrice ?? null;

  // Prefer completed candles. The BTC WebSocket fills in movement since the last candle.
  const history = data.bars.filter(point => point.t <= end);
  const candles = history.filter(point => point.t >= start);
  const points = slot.requiresReschedule || now < start || !candles.length ? history : candles;
  if (threshold != null) {
    const beforeOpen = points.findIndex(point => point.t >= start);
    points.splice(0, beforeOpen === -1 ? points.length : beforeOpen);
    if (points[0]?.t === start) points[0] = { t: start, price: threshold };
    else points.unshift({ t: start, price: threshold });
  }
  const since = points.at(-1)?.t ?? Math.min(now, start) - 12 * FESTIVAL_MINUTE;
  for (const tick of ticker.history) {
    if (tick.t > since && tick.t < end) points.push(tick);
  }
  if (finalPrice != null) {
    if (points.at(-1)?.t === end) points.pop();
    points.push({ t: end, price: finalPrice });
  }

  const last = points.at(-1);
  const fresh = last && last.t <= now + 2000 && now - last.t < 2 * FESTIVAL_MINUTE && now < end;
  const status = error ? 'Datos no disponibles'
    : finalPrice != null ? 'Precio de cierre'
      : fresh ? (slot.key === 'btc' && ticker.status === 'open' ? 'En vivo' : 'Datos por minuto')
        : last ? 'Último dato'
          : data.status === 'unavailable' ? 'Datos por confirmar' : 'Esperando datos';

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
      {last ? <PricePlot slot={slot} points={points} threshold={threshold} /> : (
        <div className="tf-chart-empty">{status}</div>
      )}
      <div className="tf-chart-status">
        {last && <span className={fresh && !error ? 'tf-signal is-live' : 'tf-signal'}>{status}</span>}
        <span className="tf-chart-source">{slot.provider}{slot.requiresReschedule && ' · Sesión regular'}</span>
      </div>
    </section>
  );
}
