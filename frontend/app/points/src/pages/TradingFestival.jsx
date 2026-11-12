import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { FESTIVAL_MINUTE, FESTIVAL_SIGNUP_URL } from '../../../../shared/trading-festival.js';
import { FESTIVAL_JAR_EVENT } from '../../../../shared/jar-events.js';
import TradingFestivalChart from '../components/TradingFestivalChart.jsx';
import {
  festivalDate, festivalPrice, festivalStatus, festivalTime,
  useFestivalClock, useFestivalMarketPrices, useFestivalReplay, useFestivalSchedule,
} from '../lib/tradingFestival.js';

const FestivalJar = lazy(() => import('./Ris26Page.jsx'));
const DISPLAY_MODES = [
  ['auto', 'Automático'],
  ['charts', 'Gráficas'],
  ['jar', 'Frasco'],
];
const formatPercent = new Intl.NumberFormat('es-MX', { style: 'percent' });

function marketUrl(slot) {
  return slot.market && slot.market.status !== 'pending' ? `/market?id=${slot.market.id}` : null;
}

function isPresentation(slot) {
  return Boolean(slot.replay || (slot.presentationTicker && slot.feedEnabled !== true && !slot.market));
}

function displayStatus(slot, now) {
  if (slot.replay) return 'Práctica';
  return isPresentation(slot) ? 'Presentación' : festivalStatus(slot, now);
}

const FESTIVAL_CHART_ORIGIN = 'https://pronos-chi.vercel.app';

function FestivalPresentationChart({ slot, dashboard }) {
  const frame = useRef(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const ready = status === 'ready';
  const params = new URLSearchParams({ asset: slot.key });
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

function SlotInfo({ slot, now }) {
  const status = displayStatus(slot, now);
  return (
    <>
      <span className="tf-slot-time">
        <span>{festivalDate(slot.startTime)}</span>
        <strong>{festivalTime(slot.startTime)}–{festivalTime(slot.endTime)}</strong>
      </span>
      <span className="tf-slot-name"><strong>{slot.name}</strong><small>{slot.symbol}</small></span>
      <span className={status === 'Abierto' ? 'tf-pill is-live' : 'tf-pill'}>{status}</span>
    </>
  );
}

function SlotTitle({ slot, now }) {
  const status = displayStatus(slot, now);
  return (
    <div className="tf-market-heading">
      <div>
        <h2>{slot.name}</h2>
        <div className="tf-caption">{festivalDate(slot.startTime)} · {festivalTime(slot.startTime)}–{festivalTime(slot.endTime)} CDMX</div>
      </div>
      <span className={status === 'Abierto' ? 'tf-pill is-live' : 'tf-pill'}>{status}</span>
    </div>
  );
}

function FestivalSchedule({ slots, now, selected, onSelect }) {
  return (
    <section className="tf-agenda" aria-labelledby="tf-schedule">
      <div className="tf-agenda-heading"><h2 id="tf-schedule">Horario de mercados</h2><span>Hora CDMX</span></div>
      {slots.map(slot => (
        <button type="button" className="tf-slot" key={slot.key} aria-pressed={selected === slot.key}
          onClick={() => onSelect(selected === slot.key ? null : slot.key)}>
          <SlotInfo slot={slot} now={now} />
        </button>
      ))}
    </section>
  );
}

function FestivalSignupButton({ onOpenLogin }) {
  const { authenticated, loading } = usePointsAuth();
  if (authenticated || loading) return null;
  return <button type="button" className="tf-cta" onClick={onOpenLogin}>Crear cuenta</button>;
}

const directions = [
  { label: 'Sube', arrow: '↗', rule: 'Cierra por encima de la apertura' },
  { label: 'Baja', arrow: '↘', rule: 'Cierra por debajo de la apertura' },
];

function Direction({ index, price }) {
  const { label, arrow, rule } = directions[index];
  return (
    <>
      <b><span aria-hidden="true">{arrow}</span> {label} {Number.isFinite(price) && <strong>{formatPercent.format(price)}</strong>}</b>
      <small>{rule}</small>
    </>
  );
}

function FestivalDirections({ market }) {
  const prices = useFestivalMarketPrices(market?.status === 'canceled' ? null : market?.id);
  return (
    <div className="tf-directions">
      {directions.map(({ label }, index) => <span key={label}><Direction index={index} price={prices?.[index]} /></span>)}
    </div>
  );
}

function FestivalReplayMarket({ slot, now, dashboard }) {
  const started = now >= Date.parse(slot.startTime);
  const ended = now >= Date.parse(slot.endTime);
  const storageKey = `pronos:festival-replay:${slot.key}:${slot.startTime}`;
  const [pick, setPick] = useState(() => {
    if (dashboard) return null;
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === '0' || stored === '1') return Number(stored);
    } catch { /* A blocked storage API still allows a pick in this tab. */ }
    return null;
  });
  const { threshold, closePrice, outcome } = useFestivalReplay(slot.key, started);
  const canPick = !dashboard && started && !ended;

  function choose(index) {
    if (Date.now() < Date.parse(slot.startTime) || Date.now() >= Date.parse(slot.endTime)) return;
    setPick(index);
    try { window.localStorage.setItem(storageKey, String(index)); } catch { /* In-tab pick remains available. */ }
  }

  let status = 'Predicción de práctica · sin puntos';
  if (!dashboard && pick != null) status = `Tu predicción: ${directions[pick].label} · sin puntos`;
  if (ended) {
    if (threshold == null || closePrice == null) status = 'Esperando el resultado de la práctica';
    else if (outcome == null) status = 'Resultado de la práctica: empate';
    else status = `Resultado de la práctica: ${directions[outcome].label}${pick == null ? '' : pick === outcome ? ' · Acertaste' : ' · Tu predicción no acertó'}`;
  }

  return (
    <>
      <div className="tf-replay-caption tf-caption">
        Replay · {festivalTime(slot.replay.startTime)}–{festivalTime(slot.replay.endTime)} CDMX
        {threshold != null && <> · Apertura {festivalPrice(slot, threshold)}</>}
        {ended && closePrice != null && <> · Cierre {festivalPrice(slot, closePrice)}</>}
      </div>
      <div className="tf-directions">
        {directions.map(({ label }, index) => canPick ? (
          <button key={label} type="button" aria-pressed={pick === index} onClick={() => choose(index)}>
            <Direction index={index} />
          </button>
        ) : (
          <span key={label}><Direction index={index} /></span>
        ))}
      </div>
      <p className="tf-replay-caption tf-caption tf-replay-result" role="status">{status}</p>
    </>
  );
}

export default function TradingFestival({ dashboard = false, onOpenLogin }) {
  const { slots, error } = useFestivalSchedule();
  const now = useFestivalClock();
  const [selection, setSelection] = useState(null);
  const [displayMode, setDisplayMode] = useState('auto');
  const scheduled = slots.find(slot => (
    Date.parse(slot.startTime) <= now && now < Date.parse(slot.endTime)
  ));
  const closingReplay = slots.find(slot => {
    const end = Date.parse(slot.endTime);
    return slot.replay && end <= now && now < end + FESTIVAL_MINUTE;
  });
  const current = scheduled || closingReplay || slots.find(slot => Date.parse(slot.startTime) > now) || slots.at(-1);
  const slot = slots.find(item => item.key === selection) || current;
  const tradeUrl = marketUrl(slot);
  const showPresentationChart = isPresentation(slot);
  const showJar = dashboard && (displayMode === 'jar' || (displayMode === 'auto' && !scheduled && !closingReplay));

  function selectMode(mode) {
    if (mode === 'auto') setSelection(null);
    setDisplayMode(mode);
  }

  function selectSlot(key) {
    setSelection(key);
    if (dashboard && key) setDisplayMode('charts');
  }

  return (
    <main className={dashboard ? 'tf-page tf-dashboard' : 'tf-page tf-points'}>
      <div className="tf-shell">
        <header className="tf-header">
          <div className="tf-header-top">
            <a className="tf-brand" href="/" aria-label="Inicio de Pronos">PRONOS<span>.</span></a>
            <span className="tf-date">12–13 NOV 2026</span>
          </div>
          <h1>Trading <span>Festival</span></h1>
          {!showJar && <p>Predice si el precio sube o baja al cierre.</p>}
          {dashboard && (
            <div className="tf-display-switch" role="group" aria-label="Vista de la pantalla">
              {DISPLAY_MODES.map(([mode, label]) => (
                <button type="button" key={mode} aria-pressed={displayMode === mode} onClick={() => selectMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>
        {showJar ? (
          <Suspense fallback={<p className="tf-notice" role="status">Cargando frasco…</p>}>
            <FestivalJar event={FESTIVAL_JAR_EVENT} embedded />
          </Suspense>
        ) : (
          <>
            {error && <p className="tf-notice" role="status">El estado de los mercados se actualizará al reconectar.</p>}
            <article className="tf-feature">
              <SlotTitle slot={slot} now={now} />
              {showPresentationChart ? <FestivalPresentationChart key={slot.key} slot={slot} dashboard={dashboard} /> : (
                <TradingFestivalChart key={slot.key} slot={slot} />
              )}
              {slot.replay ? (
                <FestivalReplayMarket key={slot.key} slot={slot} now={now} dashboard={dashboard} />
              ) : (
                <FestivalDirections market={slot.market} />
              )}
              {!dashboard && !showPresentationChart && tradeUrl && (
                <Link className="tf-cta" to={tradeUrl}>
                  {festivalStatus(slot, now) === 'Abierto' ? 'Operar con puntos' : 'Ver mercado'} →
                </Link>
              )}
            </article>
            <FestivalSchedule slots={slots} now={now} selected={slot.key} onSelect={selectSlot} />
            {dashboard ? (
              <a className="tf-qr-panel" href={FESTIVAL_SIGNUP_URL}>
                <div>
                  <h2>Crea tu cuenta</h2>
                  <p>Escanea el código y participa con puntos.</p>
                  <span className="tf-qr-url">pronos.io/tradingfestival</span>
                </div>
                <img src="/points/trading-festival-signup.png" alt="Código QR para crear una cuenta en Pronos" width="492" height="492" />
              </a>
            ) : onOpenLogin && (
              <FestivalSignupButton onOpenLogin={onOpenLogin} />
            )}
          </>
        )}
      </div>
    </main>
  );
}
