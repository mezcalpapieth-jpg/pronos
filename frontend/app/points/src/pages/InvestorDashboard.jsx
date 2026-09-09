import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  deckLogin,
  deckLogout,
  fetchDeckSession,
  fetchInvestorDashboard,
  trackInvestorEvent,
} from '../lib/pointsApi.js';

const ACCENT = '#ff5a1f';
const GREEN = '#22c55e';
const YELLOW = '#f8c04e';
const RED = '#ef4444';
const BLUE = '#60a5fa';

const CATEGORY_LABELS = {
  general: 'General',
  mexico: 'Mexico & LatAm',
  politica: 'Politics',
  deportes: 'Sports',
  finanzas: 'Finance',
  entretenimiento: 'Entertainment',
  noticias: 'News',
  infraestructura: 'Infrastructure',
};

function withTimeout(promise, ms, label = 'timeout') {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(label)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function formatInt(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatCompact(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatMoney(value, { compact = false } = {}) {
  const formatter = new Intl.NumberFormat('en-US', compact ? {
    notation: 'compact',
    maximumFractionDigits: 1,
  } : {
    maximumFractionDigits: 0,
  });
  return `${formatter.format(Number(value || 0))} MXNP`;
}

function formatPct(value) {
  const n = Number(value || 0);
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: n < 10 ? 1 : 0 }).format(n)}%`;
}

function formatDateTime(value) {
  if (!value) return 'No activity';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'No activity';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatShortDate(value) {
  if (!value) return '-';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function labelFromSlug(value) {
  const key = String(value || '').trim().toLowerCase();
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return key
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'General';
}

function statusTone(value) {
  const n = Number(value || 0);
  if (n <= 0) return GREEN;
  if (n <= 3) return YELLOW;
  return RED;
}

function kindLabel(value) {
  return labelFromSlug(value);
}

function useInvestorDashboard() {
  const [session, setSession] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  async function loadDashboard({ quiet = false } = {}) {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await withTimeout(fetchInvestorDashboard(), 9000, 'investor_dashboard_timeout');
      setDashboard(data);
    } catch (e) {
      if (e?.status === 401 || e?.code === 'investor_session_required') {
        setSession(null);
        setDashboard(null);
      } else {
        setError('Dashboard metrics are temporarily unavailable.');
      }
    } finally {
      if (quiet) setRefreshing(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await withTimeout(fetchDeckSession(), 2500, 'deck_session_timeout');
        if (cancelled) return;
        setSession(data.session);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session) return;
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  return {
    session,
    dashboard,
    loading,
    refreshing,
    error,
    setSession,
    setDashboard,
    setError,
    loadDashboard,
  };
}

function useInvestorPageTracking(session) {
  const sessionRef = useRef(session);
  const enteredAtRef = useRef(Date.now());

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  function flushTracking(eventType = 'heartbeat', keepalive = false) {
    if (!sessionRef.current) return;
    const now = Date.now();
    const durationMs = Math.max(0, now - (enteredAtRef.current || now));
    enteredAtRef.current = now;
    trackInvestorEvent({
      pageKey: 'investor_dashboard',
      eventType,
      durationMs,
      keepalive,
    }).catch(() => {});
  }

  useEffect(() => {
    if (!session?.id) return undefined;
    enteredAtRef.current = Date.now();
    trackInvestorEvent({
      pageKey: 'investor_dashboard',
      eventType: 'page_view',
      durationMs: 0,
    }).catch(() => {});

    const heartbeatId = window.setInterval(() => flushTracking('heartbeat'), 15_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushTracking('hidden', true);
      } else {
        enteredAtRef.current = Date.now();
      }
    };
    const handleBeforeUnload = () => flushTracking('exit', true);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(heartbeatId);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushTracking('hidden', true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  return flushTracking;
}

export default function InvestorDashboard() {
  const {
    session,
    dashboard,
    loading,
    refreshing,
    error,
    setSession,
    setDashboard,
    setError,
    loadDashboard,
  } = useInvestorDashboard();
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState(null);
  const flushTracking = useInvestorPageTracking(session);

  async function handleLogin(form) {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const data = await withTimeout(deckLogin({ ...form, language: 'en' }), 8000, 'deck_login_timeout');
      setSession(data.session);
    } catch (e) {
      setLoginError(e?.code === 'invalid_invite'
        ? 'Access code is invalid or revoked.'
        : 'We could not open the investor dashboard.');
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    flushTracking('exit', true);
    await deckLogout().catch(() => {});
    setSession(null);
    setDashboard(null);
    setError(null);
  }

  if (loading && !session) {
    return (
      <main style={styles.page}>
        <div style={styles.loading}>Loading investor dashboard...</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main style={styles.page}>
        <InvestorGate
          onSubmit={handleLogin}
          error={loginError}
          loading={loginBusy}
        />
      </main>
    );
  }

  return (
    <main style={styles.page}>
      <DashboardHeader
        session={session}
        dashboard={dashboard}
        refreshing={refreshing}
        onRefresh={() => loadDashboard({ quiet: true })}
        onLogout={handleLogout}
      />
      {error && <div style={styles.errorBox}>{error}</div>}
      {!dashboard ? (
        <div style={styles.loading}>{error ? 'No dashboard data loaded.' : 'Loading metrics...'}</div>
      ) : (
        <InvestorMetrics dashboard={dashboard} />
      )}
    </main>
  );
}

function InvestorGate({ onSubmit, error, loading }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  return (
    <section style={styles.gateShell}>
      <div style={styles.gatePanel}>
        <div style={styles.kicker}>PRONOS · PRIVATE ACCESS</div>
        <h1 style={styles.gateTitle}>Investor Dashboard</h1>
        <p style={styles.gateCopy}>
          Use your investor access code to view aggregate Pronos traction, liquidity, and market engine metrics.
        </p>
        <form
          style={styles.gateForm}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ email, code });
          }}
        >
          <label style={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              placeholder="name@company.com"
              required
            />
          </label>
          <label style={styles.label}>
            Code
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={styles.input}
              placeholder="Access code"
              required
            />
          </label>
          <button type="submit" style={styles.primaryButton} disabled={loading}>
            Open dashboard
          </button>
          {error && <div style={styles.errorBox}>{error}</div>}
        </form>
      </div>
    </section>
  );
}

function DashboardHeader({ session, dashboard, refreshing, onRefresh, onLogout }) {
  return (
    <section style={styles.header}>
      <div>
        <div style={styles.kicker}>PRONOS · INVESTORS</div>
        <h1 style={styles.title}>Investor Dashboard</h1>
        <p style={styles.subtitle}>
          Aggregate product metrics for traction, liquidity, market coverage, and operational quality.
        </p>
        <div style={styles.headerMeta}>
          <span>{session.inviteLabel || 'Investor'}</span>
          <span>Updated {formatDateTime(dashboard?.generatedAt)}</span>
        </div>
      </div>
      <div style={styles.headerActions}>
        <a href="/deck" style={styles.secondaryLink}>Open deck</a>
        <button type="button" onClick={onRefresh} disabled={refreshing} style={styles.secondaryButton}>
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
        <button type="button" onClick={onLogout} style={styles.secondaryButton}>Sign out</button>
      </div>
    </section>
  );
}

function InvestorMetrics({ dashboard }) {
  const summary = dashboard?.summary || {};
  const traction = dashboard?.traction || {};
  const liquidity = dashboard?.liquidity || {};
  const marketEngine = dashboard?.marketEngine || {};
  const daily = traction.daily || [];
  const categories = liquidity.categories || [];
  const cohorts = traction.cohorts || [];
  const publicity = traction.publicity || [];
  const topMarkets = liquidity.topMarkets || [];
  const distributions = liquidity.distributions30d || [];
  const parlays = liquidity.parlays30d || {};
  const siteTime = traction.siteTime || {};

  const kpis = useMemo(() => ([
    {
      label: 'Users',
      value: formatInt(summary.usersTotal),
      sub: `+${formatInt(summary.users30d)} in 30d`,
      color: ACCENT,
    },
    {
      label: '30d traders',
      value: formatInt(summary.traders30d),
      sub: `${formatInt(summary.traders7d)} in 7d`,
      color: GREEN,
    },
    {
      label: '30d user volume',
      value: formatMoney(summary.grossFlow30d, { compact: true }),
      sub: `${formatMoney(summary.buyVolume30d, { compact: true })} buys`,
      color: BLUE,
    },
    {
      label: 'Markets traded',
      value: formatInt(summary.tradedMarkets30d),
      sub: `${formatInt(summary.marketsCreated30d)} created in 30d`,
      color: YELLOW,
    },
    {
      label: 'Auto resolution',
      value: formatPct(summary.autoResolutionRate30d),
      sub: `${formatInt(summary.autoResolved30d)} of ${formatInt(summary.resolved30d)} resolved`,
      color: GREEN,
    },
    {
      label: 'Past-deadline active',
      value: formatInt(summary.overdueMarkets),
      sub: 'markets needing attention',
      color: statusTone(summary.overdueMarkets),
    },
  ]), [summary]);

  return (
    <>
      <section style={styles.metricGrid}>
        {kpis.map(item => <MetricCard key={item.label} {...item} />)}
      </section>

      <section style={styles.section}>
        <SectionTitle eyebrow="TRACTION" title="30-day trading activity" />
        <ActivityChart rows={daily} />
      </section>

      <section style={styles.twoColumn}>
        <div style={styles.section}>
          <SectionTitle eyebrow="RETENTION" title="Signup cohorts" />
          <CohortTable rows={cohorts} />
        </div>
        <div style={styles.section}>
          <SectionTitle eyebrow="ACQUISITION" title="Attribution mix" />
          <PublicityTable rows={publicity} />
        </div>
      </section>

      <section style={styles.twoColumn}>
        <div style={styles.section}>
          <SectionTitle eyebrow="LIQUIDITY" title="Category mix" />
          <CategoryTable rows={categories} />
        </div>
        <div style={styles.section}>
          <SectionTitle eyebrow="ENGAGEMENT" title="App attention" />
          <div style={styles.statCluster}>
            <MetricCard
              compact
              label="30d app time"
              value={`${formatCompact(siteTime.totalHours30d)} h`}
              sub={`${formatInt(siteTime.activeUsers30d)} active users`}
              color={BLUE}
            />
            <MetricCard
              compact
              label="Daily avg"
              value={`${formatCompact(siteTime.avgDailyMinutesPerUser)} min`}
              sub={`Last seen ${formatDateTime(siteTime.lastSeenAt)}`}
              color={ACCENT}
            />
            <MetricCard
              compact
              label="Combo slips"
              value={formatInt(parlays.tickets)}
              sub={`${formatMoney(parlays.stake, { compact: true })} stake in 30d`}
              color={GREEN}
            />
          </div>
        </div>
      </section>

      <section style={styles.section}>
        <SectionTitle eyebrow="MARKET ENGINE" title="Coverage and resolution quality" />
        <EngineGrid data={marketEngine} />
      </section>

      <section style={styles.twoColumnWide}>
        <div style={styles.section}>
          <SectionTitle eyebrow="TOP MARKETS" title="Largest 30d volume" />
          <TopMarketsTable rows={topMarkets} />
        </div>
        <div style={styles.section}>
          <SectionTitle eyebrow="BALANCE FLOWS" title="Rewards and refunds" />
          <DistributionTable rows={distributions} />
        </div>
      </section>
    </>
  );
}

function MetricCard({ label, value, sub, color = ACCENT, compact = false }) {
  return (
    <article style={compact ? { ...styles.metricCard, ...styles.metricCardCompact } : styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={{ ...styles.metricValue, color }}>{value}</div>
      <div style={styles.metricSub}>{sub}</div>
    </article>
  );
}

function SectionTitle({ eyebrow, title }) {
  return (
    <div style={styles.sectionTitleRow}>
      <div>
        <div style={styles.kicker}>{eyebrow}</div>
        <h2 style={styles.sectionTitle}>{title}</h2>
      </div>
    </div>
  );
}

function ActivityChart({ rows }) {
  const max = Math.max(1, ...rows.map(row => Number(row.grossFlow || 0)));
  const last = rows[rows.length - 1] || {};
  return (
    <div>
      <div style={styles.chartMeta}>
        <span>{formatMoney(last.grossFlow, { compact: true })} today</span>
        <span>{formatInt(last.fills)} fills · {formatInt(last.traders)} traders</span>
      </div>
      <div style={styles.barChart} aria-label="30-day user trading volume">
        {rows.map(row => {
          const height = Math.max(4, (Number(row.grossFlow || 0) / max) * 100);
          return (
            <div key={row.day} style={styles.barSlot} title={`${formatShortDate(row.day)} · ${formatMoney(row.grossFlow)}`}>
              <div style={{ ...styles.bar, height: `${height}%` }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CohortTable({ rows }) {
  if (!rows.length) return <EmptyState text="No signup cohorts yet." />;
  return (
    <Table
      columns={['Week', 'Signups', 'W0', 'W1', 'W2', 'W3']}
      rows={rows.map(row => [
        formatShortDate(row.week),
        formatInt(row.signups),
        formatPct(row.retentionWeek0),
        formatPct(row.retentionWeek1),
        formatPct(row.retentionWeek2),
        formatPct(row.retentionWeek3),
      ])}
    />
  );
}

function PublicityTable({ rows }) {
  if (!rows.length) return <EmptyState text="No attribution rows yet." />;
  return (
    <Table
      columns={['Source', 'Visits', 'Unique', 'Conv.', 'Rate']}
      rows={rows.map(row => [
        labelFromSlug(row.source),
        formatInt(row.visits),
        formatInt(row.uniqueVisitors),
        formatInt(row.conversions),
        formatPct(row.conversionRate),
      ])}
    />
  );
}

function CategoryTable({ rows }) {
  if (!rows.length) return <EmptyState text="No 30-day category volume yet." />;
  return (
    <Table
      columns={['Category', 'Volume', 'Traders', 'Markets']}
      rows={rows.map(row => [
        labelFromSlug(row.category),
        formatMoney(row.grossFlow, { compact: true }),
        formatInt(row.traders),
        formatInt(row.markets),
      ])}
    />
  );
}

function TopMarketsTable({ rows }) {
  if (!rows.length) return <EmptyState text="No market volume in the last 30 days." />;
  return (
    <div style={styles.marketList}>
      {rows.map(row => (
        <a key={row.id} href={`/market?id=${row.id}`} style={styles.marketRow}>
          <span style={styles.marketQuestion}>{row.question}</span>
          <span style={styles.marketMeta}>
            {formatMoney(row.grossFlow, { compact: true })} · {formatInt(row.traders)} traders · {labelFromSlug(row.category)}
          </span>
        </a>
      ))}
    </div>
  );
}

function DistributionTable({ rows }) {
  if (!rows.length) return <EmptyState text="No balance movements in the last 30 days." />;
  return (
    <Table
      columns={['Kind', 'Total', 'Rows', 'Users']}
      rows={rows.map(row => [
        kindLabel(row.kind),
        formatMoney(row.total, { compact: true }),
        formatInt(row.count),
        formatInt(row.users),
      ])}
    />
  );
}

function EngineGrid({ data }) {
  const cells = [
    ['30d traded share', formatPct(data.tradedShare30d), `${formatInt(data.marketsTraded30d)} of ${formatInt(data.marketsCreated30d)} new markets`],
    ['Avg fills per market', formatCompact(data.avgFillsPerTradedMarket30d), '30d traded markets'],
    ['Avg traders per market', formatCompact(data.avgTradersPerTradedMarket30d), '30d traded markets'],
    ['Time to first trade', `${formatCompact(data.avgHoursToFirstTrade30d)} h`, 'avg on new markets'],
    ['Resolution delay', `${formatCompact(data.avgResolutionDelayHours30d)} h`, 'avg after deadline'],
    ['Corrections', formatInt(data.corrections30d), 'last 30 days'],
  ];
  return (
    <div style={styles.engineGrid}>
      {cells.map(([label, value, sub]) => (
        <MetricCard
          key={label}
          compact
          label={label}
          value={value}
          sub={sub}
          color={label === 'Corrections' ? statusTone(data.corrections30d) : ACCENT}
        />
      ))}
    </div>
  );
}

function Table({ columns, rows }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column} style={styles.th}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {row.map((cell, cellIdx) => (
                <td key={`${idx}-${cellIdx}`} style={cellIdx === 0 ? styles.tdPrimary : styles.td}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }) {
  return <div style={styles.empty}>{text}</div>;
}

const styles = {
  page: {
    minHeight: '100vh',
    maxWidth: 1320,
    margin: '0 auto',
    padding: 'clamp(22px, 4vw, 52px) clamp(14px, 4vw, 28px) 72px',
    color: 'var(--text-primary)',
  },
  loading: {
    padding: 80,
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  gateShell: {
    minHeight: 'calc(100vh - 220px)',
    display: 'grid',
    placeItems: 'center',
  },
  gatePanel: {
    width: 'min(560px, 100%)',
    background: 'rgba(255,255,255,0.035)',
    border: '1px solid rgba(255,90,31,0.30)',
    borderRadius: 8,
    padding: 'clamp(22px, 5vw, 42px)',
    boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
  },
  kicker: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.14em',
    color: ACCENT,
    textTransform: 'uppercase',
  },
  gateTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(38px, 8vw, 64px)',
    lineHeight: 0.95,
    margin: '14px 0 14px',
    textTransform: 'uppercase',
  },
  gateCopy: {
    color: 'var(--text-muted)',
    fontSize: 16,
    lineHeight: 1.55,
    maxWidth: 480,
    marginBottom: 24,
  },
  gateForm: {
    display: 'grid',
    gap: 14,
    marginTop: 22,
  },
  label: {
    display: 'grid',
    gap: 8,
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.12em',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  input: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.045)',
    borderRadius: 8,
    padding: '14px 14px',
    color: 'var(--text-primary)',
    font: 'inherit',
    letterSpacing: 0,
    textTransform: 'none',
  },
  primaryButton: {
    border: '1px solid rgba(255,90,31,0.75)',
    background: ACCENT,
    color: '#090909',
    borderRadius: 8,
    padding: '13px 18px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  secondaryButton: {
    border: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.045)',
    color: 'var(--text-primary)',
    borderRadius: 8,
    padding: '11px 14px',
    cursor: 'pointer',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  secondaryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid rgba(255,90,31,0.55)',
    background: 'rgba(255,90,31,0.10)',
    color: ACCENT,
    borderRadius: 8,
    padding: '11px 14px',
    textDecoration: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  errorBox: {
    border: '1px solid rgba(239,68,68,0.45)',
    background: 'rgba(239,68,68,0.10)',
    color: '#ff8c8c',
    borderRadius: 8,
    padding: 12,
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 22,
    marginBottom: 24,
    flexWrap: 'wrap',
    paddingBottom: 22,
    borderBottom: '1px solid var(--border)',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(42px, 8vw, 76px)',
    lineHeight: 0.92,
    margin: '10px 0 8px',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: 'var(--text-muted)',
    margin: 0,
    fontSize: 16,
    lineHeight: 1.5,
    maxWidth: 680,
  },
  headerMeta: {
    display: 'flex',
    gap: 10,
    flexWrap: 'wrap',
    marginTop: 14,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  headerActions: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 176px), 1fr))',
    gap: 12,
    marginBottom: 30,
  },
  metricCard: {
    minHeight: 126,
    display: 'grid',
    alignContent: 'space-between',
    gap: 8,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 16,
    background: 'rgba(255,255,255,0.032)',
  },
  metricCardCompact: {
    minHeight: 104,
  },
  metricLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.12em',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  metricValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(28px, 4vw, 42px)',
    lineHeight: 0.95,
  },
  metricSub: {
    color: 'var(--text-muted)',
    fontSize: 13,
    lineHeight: 1.35,
  },
  section: {
    marginTop: 30,
    paddingTop: 22,
    borderTop: '1px solid var(--border)',
  },
  twoColumn: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 28,
  },
  twoColumnWide: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
    gap: 28,
  },
  sectionTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  sectionTitle: {
    margin: '8px 0 0',
    fontFamily: 'var(--font-display)',
    fontSize: 28,
    lineHeight: 1,
    textTransform: 'uppercase',
  },
  chartMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    flexWrap: 'wrap',
  },
  barChart: {
    height: 220,
    display: 'grid',
    gridTemplateColumns: 'repeat(30, minmax(4px, 1fr))',
    alignItems: 'end',
    gap: 5,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 12,
    background: 'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.018))',
  },
  barSlot: {
    height: '100%',
    display: 'flex',
    alignItems: 'flex-end',
    minWidth: 0,
  },
  bar: {
    width: '100%',
    minHeight: 4,
    borderRadius: 4,
    background: `linear-gradient(180deg, ${ACCENT}, rgba(255,90,31,0.28))`,
  },
  tableWrap: {
    width: '100%',
    overflowX: 'auto',
    borderTop: '1px solid var(--border)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: 440,
  },
  th: {
    padding: '10px 10px 10px 0',
    textAlign: 'left',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 10px 12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    color: 'var(--text-muted)',
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  tdPrimary: {
    padding: '12px 10px 12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    color: 'var(--text-primary)',
    fontSize: 14,
    minWidth: 120,
  },
  statCluster: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
    gap: 12,
  },
  engineGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    gap: 12,
  },
  marketList: {
    display: 'grid',
    borderTop: '1px solid var(--border)',
  },
  marketRow: {
    display: 'grid',
    gap: 5,
    padding: '13px 0',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    color: 'inherit',
    textDecoration: 'none',
  },
  marketQuestion: {
    color: 'var(--text-primary)',
    fontSize: 14,
    lineHeight: 1.35,
  },
  marketMeta: {
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  empty: {
    minHeight: 72,
    display: 'grid',
    placeItems: 'center',
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
  },
};
