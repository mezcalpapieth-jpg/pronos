import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { FESTIVAL_SIGNUP_URL } from '../../../../shared/trading-festival.js';
import TradingFestivalChart from '../components/TradingFestivalChart.jsx';
import { festivalDate, festivalStatus, festivalTime, useFestivalClock, useFestivalSchedule } from '../lib/tradingFestival.js';

function marketUrl(slot) {
  return slot.market && slot.market.status !== 'pending' ? `/market?id=${slot.market.id}` : null;
}

function SlotInfo({ slot, now }) {
  return (
    <>
      <span className="tf-slot-time">
        <span>{festivalDate(slot.startTime)}</span>
        <strong>{festivalTime(slot.startTime)}–{festivalTime(slot.endTime)}</strong>
      </span>
      <span className="tf-slot-name"><strong>{slot.name}</strong><small>{slot.symbol}</small></span>
      <span className={festivalStatus(slot, now) === 'En juego' ? 'tf-pill is-live' : 'tf-pill'}>
        {festivalStatus(slot, now)}
      </span>
    </>
  );
}

function SlotTitle({ slot, now }) {
  const isOpen = slot.market?.status === 'active' && now < Date.parse(slot.endTime);
  return (
    <div className="tf-market-heading">
      <div>
        <div className="tf-caption">{festivalDate(slot.startTime)} · {festivalTime(slot.startTime)}–{festivalTime(slot.endTime)} CDMX</div>
        <h2>{slot.name}</h2>
      </div>
      <span className={isOpen ? 'tf-pill is-live' : 'tf-pill'}>{festivalStatus(slot, now)}</span>
    </div>
  );
}

function FestivalSchedule({ slots, now, selected, onSelect }) {
  return (
    <div className="tf-agenda">
      <div className="tf-agenda-heading"><h2>Horarios</h2><span>Ciudad de México</span></div>
      {slots.map(slot => (
        <button type="button" className="tf-slot" key={slot.key} aria-pressed={selected === slot.key}
          onClick={() => onSelect(selected === slot.key ? null : slot.key)}>
          <SlotInfo slot={slot} now={now} />
        </button>
      ))}
      <p className="tf-agenda-note">Dos mercados más por anunciar.</p>
    </div>
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
  const current = slots.find(slot => !slot.requiresReschedule && Date.parse(slot.startTime) <= now && now < Date.parse(slot.endTime))
    || slots.find(slot => Date.parse(slot.startTime) > now)
    || slots.at(-1);
  const slot = slots.find(item => item.key === selection) || current;
  const tradeUrl = marketUrl(slot);

  return (
    <main className={dashboard ? 'tf-page tf-dashboard' : 'tf-page tf-points'}>
      <div className="tf-shell">
        <header className="tf-header">
          <div className="tf-header-top">
            <span className="tf-brand">pronos<span>.</span></span>
            <span className="tf-date">12–13 NOV 2026</span>
          </div>
          <h1>Trading<br className="tf-dashboard-break" /> Festival<span>.</span></h1>
          <p>Predice si el precio sube o baja.</p>
        </header>
        {error && <p className="tf-notice" role="status">El estado de los mercados se actualizará al reconectar.</p>}
        <article className="tf-feature">
          <SlotTitle slot={slot} now={now} />
          <TradingFestivalChart key={slot.key} slot={slot} />
          <div className="tf-directions">
            <span>↗ Sube <small>Por encima de la referencia</small></span>
            <span>↘ Baja <small>Por debajo de la referencia</small></span>
          </div>
          {!dashboard && tradeUrl && (
            <Link className="tf-cta" to={tradeUrl}>
              {festivalStatus(slot, now) === 'En juego' ? 'Operar con puntos' : 'Ver mercado'} →
            </Link>
          )}
        </article>
        <FestivalSchedule slots={slots} now={now} selected={slot.key} onSelect={setSelection} />
        {dashboard ? (
          <a className="tf-qr-panel" href={FESTIVAL_SIGNUP_URL}>
            <div>
              <div className="tf-caption">Participa con puntos</div>
              <h2>Escanea y<br />crea tu cuenta.</h2>
              <span>pronos.io</span>
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
