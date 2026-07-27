import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCurrentCycle, fetchCycleHistory, fetchLeaderboard } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang } from '@app/lib/i18n.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { LeaderboardSkeleton } from '../components/PointsSkeleton.jsx';

function fmt(n) {
  return Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCountdown(totalSeconds, lang) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return lang === 'en' ? 'Closing pending' : 'Cierre pendiente';
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function TournamentCard({ children, style }) {
  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 'clamp(18px, 3vw, 28px)',
      ...style,
    }}>
      {children}
    </section>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      letterSpacing: '0.14em',
      color: '#ff5500',
      textTransform: 'uppercase',
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function LeaderboardRow({ row, currentUsername }) {
  const isMe = row.username === currentUsername;
  const delta = Number(row.cycleDelta ?? row.finalPnl ?? 0);
  return (
    <Link
      to={`/u/${encodeURIComponent(row.username)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '44px minmax(0, 1fr) minmax(110px, auto) minmax(90px, auto)',
        gap: 12,
        alignItems: 'center',
        padding: '13px 0',
        borderBottom: '1px solid var(--border)',
        textDecoration: 'none',
        color: isMe ? 'var(--green)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{row.rank}.</span>
      <strong style={{
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: isMe ? 'var(--green)' : 'var(--text-primary)',
        fontFamily: 'var(--font-body)',
        fontSize: 15,
      }}>
        {isMe ? '(tú) ' : ''}{row.username}
      </strong>
      <span style={{ color: 'var(--text-primary)', textAlign: 'right' }}>
        {fmt(row.balance ?? row.finalBalance)} MXNP
      </span>
      <span style={{
        color: delta >= 0 ? 'var(--green)' : 'var(--red, #ef4444)',
        textAlign: 'right',
      }}>
        {delta >= 0 ? '+' : ''}{fmt(delta)}
      </span>
    </Link>
  );
}

function PrizeRows({ lang }) {
  const rows = [
    { rank: '1', prize: '$5,000 MXN' },
    { rank: '2', prize: '$3,000 MXN' },
    { rank: '3', prize: '$2,000 MXN' },
    { rank: '4-10', prize: lang === 'en' ? 'Surprise prize' : 'Premio sorpresa' },
  ];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(row => (
        <div key={row.rank} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 14px',
          border: '1px solid rgba(0,232,122,0.18)',
          borderRadius: 10,
          background: 'var(--surface2)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {row.rank}
          </span>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--green)' }}>
            {row.prize}
          </strong>
        </div>
      ))}
    </div>
  );
}

export default function PointsTournament() {
  const lang = useLang();
  const { user } = usePointsAuth();
  const isMobile = useIsMobile();
  const [cycle, setCycle] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [history, setHistory] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchCurrentCycle().catch(() => null),
      fetchLeaderboard().catch(() => null),
      fetchCycleHistory(8).catch(() => []),
    ]).then(([cycleData, leaderboardData, historyData]) => {
      if (cancelled) return;
      setCycle(cycleData);
      setLeaderboard(leaderboardData);
      setHistory(Array.isArray(historyData) ? historyData : []);
    });
    const id = window.setInterval(() => setTick(t => t + 1), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const countdown = useMemo(() => {
    if (cycle?.paused || !cycle?.endsAt) return null;
    const seconds = Math.max(0, Math.floor((new Date(cycle.endsAt).getTime() - Date.now()) / 1000));
    return formatCountdown(seconds, lang);
  }, [cycle, lang, tick]);

  const top = Array.isArray(leaderboard?.top) ? leaderboard.top : [];
  const cycles = Array.isArray(history) ? history : [];

  return (
    <main style={{
      maxWidth: 1160,
      margin: '0 auto',
      padding: 'clamp(32px, 6vw, 72px) clamp(16px, 4vw, 28px)',
    }}>
      <section style={{ marginBottom: 28 }}>
        <SectionLabel>{lang === 'en' ? 'Pronos tournament' : 'Torneo Pronos'}</SectionLabel>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(42px, 8vw, 86px)',
          lineHeight: 0.92,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
          margin: 0,
        }}>
          {lang === 'en' ? 'Play the cycle' : 'Juega el ciclo'}
        </h1>
        <p style={{
          maxWidth: 760,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
          fontSize: 'clamp(17px, 2.2vw, 24px)',
          lineHeight: 1.45,
          margin: '18px 0 0',
        }}>
          {lang === 'en'
            ? 'Every cycle starts from the same base. Grow your MXNP balance by predicting markets, then the leaderboard closes with cash prizes for the top places.'
            : 'Cada ciclo empieza desde la misma base. Haz crecer tu balance de MXNP prediciendo mercados, y al cierre el leaderboard reparte premios en efectivo a los primeros lugares.'}
        </p>
      </section>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.3fr) minmax(280px, 0.7fr)',
        gap: 18,
        marginBottom: 18,
      }}>
        <TournamentCard>
          <SectionLabel>{cycle?.paused ? (lang === 'en' ? 'Coming soon' : 'Próximamente') : (cycle?.label || (lang === 'en' ? 'Current cycle' : 'Ciclo actual'))}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div>
              <div style={metricLabel}>{lang === 'en' ? 'Status' : 'Estado'}</div>
              <div style={metricValue}>{cycle?.paused ? (lang === 'en' ? 'Paused' : 'Pausado') : (lang === 'en' ? 'Open' : 'Abierto')}</div>
            </div>
            <div>
              <div style={metricLabel}>{lang === 'en' ? 'Countdown' : 'Cuenta regresiva'}</div>
              <div style={metricValue}>{countdown || (lang === 'en' ? 'Soon' : 'Pronto')}</div>
            </div>
            <div>
              <div style={metricLabel}>{lang === 'en' ? 'Participants' : 'Participantes'}</div>
              <div style={metricValue}>{Number(leaderboard?.totalParticipants || 0).toLocaleString('es-MX')}</div>
            </div>
          </div>
        </TournamentCard>

        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Prizes' : 'Premios'}</SectionLabel>
          <PrizeRows lang={lang} />
        </TournamentCard>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
        gap: 18,
        marginBottom: 18,
      }}>
        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'How it works' : 'Cómo funciona'}</SectionLabel>
          <div style={{ display: 'grid', gap: 14 }}>
            {[
              lang === 'en' ? 'Start with 500 MXNP in the cycle wallet.' : 'Empiezas con 500 MXNP en la cartera del ciclo.',
              lang === 'en' ? 'Buy and sell shares across real markets. Your balance moves with every trade and reward.' : 'Compras y vendes acciones en mercados reales. Tu balance se mueve con cada trade y recompensa.',
              lang === 'en' ? 'To qualify for prizes, participate in at least 10 markets during the cycle.' : 'Para calificar a premios, participa en al menos 10 mercados durante el ciclo.',
              lang === 'en' ? 'At close, admin snapshots the leaderboard and opens the next cycle when prizes resume.' : 'Al cierre, admin congela el leaderboard y abre el siguiente ciclo cuando vuelvan los premios.',
            ].map((text, idx) => (
              <div key={text} style={{ display: 'grid', gridTemplateColumns: '34px minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(255,85,0,0.12)',
                  border: '1px solid rgba(255,85,0,0.35)',
                  color: '#ff5500',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                }}>
                  {idx + 1}
                </span>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.55 }}>
                  {text}
                </p>
              </div>
            ))}
          </div>
        </TournamentCard>

        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Current leaderboard' : 'Leaderboard actual'}</SectionLabel>
          {leaderboard === null ? (
            <LeaderboardSkeleton rows={8} />
          ) : top.length === 0 ? (
            <p style={emptyText}>{lang === 'en' ? 'No participants yet.' : 'Aún no hay participantes.'}</p>
          ) : (
            <div>
              {top.map(row => (
                <LeaderboardRow key={row.username} row={row} currentUsername={user?.username} />
              ))}
              {leaderboard?.me && leaderboard.me.rank > 10 && (
                <div style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px dashed var(--border)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--green)',
                  fontSize: 12,
                }}>
                  {lang === 'en' ? 'Your place' : 'Tu posición'}: {leaderboard.me.rank} - {fmt(leaderboard.me.balance)} MXNP
                </div>
              )}
            </div>
          )}
        </TournamentCard>
      </div>

      <TournamentCard>
        <SectionLabel>{lang === 'en' ? 'Past leaderboards' : 'Leaderboards anteriores'}</SectionLabel>
        {history === null ? (
          <LeaderboardSkeleton rows={5} />
        ) : cycles.length === 0 ? (
          <p style={emptyText}>
            {lang === 'en'
              ? 'Past cycles will appear here after the first close.'
              : 'Los ciclos anteriores aparecerán aquí después del primer cierre.'}
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {cycles.map(cycleRow => (
              <div key={cycleRow.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginBottom: 6,
                }}>
                  <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 16 }}>
                    {cycleRow.label || `Ciclo #${cycleRow.id}`}
                  </strong>
                  {cycleRow.closedAt && (
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {new Date(cycleRow.closedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX')}
                    </span>
                  )}
                </div>
                {(cycleRow.top || []).slice(0, 10).map(row => (
                  <LeaderboardRow key={`${cycleRow.id}-${row.username}`} row={row} currentUsername={user?.username} />
                ))}
              </div>
            ))}
          </div>
        )}
      </TournamentCard>
    </main>
  );
}

const metricLabel = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 8,
};

const metricValue = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(24px, 3vw, 38px)',
  color: 'var(--text-primary)',
  textTransform: 'uppercase',
  letterSpacing: '0.02em',
};

const emptyText = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};
