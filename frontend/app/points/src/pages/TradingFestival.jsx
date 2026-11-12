import React, { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import FestivalChartResolver from '../components/FestivalChartResolver.jsx';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { FESTIVAL_MINUTE, FESTIVAL_SIGNUP_URL } from '../../../../shared/trading-festival.js';
import { FESTIVAL_JAR_EVENT } from '../../../../shared/jar-events.js';
import TradingFestivalChart from '../components/TradingFestivalChart.jsx';
import {
  festivalDate, festivalStatus, festivalTime,
  useFestivalClock, useFestivalMarketPrices, useFestivalSchedule,
} from '../lib/tradingFestival.js';

const FestivalJar = lazy(() => import('./Ris26Page.jsx'));
const DISPLAY_MODES = [
  ['auto', 'Automático'],
  ['charts', 'Gráficas'],
  ['jar', 'Frasco'],
];
const formatPercent = new Intl.NumberFormat('es-MX', { style: 'percent' });

function marketUrl(slot) {
  return !slot.replay && slot.market && slot.market.status !== 'pending' ? `/market?id=${slot.market.id}` : null;
}

function isPresentation(slot) {
  return Boolean(slot.replay || (slot.presentationTicker && slot.feedEnabled !== true && !slot.market));
}

function displayStatus(slot, now) {
  return isPresentation(slot) ? 'Presentación' : festivalStatus(slot, now);
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

export default function TradingFestival({ dashboard = false, onOpenLogin, isAdmin = false }) {
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
  const showJar = dashboard && (displayMode === 'jar' || (displayMode === 'auto' && !scheduled && !closingReplay));

  function selectMode(mode) {
    if (mode === 'auto') setSelection(null);
    setDisplayMode(mode);
  }

  function selectSlot(key) {
    setSelection(key);
    if (dashboard && key) setDisplayMode('charts');
  }

  const showResolver = !dashboard && isAdmin && new URLSearchParams(window.location.search).get('resolver') === '1';
  if (showResolver) return <FestivalChartResolver slots={slots} now={now} scheduleError={error} />;

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
          {!dashboard && isAdmin && <a className="tf-caption" href="?resolver=1">Resolución de gráficas ↗</a>}
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
              <TradingFestivalChart key={slot.key} slot={slot} dashboard={dashboard} />
              {slot.replay && (
                <div className="tf-replay-caption tf-caption">
                  Replay · {festivalTime(slot.replay.startTime)}–{festivalTime(slot.replay.endTime)} CDMX
                </div>
              )}
              <FestivalDirections market={slot.replay ? null : slot.market} />
              {!dashboard && tradeUrl && (
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
