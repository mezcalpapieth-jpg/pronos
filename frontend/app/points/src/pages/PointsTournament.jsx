import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchCurrentCycle, fetchCycleHistory, fetchLeaderboard } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useLang } from '@app/lib/i18n.js';
import { useIsMobile } from '@app/lib/useIsMobile.js';
import { LeaderboardSkeleton } from '../components/PointsSkeleton.jsx';

const DEFAULT_RULES = {
  startingBalance: 1500,
  minEntryMxnp: 300,
  maxSharesPerMarket: 6000,
  qualifyingMarkets: 10,
  inactivityPenalty: 50,
  rewards: {
    dailyBase: 150,
    dailyStep: 15,
    dailyMax: 225,
    referralCycleCap: 10,
    referrerReward: 375,
    referredReward: 300,
    rescueFloor: 300,
    rescueMaxClaims: 3,
  },
  prizes: [
    { rank: '1', amount: 3500, prize: '$3,500 MXN' },
    { rank: '2', amount: 2500, prize: '$2,500 MXN' },
    { rank: '3', amount: 1800, prize: '$1,800 MXN' },
    { rank: '4', amount: 1200, prize: '$1,200 MXN' },
    { rank: '5', amount: 1000, prize: '$1,000 MXN' },
  ],
};

function fmt(n, digits = 2) {
  return Number(n || 0).toLocaleString('es-MX', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtInteger(n) {
  return Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
}

function formatCountdown(totalSeconds, lang) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return lang === 'en' ? 'Pending' : 'Pendiente';
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  if (days === 0 && hours === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function statusCopy(status, lang) {
  const copies = {
    scheduled: { es: 'Programado', en: 'Scheduled' },
    active: { es: 'Activo', en: 'Active' },
    closing: { es: 'Cierre final', en: 'Final close' },
    closed: { es: 'Cerrado', en: 'Closed' },
    paused: { es: 'Pausado', en: 'Paused' },
  };
  return (copies[status] || copies.scheduled)[lang] || copies.scheduled.es;
}

function targetForCycle(cycle) {
  if (!cycle) return null;
  if (cycle.status === 'scheduled') {
    return { label: { es: 'Inicia en', en: 'Starts in' }, iso: cycle.startsAt || cycle.startedAt };
  }
  if (cycle.status === 'active') {
    return { label: { es: 'Operación cierra en', en: 'Trading closes in' }, iso: cycle.operationCloseAt || cycle.endsAt };
  }
  if (cycle.status === 'closing') {
    return { label: { es: 'Ranking cierra en', en: 'Ranking closes in' }, iso: cycle.rankingCutoffAt || cycle.endsAt };
  }
  return { label: { es: 'Estado', en: 'Status' }, iso: cycle.endsAt };
}

function TournamentCard({ children, style }) {
  return (
    <section style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: 'clamp(16px, 2.4vw, 24px)',
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
      fontSize: 10,
      letterSpacing: '0.12em',
      color: 'var(--orange)',
      textTransform: 'uppercase',
      marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

function Metric({ label, value, tone = 'primary', sub }) {
  const color = tone === 'green'
    ? 'var(--green)'
    : tone === 'orange'
      ? 'var(--orange)'
      : 'var(--text-primary)';
  return (
    <div style={{
      minWidth: 0,
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '14px 14px 13px',
      background: 'var(--surface2)',
    }}>
      <div style={metricLabel}>{label}</div>
      <div style={{ ...metricValue, color }}>{value}</div>
      {sub && <div style={metricSub}>{sub}</div>}
    </div>
  );
}

function LeaderboardRow({ row, currentUsername, rules, compact = false, lang = 'es' }) {
  const isMe = row.username === currentUsername;
  const score = Number(row.score ?? row.cycleDelta ?? row.finalPnl ?? 0);
  const pnl = Number(row.marketPnl ?? 0);
  const penalty = Number(row.inactivityPenalty ?? 0);
  const qualified = Boolean(row.qualified);
  const qualifyingMarkets = Number(row.qualifyingMarkets || 0);
  const requiredMarkets = Number(rules?.qualifyingMarkets || DEFAULT_RULES.qualifyingMarkets);
  const neededMarkets = Math.max(0, requiredMarkets - qualifyingMarkets);
  return (
    <Link
      to={`/u/${encodeURIComponent(row.username)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: compact ? '30px minmax(0, 1fr) minmax(92px, auto)' : '36px minmax(0, 1fr) minmax(112px, auto) minmax(116px, auto)',
        gap: 12,
        alignItems: 'center',
        padding: compact ? '10px 0' : '12px 0',
        borderBottom: '1px solid var(--border)',
        textDecoration: 'none',
        color: isMe ? 'var(--green)' : 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{row.rank}.</span>
      <span style={{ minWidth: 0 }}>
        <strong style={{
          display: 'block',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: isMe ? 'var(--green)' : 'var(--text-primary)',
          fontFamily: 'var(--font-body)',
          fontSize: compact ? 13 : 14,
        }}>
          {isMe ? '(tú) ' : ''}{row.username}
        </strong>
        {!compact && (
          <span style={{ display: 'block', marginTop: 4, color: 'var(--text-muted)' }}>
            {qualified
              ? `${qualifyingMarkets} ${lang === 'en' ? 'markets · qualified' : 'mercados · califica'}`
              : `${qualifyingMarkets} ${lang === 'en' ? `markets · ${neededMarkets} left` : `mercados · faltan ${neededMarkets}`}`}
          </span>
        )}
      </span>
      {!compact && (
        <span style={{ color: pnl >= 0 ? 'var(--green)' : 'var(--danger)', textAlign: 'right' }}>
          PnL {pnl >= 0 ? '+' : ''}{fmt(pnl)}
          {penalty > 0 && (
            <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 4 }}>
              -{fmt(penalty)} {lang === 'en' ? 'inactive' : 'inactividad'}
            </span>
          )}
        </span>
      )}
      <strong style={{
        color: score >= 0 ? 'var(--text-primary)' : 'var(--danger)',
        textAlign: 'right',
        fontFamily: 'var(--font-body)',
        fontSize: compact ? 13 : 15,
      }}>
        {score >= 0 ? '+' : ''}{fmt(score)}
      </strong>
    </Link>
  );
}

function PrizeRows({ rules }) {
  const rows = Array.isArray(rules?.prizes) && rules.prizes.length > 0
    ? rules.prizes
    : DEFAULT_RULES.prizes;
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      {rows.map(row => (
        <div key={row.rank} style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '11px 12px',
          border: '1px solid rgba(0,232,122,0.18)',
          borderRadius: 8,
          background: 'var(--surface2)',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {row.rank}
          </span>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--green)' }}>
            {row.prize}
          </strong>
        </div>
      ))}
    </div>
  );
}

function RuleList({ lang, rules }) {
  const r = rules || DEFAULT_RULES;
  const items = lang === 'en' ? [
    `Ranking score is market PnL marked to current prices, minus ${fmtInteger(r.inactivityPenalty)} MXNP for each inactive day.`,
    `Bonuses fund your account, but signup, streak, social, and referral rewards do not directly add to the score.`,
    `You qualify with ${fmtInteger(r.qualifyingMarkets)} entries in distinct markets. Each entry has a ${fmtInteger(r.minEntryMxnp)} MXNP minimum.`,
    `Each user can hold up to ${fmtInteger(r.maxSharesPerMarket)} shares per market.`,
    'Ties break by fewer inactive days, more distinct liquidated markets, then older registration.',
  ] : [
    `El puntaje es el PnL de mercados marcado a precio actual, menos ${fmtInteger(r.inactivityPenalty)} MXNP por cada día inactivo.`,
    'Los bonos fondean tu cuenta, pero registro, racha, redes y referidos no suman directo al puntaje.',
    `Calificas con ${fmtInteger(r.qualifyingMarkets)} entradas en mercados distintos. Cada entrada tiene mínimo de ${fmtInteger(r.minEntryMxnp)} MXNP.`,
    `Cada usuario puede tener hasta ${fmtInteger(r.maxSharesPerMarket)} acciones por mercado.`,
    'Empates: menos días inactivos, más mercados distintos liquidados y registro más antiguo.',
  ];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((text, idx) => (
        <div key={text} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: 11, alignItems: 'start' }}>
          <span style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,85,0,0.11)',
            border: '1px solid rgba(255,85,0,0.34)',
            color: 'var(--orange)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}>
            {idx + 1}
          </span>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55 }}>
            {text}
          </p>
        </div>
      ))}
    </div>
  );
}

function TournamentFaq({ lang, rules }) {
  const r = rules || DEFAULT_RULES;
  const rows = lang === 'en' ? [
    [
      'What does PnL mean?',
      'PnL means profit or loss. If you buy an outcome and its price rises, your PnL goes up; if it falls, your PnL goes down. The tournament uses that market result, not signup or referral bonuses.',
    ],
    [
      'Do bonuses count toward winning?',
      'Not directly. Bonuses give you MXNP to play with, but the leaderboard is scored by market performance. They simply give you more chances to participate.',
    ],
    [
      'What do I need to qualify?',
      `You need entries in ${fmtInteger(r.qualifyingMarkets)} distinct markets, with at least ${fmtInteger(r.minEntryMxnp)} MXNP per entry.`,
    ],
  ] : [
    [
      '¿Qué significa PnL?',
      'PnL significa ganancia o pérdida. Si compras una opción y su precio sube, tu PnL sube; si baja, tu PnL baja. El torneo usa ese resultado de tus mercados, no los bonos que recibiste.',
    ],
    [
      '¿Los bonos cuentan para ganar el torneo?',
      'No directamente. Los bonos te dan MXNP para jugar, pero el ranking se calcula por desempeño en mercados. Sirven para que tengas más oportunidades de participar.',
    ],
    [
      '¿Qué necesito para calificar?',
      `Necesitas participar en ${fmtInteger(r.qualifyingMarkets)} mercados distintos, con entradas de al menos ${fmtInteger(r.minEntryMxnp)} MXNP.`,
    ],
  ];
  return (
    <div style={{
      marginTop: 20,
      paddingTop: 18,
      borderTop: '1px solid var(--border)',
      display: 'grid',
      gap: 14,
    }}>
      <SectionLabel>{lang === 'en' ? 'FAQ' : 'Preguntas frecuentes'}</SectionLabel>
      {rows.map(([question, answer]) => (
        <div key={question} style={{ display: 'grid', gap: 5 }}>
          <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
            {question}
          </strong>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55 }}>
            {answer}
          </p>
        </div>
      ))}
    </div>
  );
}

function RewardList({ lang, rules }) {
  const rewards = rules?.rewards || DEFAULT_RULES.rewards;
  const rows = lang === 'en' ? [
    ['Daily claim', `${fmtInteger(rewards.dailyBase)} MXNP + ${fmtInteger(rewards.dailyStep)} per streak day, max ${fmtInteger(rewards.dailyMax)}`],
    ['Referrals', `${fmtInteger(rewards.referrerReward)} MXNP to inviter, max ${fmtInteger(rewards.referralCycleCap)} per cycle`],
    ['New referred user', `${fmtInteger(rewards.referredReward)} MXNP`],
    ['Rescue top-up', `Up to ${fmtInteger(rewards.rescueFloor)} MXNP, max ${fmtInteger(rewards.rescueMaxClaims)} times per cycle`],
  ] : [
    ['Reclamo diario', `${fmtInteger(rewards.dailyBase)} MXNP + ${fmtInteger(rewards.dailyStep)} por día de racha, máximo ${fmtInteger(rewards.dailyMax)}`],
    ['Referidos', `${fmtInteger(rewards.referrerReward)} MXNP para quien invita, máximo ${fmtInteger(rewards.referralCycleCap)} por ciclo`],
    ['Usuario referido', `${fmtInteger(rewards.referredReward)} MXNP`],
    ['Rescate de saldo', `Hasta ${fmtInteger(rewards.rescueFloor)} MXNP, máximo ${fmtInteger(rewards.rescueMaxClaims)} veces por ciclo`],
  ];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 0.8fr) minmax(0, 1.2fr)',
          gap: 12,
          alignItems: 'baseline',
          borderBottom: '1px solid var(--border)',
          paddingBottom: 9,
        }}>
          <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13 }}>
            {label}
          </span>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.45 }}>
            {value}
          </span>
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
    const id = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rules = leaderboard?.rules || cycle?.rules || DEFAULT_RULES;
  const countdownTarget = targetForCycle(cycle);
  const countdown = useMemo(() => {
    if (!countdownTarget?.iso || cycle?.status === 'closed') return statusCopy(cycle?.status || 'scheduled', lang);
    const seconds = Math.max(0, Math.floor((new Date(countdownTarget.iso).getTime() - Date.now()) / 1000));
    return formatCountdown(seconds, lang);
  }, [countdownTarget?.iso, cycle?.status, lang, tick]);

  const top = Array.isArray(leaderboard?.top) ? leaderboard.top : [];
  const cycles = Array.isArray(history) ? history : [];
  const status = cycle?.status || 'scheduled';
  const me = leaderboard?.me || null;
  const qualifiedCount = top.filter(row => row.qualified).length;
  const prizeRows = Array.isArray(rules.prizes) && rules.prizes.length > 0
    ? rules.prizes
    : DEFAULT_RULES.prizes;
  const prizePool = prizeRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return (
    <main style={{
      maxWidth: 1160,
      margin: '0 auto',
      padding: 'clamp(28px, 5vw, 56px) clamp(16px, 4vw, 28px)',
    }}>
      <section style={{ marginBottom: 22 }}>
        <SectionLabel>{lang === 'en' ? 'Pronos tournament' : 'Torneo Pronos'}</SectionLabel>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(30px, 4.2vw, 52px)',
          lineHeight: 1.03,
          color: 'var(--text-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.01em',
          margin: 0,
        }}>
          {lang === 'en' ? 'The next cycle starts soon' : 'El próximo ciclo empieza pronto'}
        </h1>
        <p style={{
          maxWidth: 760,
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
          fontSize: 'clamp(15px, 1.5vw, 17px)',
          lineHeight: 1.55,
          margin: '14px 0 0',
        }}>
          {lang === 'en'
            ? 'Everyone starts from the same base. The leaderboard rewards real market performance, not passive bonuses: score comes from market PnL, adjusted by a small inactivity penalty.'
            : 'Todos arrancan desde la misma base. El leaderboard premia desempeño real en mercados, no bonos pasivos: el puntaje sale del PnL de mercados, ajustado por una penalización pequeña de inactividad.'}
        </p>
      </section>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.28fr) minmax(300px, 0.72fr)',
        gap: 18,
        marginBottom: 18,
      }}>
        <TournamentCard>
          <SectionLabel>{cycle?.label || (lang === 'en' ? 'Current cycle' : 'Ciclo actual')}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Metric
              label={lang === 'en' ? 'Status' : 'Estado'}
              value={statusCopy(status, lang)}
              tone={status === 'active' ? 'green' : 'orange'}
              sub={cycle?.startsAt ? new Date(cycle.startsAt).toLocaleString(lang === 'en' ? 'en-US' : 'es-MX', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }) : null}
            />
            <Metric
              label={countdownTarget?.label?.[lang] || (lang === 'en' ? 'Countdown' : 'Cuenta regresiva')}
              value={countdown}
              tone="orange"
              sub={lang === 'en' ? 'Mexico City time' : 'Hora Ciudad de México'}
            />
            <Metric
              label={lang === 'en' ? 'Prize pool' : 'Bolsa'}
              value={`$${fmtInteger(prizePool)} MXN`}
              tone="green"
              sub={lang === 'en' ? 'Top 5 winners' : 'Top 5 lugares'}
            />
          </div>
        </TournamentCard>

        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Cash prizes' : 'Premios en efectivo'}</SectionLabel>
          <PrizeRows rules={rules} />
        </TournamentCard>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.92fr) minmax(0, 1.08fr)',
        gap: 18,
        marginBottom: 18,
      }}>
        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Rules' : 'Reglas'}</SectionLabel>
          <RuleList lang={lang} rules={rules} />
          <TournamentFaq lang={lang} rules={rules} />
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
                <LeaderboardRow key={row.username} row={row} currentUsername={user?.username} rules={rules} compact={isMobile} lang={lang} />
              ))}
              {me && me.rank > top.length && (
                <div style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: '1px dashed var(--border)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--green)',
                  fontSize: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                }}>
                  <span>{lang === 'en' ? 'Your place' : 'Tu posición'}: {me.rank || '-'}</span>
                  <strong>{Number(me.score || 0) >= 0 ? '+' : ''}{fmt(me.score)} MXNP</strong>
                </div>
              )}
            </div>
          )}
        </TournamentCard>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 0.8fr) minmax(0, 1.2fr)',
        gap: 18,
        marginBottom: 18,
      }}>
        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Cycle rewards' : 'Bonos del ciclo'}</SectionLabel>
          <RewardList lang={lang} rules={rules} />
        </TournamentCard>

        <TournamentCard>
          <SectionLabel>{lang === 'en' ? 'Tournament snapshot' : 'Resumen del torneo'}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <Metric
              label={lang === 'en' ? 'Participants' : 'Participantes'}
              value={fmtInteger(leaderboard?.totalParticipants || 0)}
              sub={lang === 'en' ? 'with account balance' : 'con balance registrado'}
            />
            <Metric
              label={lang === 'en' ? 'Qualified in top 10' : 'Califican en top 10'}
              value={fmtInteger(qualifiedCount)}
              sub={`${fmtInteger(rules.qualifyingMarkets)} ${lang === 'en' ? 'markets minimum' : 'mercados mínimo'}`}
            />
            <Metric
              label={lang === 'en' ? 'Start balance' : 'Balance inicial'}
              value={`${fmtInteger(rules.startingBalance)} MXNP`}
              sub={lang === 'en' ? 'same for everyone' : 'igual para todos'}
            />
          </div>
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
                  <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 15 }}>
                    {cycleRow.label || `Ciclo #${cycleRow.id}`}
                  </strong>
                  {cycleRow.closedAt && (
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {new Date(cycleRow.closedAt).toLocaleDateString(lang === 'en' ? 'en-US' : 'es-MX')}
                    </span>
                  )}
                </div>
                {(cycleRow.top || []).slice(0, 10).map(row => (
                  <LeaderboardRow key={`${cycleRow.id}-${row.username}`} row={row} currentUsername={user?.username} rules={rules} compact={isMobile} lang={lang} />
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
  fontSize: 9,
  letterSpacing: '0.11em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 7,
};

const metricValue = {
  fontFamily: 'var(--font-display)',
  fontSize: 'clamp(18px, 2vw, 25px)',
  color: 'var(--text-primary)',
  textTransform: 'uppercase',
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
};

const metricSub = {
  marginTop: 6,
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: 1.45,
};

const emptyText = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: 1.6,
};
