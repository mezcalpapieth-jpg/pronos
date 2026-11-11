import { useEffect, useState } from 'react';
import { FESTIVAL_SCHEDULE, FESTIVAL_TIME_ZONE } from '../../../../shared/trading-festival.js';

const ENDPOINT = '/api/points/trading-festival';
const timeFormat = new Intl.DateTimeFormat('es-MX', {
  timeZone: FESTIVAL_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const dateFormat = new Intl.DateTimeFormat('es-MX', {
  timeZone: FESTIVAL_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short',
});

export function festivalTime(time) {
  return timeFormat.format(new Date(time));
}

export function festivalDate(time) {
  return dateFormat.format(new Date(time));
}

export function festivalPrice(slot, value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: slot.decimals,
    minimumFractionDigits: slot.decimals,
  }).format(value);
}

export function festivalStatus(slot, now) {
  const market = slot.market;
  if (slot.requiresReschedule) return 'Horario por confirmar';
  if (market?.status === 'resolved') return market.outcome === 0 ? 'Subió' : 'Bajó';
  if (market?.status === 'canceled') return 'Cancelado';
  if (!market && slot.feedEnabled === false) return 'Feed por confirmar';
  if (now < Date.parse(slot.startTime)) return 'Próximo';
  if (now < Date.parse(slot.endTime)) return market?.status === 'active' ? 'En juego' : 'Esperando apertura';
  return market?.status === 'active' ? 'Por resolver' : 'Cerrado';
}

function useFestivalPoll(url, interval, initial) {
  const [snapshot, setSnapshot] = useState({ data: initial, error: false });
  useEffect(() => {
    const controller = new AbortController();
    let timeout;
    async function refresh() {
      try {
        const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error('festival_request_failed');
        const data = await response.json();
        if (!controller.signal.aborted) setSnapshot({ data, error: false });
      } catch {
        if (!controller.signal.aborted) setSnapshot(previous => ({ ...previous, error: true }));
      } finally {
        if (!controller.signal.aborted) timeout = setTimeout(refresh, interval);
      }
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [url, interval]);
  return snapshot;
}

const initialSchedule = { slots: FESTIVAL_SCHEDULE };
const initialBars = { bars: [], status: 'loading' };

export function useFestivalSchedule() {
  const { data, error } = useFestivalPoll(ENDPOINT, 10_000, initialSchedule);
  return { slots: data.slots, error };
}

export function useFestivalBars(key) {
  return useFestivalPoll(`${ENDPOINT}?slot=${encodeURIComponent(key)}`, 15_000, initialBars);
}

export function useFestivalClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
