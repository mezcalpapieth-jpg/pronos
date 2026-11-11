import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { FESTIVAL_SIGNUP_URL } from '../../../../shared/trading-festival.js';
import TradingFestivalChart from '../components/TradingFestivalChart.jsx';
import { festivalDate, festivalStatus, festivalTime, useFestivalClock, useFestivalSchedule } from '../lib/tradingFestival.js';

function marketUrl(slot) {
  return slot.market && slot.market.status !== 'pending' ? `/market?id=${slot.market.id}` : null;
}

function isNasdaqPresentation(slot, dashboard) {
  return dashboard && slot.key === 'ndx';
}

function displayStatus(slot, now, dashboard) {
  return isNasdaqPresentation(slot, dashboard) ? 'Presentación' : festivalStatus(slot, now);
}

const NASDAQ_CHART_ORIGIN = 'https://pronos-chi.vercel.app';

function NasdaqPresentationChart() {
  const frame = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    function handleChartReady(event) {
      if (event.origin === NASDAQ_CHART_ORIGIN && event.source === frame.current?.contentWindow
        && event.data === 'pronos:festival-nasdaq-ready') {
        setReady(true);
      }
    }

    window.addEventListener('message', handleChartReady);
    return () => window.removeEventListener('message', handleChartReady);
  }, []);

  return (
    <div className="tf-nasdaq-presentation">
      {/* Keep the third-party widget on a separate origin from the festival page. */}
      <iframe
        ref={frame}
        className="tf-nasdaq-frame"
        src={`${NASDAQ_CHART_ORIGIN}/festival-nasdaq-chart`}
        title="Gráfica del Nasdaq-100"
        sandbox="allow-scripts allow-same-origin"
        credentialless=""
        style={{ visibility: ready ? 'visible' : 'hidden' }}
      />
      {!ready && (
        <div className="tf-nasdaq-fallback">
          <a className="tf-cta" href="https://vunelix.com/chart?symbol=NASDAQ%3ANDX" target="_blank" rel="noopener noreferrer">
            Ver gráfica del Nasdaq-100 ↗
          </a>
          <small className="tf-caption">Vunelix</small>
        </div>
      )}
    </div>
  );
}

function SlotInfo({ slot, now, dashboard }) {
  const status = displayStatus(slot, now, dashboard);
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

function SlotTitle({ slot, now, dashboard }) {
  const status = displayStatus(slot, now, dashboard);
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

function FestivalSchedule({ slots, now, selected, onSelect, dashboard }) {
  return (
    <section className="tf-agenda" aria-labelledby="tf-schedule">
      <div className="tf-agenda-heading"><h2 id="tf-schedule">Horario de mercados</h2><span>Hora CDMX</span></div>
      {slots.map(slot => (
        <button type="button" className="tf-slot" key={slot.key} aria-pressed={selected === slot.key}
          onClick={() => onSelect(selected === slot.key ? null : slot.key)}>
          <SlotInfo slot={slot} now={now} dashboard={dashboard} />
        </button>
      ))}
      <p className="tf-agenda-note">Dos mercados más por anunciar.</p>
    </section>
  );
}

function FestivalSignupButton({ onOpenLogin }) {
  const { authenticated, loading } = usePointsAuth();
  if (authenticated || loading) return null;
  return <button type="button" className="tf-cta" onClick={onOpenLogin}>Crear cuenta</button>;
}

export default function TradingFestival({ dashboard = false, onOpenLogin }) {
  const { slots, error } = useFestivalSchedule();
  const now = useFestivalClock();
  const [selection, setSelection] = useState(null);
  const current = slots.find(slot => (
    (!slot.requiresReschedule || isNasdaqPresentation(slot, dashboard))
    && Date.parse(slot.startTime) <= now && now < Date.parse(slot.endTime)
  ))
    || slots.find(slot => Date.parse(slot.startTime) > now)
    || slots.at(-1);
  const slot = slots.find(item => item.key === selection) || current;
  const tradeUrl = marketUrl(slot);
  const showNasdaqChart = isNasdaqPresentation(slot, dashboard);

  return (
    <main className={dashboard ? 'tf-page tf-dashboard' : 'tf-page tf-points'}>
      <div className="tf-shell">
        <header className="tf-header">
          <div className="tf-header-top">
            <a className="tf-brand" href="/" aria-label="Inicio de Pronos">PRONOS<span>.</span></a>
            <span className="tf-date">12–13 NOV 2026</span>
          </div>
          <h1>Trading <span>Festival</span></h1>
          <p>Predice si el precio sube o baja al cierre.</p>
        </header>
        {error && <p className="tf-notice" role="status">El estado de los mercados se actualizará al reconectar.</p>}
        <article className="tf-feature">
          <SlotTitle slot={slot} now={now} dashboard={dashboard} />
          {showNasdaqChart ? <NasdaqPresentationChart /> : (
            <TradingFestivalChart key={slot.key} slot={slot} />
          )}
          {!showNasdaqChart && (
            <div className="tf-directions">
              <span><b><span aria-hidden="true">↗</span> Sube</b><small>Cierra por encima de la apertura</small></span>
              <span><b><span aria-hidden="true">↘</span> Baja</b><small>Cierra por debajo de la apertura</small></span>
            </div>
          )}
          {!dashboard && tradeUrl && (
            <Link className="tf-cta" to={tradeUrl}>
              {festivalStatus(slot, now) === 'Abierto' ? 'Operar con puntos' : 'Ver mercado'} →
            </Link>
          )}
        </article>
        <FestivalSchedule slots={slots} now={now} selected={slot.key} onSelect={setSelection} dashboard={dashboard} />
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
      </div>
    </main>
  );
}
