import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { fetchAicmOverview, fetchMarkets } from '../lib/pointsApi.js';

const AEROMEXICO_NAVY = '#040C3E';
const AEROMEXICO_BLUE = '#8fb8ff';

const ACCENTS = {
  green: { fg: 'var(--yes)', bg: 'rgba(0, 232, 122, 0.12)', border: 'rgba(0, 232, 122, 0.28)' },
  amber: { fg: 'var(--gold)', bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.28)' },
  red: { fg: 'var(--danger)', bg: 'rgba(255, 69, 69, 0.12)', border: 'rgba(255, 69, 69, 0.28)' },
  blue: { fg: AEROMEXICO_BLUE, bg: 'rgba(4, 12, 62, 0.40)', border: 'rgba(143, 184, 255, 0.24)' },
  neutral: { fg: 'var(--text-primary)', bg: 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(4,12,62,0.16))', border: 'rgba(148, 163, 184, 0.18)' },
};

function formatNumber(n) {
  return Number(n || 0).toLocaleString('es-MX');
}

function formatObservedTime(iso) {
  if (!iso) return 'sin lectura';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin lectura';
  return d.toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMarketDate(iso) {
  if (!iso) return 'por definir';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'por definir';
  return d.toLocaleDateString('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: 'short',
  });
}

function pctLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${Math.round(n * 100)}%`;
}

function statusAccent(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'delayed') return ACCENTS.amber;
  if (s === 'cancelled' || s === 'fetch_error' || s === 'http_error') return ACCENTS.red;
  if (s === 'scheduled' || s === 'ok') return ACCENTS.green;
  if (s === 'boarding' || s === 'closed' || s === 'departed') return ACCENTS.blue;
  return { fg: 'var(--text-muted)', bg: 'rgba(255,255,255,0.05)', border: 'var(--border)' };
}

function statusLabel(status, raw) {
  const s = String(status || '').toLowerCase();
  if (s === 'delayed') return 'Demorado';
  if (s === 'cancelled') return 'Cancelado';
  if (s === 'scheduled') return 'A tiempo';
  if (s === 'boarding') return 'Abordando';
  if (s === 'closed') return 'Cerrado';
  if (s === 'departed') return 'Despegó';
  return raw || 'Sin estatus';
}

function delayVerdict(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'delayed') return { label: 'Sí', accent: ACCENTS.amber };
  if (s === 'cancelled') return { label: 'Cancelado', accent: ACCENTS.red };
  if (['scheduled', 'boarding', 'closed', 'departed'].includes(s)) return { label: 'No', accent: ACCENTS.green };
  return {
    label: 'N/D',
    accent: { fg: 'var(--text-muted)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)' },
  };
}

function boardStatusLabel(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'ok') return 'En vivo';
  if (s === 'maintenance') return 'Fuente en mantenimiento';
  if (s === 'fetch_error' || s === 'http_error') return 'Fuente sin respuesta';
  if (s === 'no_table') return 'Sin tabla oficial';
  return 'Esperando vuelos';
}

function CounterCard({ label, title, counter, accent = ACCENTS.neutral }) {
  return (
    <div style={{
      border: `1px solid ${accent.border}`,
      background: accent.bg,
      borderRadius: 8,
      padding: 18,
      minHeight: 132,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.035)',
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}>
        {label}
      </div>
      <div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 42,
          lineHeight: 1,
          color: accent.fg,
          letterSpacing: 0,
        }}>
          {formatNumber(counter?.delayedFlights)}
        </div>
        <div style={{
          marginTop: 8,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          fontSize: 12,
          letterSpacing: '0.04em',
        }}>
          {title}
        </div>
      </div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-muted)',
        fontSize: 11,
      }}>
        {formatNumber(counter?.observedFlights)} vuelos vistos
      </div>
    </div>
  );
}

function DailyBars({ rows }) {
  const max = Math.max(1, ...rows.map(row => Number(row.delayedFlights || 0)));
  const visible = rows.slice(-7);
  return (
    <div style={{
      border: '1px solid rgba(143,184,255,0.14)',
      borderRadius: 8,
      padding: 18,
      background: `linear-gradient(180deg, rgba(4,12,62,0.20), rgba(8,8,10,0.90))`,
      minHeight: 180,
    }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 16,
      }}>
        Ritmo semanal
      </div>
      {visible.length === 0 ? (
        <div style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          fontSize: 13,
          paddingTop: 34,
        }}>
          Sin lecturas recientes
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'end', gap: 10, minHeight: 104 }}>
          {visible.map(row => {
            const height = Math.max(8, Math.round((Number(row.delayedFlights || 0) / max) * 92));
            return (
              <div key={row.flightDate} style={{ flex: 1, minWidth: 26 }}>
                <div style={{
                  height,
                  borderRadius: 6,
                  background: `linear-gradient(180deg, ${AEROMEXICO_BLUE}, ${AEROMEXICO_NAVY})`,
                  border: '1px solid rgba(143,184,255,0.26)',
                }} />
                <div style={{
                  marginTop: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}>
                  {String(row.flightDate || '').slice(5)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FlightBoardCell({ children, muted = false, color = null }) {
  return (
    <span style={{
      display: 'block',
      minHeight: 34,
      padding: '8px 9px',
      borderRadius: 3,
      border: '1px solid rgba(255,255,255,0.08)',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.025) 48%, rgba(0,0,0,0.24) 49%, rgba(255,255,255,0.035))',
      color: color || (muted ? 'var(--text-muted)' : 'var(--text-primary)'),
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      textTransform: 'uppercase',
      boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.32)',
    }}>
      {children}
    </span>
  );
}

function Timetable({ rows, board, source }) {
  const visible = rows;
  const boardStatus = board?.status || source?.status || 'empty';
  const statusAccentValue = statusAccent(boardStatus);
  const totalFlights = Number(board?.totalFlights || rows.length || 0);
  const shownFlights = Number(board?.shownFlights || rows.length || 0);
  return (
    <div style={{
      border: '1px solid rgba(143,184,255,0.14)',
      borderRadius: 8,
      background: `linear-gradient(180deg, rgba(4,12,62,0.30), #050505 34%)`,
      overflow: 'hidden',
      boxShadow: '0 16px 60px rgba(0,0,0,0.34)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '18px 20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        background: `linear-gradient(180deg, rgba(4,12,62,0.74), rgba(4,12,62,0.18))`,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}>
            Tablero de salidas
          </div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 34,
            lineHeight: 1,
            color: 'var(--text-primary)',
            letterSpacing: 0,
          }}>
            MEX Salidas
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            border: `1px solid ${statusAccentValue.border}`,
            background: statusAccentValue.bg,
            color: statusAccentValue.fg,
            borderRadius: 999,
            padding: '7px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
            {boardStatusLabel(boardStatus)}
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}>
            {formatNumber(shownFlights)} / {formatNumber(totalFlights)} vuelos
          </span>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 1120 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '82px 104px minmax(130px, 1fr) minmax(190px, 1.25fr) 96px 132px 92px 132px',
            gap: 8,
            padding: '14px 18px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span>Hora</span>
            <span>Vuelo</span>
            <span>Aerolínea</span>
            <span>Destino</span>
            <span>Demora</span>
            <span>Estatus</span>
            <span>Puerta</span>
            <span>Lectura</span>
          </div>
          {visible.length === 0 ? (
            <div style={{
              padding: '36px 20px 40px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              fontSize: 13,
              lineHeight: 1.6,
            }}>
              {boardStatus === 'maintenance'
                ? 'AICM reporta el tablero oficial en mantenimiento. La lista se llenará cuando vuelva a publicar salidas.'
                : 'Sin salidas registradas hoy.'}
            </div>
          ) : visible.map(row => {
            const accent = statusAccent(row.statusNorm);
            const verdict = delayVerdict(row.statusNorm);
            return (
              <div
                key={`${row.flightKey}:${row.observedAt}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '82px 104px minmax(130px, 1fr) minmax(190px, 1.25fr) 96px 132px 92px 132px',
                  gap: 8,
                  padding: '14px 20px',
                  alignItems: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  fontFamily: 'var(--font-mono)',
                  color: '#f7c66f',
                  fontSize: 12,
                  letterSpacing: '0.02em',
                }}
              >
                <FlightBoardCell color="#fef3c7">{row.scheduledTimeLocal || '--:--'}</FlightBoardCell>
                <FlightBoardCell>{row.flightCode || 'N/D'}</FlightBoardCell>
                <FlightBoardCell muted={!row.airline}>{row.airline || 'N/D'}</FlightBoardCell>
                <FlightBoardCell muted={!row.city}>{row.city || 'Sin destino'}</FlightBoardCell>
                <FlightBoardCell color={verdict.accent.fg}>{verdict.label}</FlightBoardCell>
                <FlightBoardCell color={accent.fg}>{statusLabel(row.statusNorm, row.statusRaw)}</FlightBoardCell>
                <FlightBoardCell muted={!row.gate && !row.terminal}>{row.gate || row.terminal || 'N/D'}</FlightBoardCell>
                <FlightBoardCell muted>{formatObservedTime(row.observedAt)}</FlightBoardCell>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MarketWindowCard({ title, cadence, status, market, locked, isAdmin, onOpenAdmin }) {
  const navigate = useNavigate();
  const prices = Array.isArray(market?.prices) ? market.prices : [];
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const accent = locked ? ACCENTS.blue : market ? ACCENTS.green : ACCENTS.amber;
  return (
    <div style={{
      border: `1px solid ${accent.border}`,
      borderRadius: 8,
      background: locked ? 'rgba(96,165,250,0.06)' : 'var(--surface0)',
      padding: 18,
      minHeight: 248,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start' }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}>
            {cadence}
          </div>
          <h3 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            color: 'var(--text-primary)',
            letterSpacing: 0,
          }}>
            {title}
          </h3>
        </div>
        <span style={{
          flexShrink: 0,
          border: `1px solid ${accent.border}`,
          background: accent.bg,
          color: accent.fg,
          borderRadius: 999,
          padding: '6px 9px',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 900,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}>
          {status}
        </span>
      </div>

      {market ? (
        <>
          <div style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            Cierra {formatMarketDate(market.endTime)}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {outcomes.map((label, i) => (
              <div key={label} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'center',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 7,
                padding: '9px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-secondary)',
              }}>
                <span>{label} demoras</span>
                <strong style={{ color: i === 0 ? 'var(--yes)' : 'var(--text-primary)' }}>
                  {pctLabel(prices[i])}
                </strong>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/market?id=${encodeURIComponent(market.id)}`)}
            className="btn-primary"
            style={{ marginTop: 'auto' }}
          >
            Abrir mercado
          </button>
        </>
      ) : (
        <>
          <div style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            fontSize: 13,
            lineHeight: 1.55,
            minHeight: 76,
          }}>
            {locked
              ? 'Reservado para cuando el equipo quiera activar esta ventana.'
              : 'Esperando aprobación del mercado diario.'}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenAdmin}
              className={locked ? 'btn-ghost' : 'btn-primary'}
              style={{ marginTop: 'auto' }}
            >
              Abrir mercado
            </button>
          )}
        </>
      )}
    </div>
  );
}

function findDailyAicmMarket(markets) {
  return markets.find(m => (
    String(m?.source || '') === 'aicm-official-flight-board'
    && String(m?.resolverConfig?.window || '').toLowerCase() === 'day'
    && String(m?.sourceEventId || '').includes(':departure:day:')
  )) || null;
}

export default function PointsAicmPage({ isAdmin = false }) {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        const [nextOverview, nextMarkets] = await Promise.all([
          fetchAicmOverview(),
          fetchMarkets({ status: 'active', category: 'infraestructura', limit: 2000, featured: 'all' }),
        ]);
        if (cancelled) return;
        setOverview(nextOverview);
        setMarkets(nextMarkets);
      } catch (err) {
        if (!cancelled) setError(err?.code || 'aicm_load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const dailyMarket = useMemo(() => findDailyAicmMarket(markets), [markets]);
  const counters = overview?.counters || {};
  const source = overview?.source || {};
  const dailyRows = Array.isArray(overview?.daily) ? overview.daily : [];
  const timetable = Array.isArray(overview?.timetable) ? overview.timetable : [];

  const openAdmin = () => navigate('/admin');

  return (
    <section style={{
      maxWidth: 1320,
      margin: '0 auto',
      padding: '28px clamp(16px, 4vw, 52px) 64px',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))',
        gap: 24,
        alignItems: 'stretch',
      }}>
        <div style={{
          border: '1px solid rgba(143,184,255,0.22)',
          borderRadius: 8,
          background: `linear-gradient(140deg, ${AEROMEXICO_NAVY}, rgba(7,23,54,0.90) 52%, rgba(0,0,0,0.88))`,
          padding: 'clamp(22px, 4vw, 38px)',
          minHeight: 340,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: AEROMEXICO_BLUE,
              marginBottom: 14,
              fontWeight: 900,
            }}>
              Infraestructura
            </div>
            <h1 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              color: 'var(--text-primary)',
              fontSize: 64,
              lineHeight: 0.94,
              letterSpacing: 0,
            }}>
              Pulso AICM
            </h1>
            <p style={{
              maxWidth: 720,
              margin: '20px 0 0',
              color: 'var(--text-secondary)',
              fontSize: 18,
              lineHeight: 1.45,
              fontWeight: 700,
            }}>
              Demoras de salida en el aeropuerto de la Ciudad de México, medidas desde el tablero oficial.
            </p>
          </div>
          <div style={{
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
            marginTop: 28,
          }}>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: `1px solid ${statusAccent(source.status).border}`,
              background: statusAccent(source.status).bg,
              color: statusAccent(source.status).fg,
              borderRadius: 999,
              padding: '8px 12px',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor' }} />
              Oracle {source.status || 'empty'}
            </span>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
              style={{ textDecoration: 'none' }}
            >
              Fuente AICM
            </a>
          </div>
        </div>

        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          background: `linear-gradient(180deg, rgba(4,12,62,0.20), rgba(8,8,10,0.88))`,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 340,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            Última lectura
          </div>
          <div>
            <div style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--text-primary)',
              fontSize: 48,
              lineHeight: 1,
              letterSpacing: 0,
            }}>
              {loading ? '...' : formatObservedTime(source.lastObservedAt)}
            </div>
            <p style={{
              margin: '16px 0 0',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)',
              fontSize: 12,
              lineHeight: 1.55,
            }}>
              {error ? `Error: ${error}` : 'Tablero oficial AICM · salidas'}
            </p>
          </div>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 14,
        marginTop: 18,
      }}>
        <CounterCard label="Última hora" title="salidas demoradas" counter={counters.hour} />
        <CounterCard label="Hoy" title="salidas demoradas" counter={counters.day} />
        <CounterCard label="7 días" title="salidas demoradas" counter={counters.week} />
      </div>

      <div style={{ marginTop: 22 }}>
        <Timetable rows={timetable} board={overview?.board} source={source} />
      </div>

      <div style={{ marginTop: 22 }}>
        <DailyBars rows={dailyRows} />
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        alignItems: 'end',
        marginTop: 34,
        marginBottom: 14,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--orange)',
            marginBottom: 8,
          }}>
            Ventanas de mercado
          </div>
          <h2 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            color: 'var(--text-primary)',
            fontSize: 34,
            letterSpacing: 0,
          }}>
            Demoras por periodo
          </h2>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 16,
      }}>
        <MarketWindowCard
          title="Hora"
          cadence="Cada 60 min"
          status="Cerrado"
          locked
          isAdmin={isAdmin}
          onOpenAdmin={openAdmin}
        />
        <MarketWindowCard
          title="Día"
          cadence="24 horas"
          status={dailyMarket ? 'Abierto' : 'Por aprobar'}
          market={dailyMarket}
          isAdmin={isAdmin}
          onOpenAdmin={openAdmin}
        />
        <MarketWindowCard
          title="Semana"
          cadence="7 días"
          status="Cerrado"
          locked
          isAdmin={isAdmin}
          onOpenAdmin={openAdmin}
        />
      </div>
    </section>
  );
}
