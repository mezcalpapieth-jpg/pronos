import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { FESTIVAL_CHART_LEAD_MS, FESTIVAL_MINUTE, isFestivalBitcoin } from '../../../../shared/trading-festival.js';
import { buildFestivalPriceHistory } from '../lib/festivalChartHistory.js';
import { useCryptoTicker } from '../lib/useCryptoTicker.js';
import { useFestivalBitcoinTicks } from '../lib/useFestivalBitcoinTicks.js';
import { festivalPrice, festivalTime, useFestivalBars, useFestivalClock } from '../lib/tradingFestival.js';
import './trading-festival.css';

const GRID_LEVELS = [0.18, 0.5, 0.82];
const NO_TICKS = [];
const LIVE_TICK_MAX_AGE_MS = 15_000;

const FESTIVAL_CHART_ORIGIN = 'https://pronos-chi.vercel.app';

function FestivalPresentationChart({ slot, dashboard, resolver, barStart, onBar }) {
  const frame = useRef(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const ready = status === 'ready';
  const params = new URLSearchParams({ asset: slot.key });
  if (resolver) params.set('resolve', '1');
  if (dashboard && slot.replay) {
    params.set('showStart', slot.startTime);
    params.set('showEnd', slot.endTime);
    params.set('recordingStart', slot.replay.startTime);
    params.set('recordingEnd', slot.replay.endTime);
  }

  useEffect(() => {
    const timeout = setTimeout(() => setStatus('unavailable'), 15000);
    function handleChartReady(event) {
      if (event.origin !== FESTIVAL_CHART_ORIGIN || event.source !== frame.current?.contentWindow
        || event.data !== 'pronos:festival-chart-ready') return;
      clearTimeout(timeout);
      setStatus('ready');
    }

    window.addEventListener('message', handleChartReady);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleChartReady);
    };
  }, [attempt]);

  function retry() {
    setStatus('loading');
    setAttempt(previous => previous + 1);
  }

  useEffect(() => {
    if (!resolver || barStart == null) return;
    const type = 'pronos:festival-chart-bar';
    function requestBar() {
      frame.current?.contentWindow?.postMessage({ type, barStart }, FESTIVAL_CHART_ORIGIN);
    }
    function handleBar(event) {
      const data = event.data;
      if (event.origin !== FESTIVAL_CHART_ORIGIN || event.source !== frame.current?.contentWindow
        || data?.type !== type || data.asset !== slot.key || data.symbol !== slot.presentationTicker
        || data.barStart !== barStart || !Number.isFinite(data.price) || data.price <= 0) return;
      onBar(data);
    }

    window.addEventListener('message', handleBar);
    requestBar();
    const poll = setInterval(requestBar, 8000);
    // Reload only the admin's resolver to recover if the widget's stream stalls.
    const reload = setTimeout(retry, 90_000);
    return () => {
      window.removeEventListener('message', handleBar);
      clearInterval(poll);
      clearTimeout(reload);
    };
  }, [resolver, slot.key, slot.presentationTicker, barStart, onBar, attempt]);

  return (
    <div className="tf-presentation-chart">
      {/* Keep the third-party widget on a separate origin from the festival page. */}
      <iframe
        key={attempt}
        ref={frame}
        className="tf-presentation-frame"
        src={`${FESTIVAL_CHART_ORIGIN}/festival-nasdaq-chart?${params}`}
        title={`Gráfica de ${slot.symbol}`}
        sandbox="allow-scripts allow-same-origin"
        credentialless=""
        aria-hidden={!ready}
        tabIndex={ready ? undefined : -1}
        style={{ opacity: ready ? 1 : 0, pointerEvents: ready ? undefined : 'none' }}
        onLoad={event => event.currentTarget.contentWindow?.postMessage('pronos:festival-chart-init', FESTIVAL_CHART_ORIGIN)}
      />
      {status === 'loading' && <p className="tf-presentation-fallback tf-caption" role="status">Cargando gráfica…</p>}
      {status === 'unavailable' && (
        <div className="tf-presentation-fallback">
          <button type="button" className="tf-cta" onClick={retry}>Volver a cargar la gráfica</button>
          <a className="tf-presentation-external tf-caption" href={`https://vunelix.com/chart?symbol=${encodeURIComponent(slot.presentationTicker)}`} target="_blank" rel="noopener noreferrer">
            Abrir en Vunelix ↗
          </a>
        </div>
      )}
    </div>
  );
}

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

function PriceValue({ slot, liveProduct, fallback }) {
  const ticker = useCryptoTicker(liveProduct);
  const tick = ticker.history.at(-1);
  const price = ticker.status === 'open' && tick
    && tick.t < Date.parse(slot.endTime) && Date.now() - tick.t < LIVE_TICK_MAX_AGE_MS
    ? ticker.currentPrice : fallback;
  return <div className="tf-price">{festivalPrice(slot, price)}{price != null && <small>{slot.currency || 'pts'}</small>}</div>;
}

function FestivalPriceChart({ slot, market }) {
  const now = useFestivalClock();
  const start = Date.parse(slot.startTime);
  const end = Date.parse(slot.endTime);
  const bitcoin = isFestivalBitcoin(slot);
  const ticker = useFestivalBitcoinTicks(bitcoin ? slot.ticker : null, start, end);
  const { data, error } = useFestivalBars(slot.key);
  const threshold = market?.threshold ?? null;
  const finalPrice = market?.closePrice ?? null;
  const from = Math.min(now, start) - FESTIVAL_CHART_LEAD_MS;
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

  const last = points.at(-1);
  const fresh = last && last.t <= now + 2000 && now - last.t < 2 * FESTIVAL_MINUTE && now < end;
  const streaming = bitcoin && ticker.status === 'open'
    && now - (ticker.history.at(-1)?.t ?? 0) < LIVE_TICK_MAX_AGE_MS;
  const status = finalPrice != null ? 'Precio de cierre'
    : streaming && fresh ? 'En vivo'
      : error ? 'Datos no disponibles'
        : fresh ? 'Datos por minuto'
          : last ? 'Último dato'
            : data.status === 'unavailable' ? 'Datos por confirmar' : 'Esperando datos';

  return (
    <section className="tf-chart" aria-label={`Precio de ${slot.symbol}`}>
      <div className="tf-chart-meta">
        <div>
          <div className="tf-caption">{slot.symbol}</div>
          <PriceValue slot={slot} liveProduct={bitcoin && now < end ? slot.ticker : null} fallback={last?.price} />
        </div>
        <div className="tf-reference">
          <div className="tf-caption">Precio de apertura</div>
          {threshold == null ? (
            <span className="tf-reference-pending">Se fija al abrir</span>
          ) : <strong>{festivalPrice(slot, threshold)}</strong>}
        </div>
      </div>
      {last ? <PricePlot slot={slot} points={points} threshold={threshold} /> : (
        <div className="tf-chart-empty">{status}</div>
      )}
      <div className="tf-chart-status">
        {last && <span className={fresh && (!error || streaming) ? 'tf-signal is-live' : 'tf-signal'}>{status}</span>}
        <span className="tf-chart-source">{slot.provider}</span>
      </div>
    </section>
  );
}

export default function TradingFestivalChart({
  slot, market = slot.market, dashboard = false, resolver = false, barStart, onBar,
}) {
  if (!slot.presentationTicker) return <FestivalPriceChart slot={slot} market={market} />;
  return (
    <section className="tf-embedded-chart" aria-label={`Precio de ${slot.symbol}`}>
      <FestivalPresentationChart slot={slot} dashboard={dashboard}
        resolver={resolver} barStart={barStart} onBar={onBar} />
      {market && !slot.replay && (
        <div className="tf-settlement-prices tf-caption">
          <span>Apertura según {slot.provider} · {market.threshold == null
            ? 'Pendiente'
            : festivalPrice(slot, market.threshold)}</span>
          {market.closePrice != null && <span>Cierre · {festivalPrice(slot, market.closePrice)}</span>}
        </div>
      )}
    </section>
  );
}
