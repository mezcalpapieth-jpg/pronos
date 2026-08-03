/**
 * Admin panel for the points-app.
 *
 * Admins can:
 *   - Create binary markets (question, category, outcomes, deadline, seed)
 *   - Resolve active markets by picking the winning outcome
 *   - View stats (users, MXNP supply, markets, recent distributions)
 *
 * Auth: the backend enforces `POINTS_ADMIN_USERNAMES`. The UI hides the
 * nav link for non-admins but the endpoints would 403 anyway.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeckAdminPanel from '../components/DeckAdminPanel.jsx';
import AdminInterestPanel from '@app/components/AdminInterestPanel.jsx';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import {
  getJson,
  postJson,
  adminListSocialTasks,
  adminReviewSocialTask,
  adminListTaskCounts,
  adminReviewResolutionCandidate,
  adminListCycles,
  adminRolloverCycle,
  adminPauseCycles,
  adminEditMarket,
  adminCancelMarket,
  adminListPendingMarkets,
  adminReviewPendingMarket,
  adminEditPendingMarket,
  adminRefreshPendingPricing,
  adminRefreshAllPendingPricing,
  adminListSupportTickets,
  adminReplySupportTicket,
  adminSetSupportTicketStatus,
  adminApproveAllPendingMarkets,
  adminBackfillResolvers,
  adminResolveDiagnostic,
  adminRunAutoResolve,
  adminRunGenerators,
  adminToggleFeatured,
  adminProgressWorldCup,
} from '../lib/pointsApi.js';
import {
  ADMIN_BASEBALL_LEAGUES,
  ADMIN_COMBATE_LEAGUES,
  ADMIN_CRYPTO_FILTERS,
  ADMIN_GEO_FILTERS,
  ADMIN_MEXICO_TOPIC_FILTERS,
  ADMIN_SOCCER_LEAGUES,
  ADMIN_SPORT_FILTERS,
  CATEGORIES,
  MARKET_CREATION_GEO_OPTIONS,
  MARKET_CATEGORY_FILTERS,
  buildAdminMarketsQuery,
  formatAdminMarketDate,
} from '../lib/adminMarketFilters.js';

// ─── Date helpers (dd/mm/yyyy + HH:mm) ──────────────────────────────────────
// The native <input type="datetime-local"> defers format entirely to the
// browser locale, which lets en-US users see mm/dd/yyyy against our
// es-MX copy. Splitting into plain text inputs gives us consistent
// dd/mm/yyyy + HH:mm across browsers.
function parseDdMmYyyy(str) {
  const m = String(str || '').match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/);
  if (!m) return null;
  const day = Number(m[1]); const month = Number(m[2]); const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
}
function parseHhMm(str) {
  const m = String(str || '').match(/^\s*(\d{1,2}):(\d{2})\s*$/);
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return { h, min };
}
function partsToIso(dateStr, timeStr) {
  const d = parseDdMmYyyy(dateStr);
  const t = parseHhMm(timeStr);
  if (!d || !t) return null;
  // Build a Date in local time, then serialise as ISO (UTC). Matches what
  // datetime-local → new Date(val).toISOString() was doing before.
  const dt = new Date(d.year, d.month - 1, d.day, t.h, t.min, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}
function isoToDdMmYyyy(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join('/');
}
function isoToHhMm(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join(':');
}
function isoToHourPart(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getHours()).padStart(2, '0');
}
function isoToMinutePart(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return String(d.getMinutes()).padStart(2, '0');
}

// Compose `${HH}:${mm}` for partsToIso when the pieces come from two
// separate number inputs. Tolerates single-digit input ('9' → '09').
function composeHhMm(hourStr, minuteStr) {
  if (String(hourStr ?? '').trim() === '' || String(minuteStr ?? '').trim() === '') return null;
  const h = Number(hourStr);
  const m = Number(minuteStr);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Label the user's current timezone so it's explicit which wall-clock
// moment they're asking for. Example: "America/Mexico_City · UTC-06:00".
function currentTimezoneLabel() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
    const offsetMin = -new Date().getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const hh = String(Math.floor(absMin / 60)).padStart(2, '0');
    const mm = String(absMin % 60).padStart(2, '0');
    return `${tz} · UTC${sign}${hh}:${mm}`;
  } catch {
    return 'hora local';
  }
}

function pendingSuggestedPricing(row) {
  return row?.suggestedPricing || row?.sourceData?.suggestedPricing || null;
}

function formatSuggestedPricing(row) {
  const pricing = pendingSuggestedPricing(row);
  const outcomes = Array.isArray(row?.outcomes) ? row.outcomes : [];
  const pct = Array.isArray(pricing?.probabilityPct) ? pricing.probabilityPct : [];
  if (!outcomes.length || pct.length !== outcomes.length) return null;
  return outcomes
    .map((outcome, i) => `${outcome} ${Number(pct[i]).toLocaleString('es-MX', { maximumFractionDigits: 1 })}%`)
    .join(' · ');
}

function formatSuggestedPricingSource(pricing) {
  if (!pricing?.source) return 'fuente no especificada';
  if (pricing.source === 'uniform-default') return 'balanceado';
  if (pricing.source === 'admin-config') return 'config admin';
  if (pricing.source === 'the-odds-api:h2h') return 'The Odds API';
  if (String(pricing.source).startsWith('polymarket:')) return 'Polymarket';
  if (String(pricing.source).startsWith('source-signals:')) return 'señales de fuente';
  return pricing.source;
}

export default function PointsAdmin({ isAdmin }) {
  // Read initial tab + create-form prefill from query string. Lets
  // /c/noticias' "Crear mercado de esta noticia" deep-link into the
  // create form with question + category pre-filled.
  const initialTab = (() => {
    if (typeof window === 'undefined') return 'create';
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get('tab');
    return ['create', 'markets', 'stats', 'pending', 'social', 'support', 'deck', 'cycles'].includes(t) ? t : 'create';
  })();
  const createPrefill = (() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const q = sp.get('question');
    if (!q) return null;
    return {
      question: q.slice(0, 200),
      category: (sp.get('category') || '').slice(0, 32) || null,
    };
  })();
  const navigate = useNavigate();
  const { authenticated, user, loading: authLoading } = usePointsAuth();
  const [tab, setTab] = useState(initialTab); // 'create' | 'markets' | 'stats'
  const [adminTaskCounts, setAdminTaskCounts] = useState({ pending: 0, markets: 0, social: 0, support: 0 });
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);

  function refreshAdminTaskCounts() {
    setTaskRefreshKey(k => k + 1);
  }

  useEffect(() => {
    if (authLoading) return;
    if (!authenticated) {
      navigate('/');
    }
  }, [authLoading, authenticated, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function loadAdminTaskCounts() {
      if (!authenticated || !isAdmin) {
        if (!cancelled) setAdminTaskCounts({ pending: 0, markets: 0, social: 0, support: 0 });
        return;
      }

      const counts = await adminListTaskCounts();

      if (cancelled) return;
      setAdminTaskCounts(counts);
    }

    loadAdminTaskCounts();
    return () => { cancelled = true; };
  }, [authenticated, isAdmin, tab, taskRefreshKey]);

  if (!authenticated) return null;
  if (!isAdmin) {
    return (
      <main style={{ padding: '100px 48px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        <p style={{ color: 'var(--text-muted)' }}>No tienes acceso de admin.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1160, margin: '0 auto', padding: 'clamp(24px, 5vw, 60px) clamp(14px, 4vw, 24px)' }}>
      <h1 style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'clamp(32px, 5vw, 52px)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--text-primary)',
        marginBottom: 8,
      }}>
        Admin
      </h1>
      <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13, marginBottom: 24 }}>
        Gestiona mercados y premios del app de puntos.
      </p>

      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {[
          { id: 'create',  label: 'Crear mercado' },
          { id: 'pending', label: 'Por aprobar' },
          { id: 'markets', label: 'Mercados' },
          { id: 'support', label: 'Soporte' },
          { id: 'social',  label: 'Tareas sociales' },
          { id: 'deck',    label: 'Deck' },
          { id: 'cycles',  label: 'Ciclos' },
          { id: 'stats',   label: 'Estadísticas' },
        ].map(t => {
          const active = tab === t.id;
          const taskCount = adminTaskCounts[t.id] || 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none', border: 'none', padding: '10px 18px',
                fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: `2px solid ${active ? 'var(--green)' : 'transparent'}`,
                cursor: 'pointer', marginBottom: -1,
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              {t.label}
              {tab !== t.id && taskCount > 0 && (
                <span style={{
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(245,158,11,0.16)',
                  border: '1px solid rgba(245,158,11,0.45)',
                  color: '#f59e0b',
                  fontSize: 10,
                  letterSpacing: 0,
                  lineHeight: 1,
                }}>
                  {taskCount > 99 ? '99+' : taskCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'create' && <CreateMarketForm prefill={createPrefill} />}
      {tab === 'pending' && <PendingMarketsTable onQueueChange={refreshAdminTaskCounts} />}
      {tab === 'markets' && (
        <MarketsTable
          onQueueChange={refreshAdminTaskCounts}
          pendingResolveCount={adminTaskCounts.markets}
        />
      )}
      {tab === 'social' && <SocialTasksQueue onQueueChange={refreshAdminTaskCounts} />}
      {tab === 'support' && <SupportTicketsQueue onQueueChange={refreshAdminTaskCounts} />}
      {tab === 'deck' && <DeckAdminPanel />}
      {tab === 'cycles' && <CyclesPanel />}
      {tab === 'stats' && <StatsPanel />}
    </main>
  );
}

// ─── Competition cycles ───────────────────────────────────────────────────
// Admin tool for pausing/restarting public prize cycles. Pause is
// non-destructive; restart/rollover is the deliberate action that snapshots,
// resets balances, and opens a fresh 14-day window.
function CyclesPanel() {
  const [data, setData] = useState(null);
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    setData(null);
    setErr(null);
    try {
      const r = await adminListCycles();
      setData(r);
    } catch (e) {
      setErr(e.code || e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function rollover() {
    // Double-confirm because this is destructive: it snapshots the
    // leaderboard AND resets every user's balance to 500 MXNP. Running
    // it too early means users lose late-cycle gains; running it late
    // leaves everyone staring at "cierre pendiente" for longer than
    // ideal.
    const ok = window.confirm(current
      ? '¿Cerrar el ciclo actual y abrir uno nuevo?\n\n' +
        '⚠️  Esto es DESTRUCTIVO:\n' +
        '1. Guarda un snapshot inmutable del top-100.\n' +
        '2. REINICIA el balance de TODOS los usuarios a 500 MXNP.\n' +
        '3. Abre un ciclo nuevo de 14 días.\n\n' +
        '¿Continuar?'
      : '¿Reanudar los ciclos y abrir un ciclo nuevo de 14 días?\n\n' +
        'No hay ciclo activo que cerrar, así que esto solo crea el nuevo ciclo.'
    );
    if (!ok) return;
    setWorking(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await adminRolloverCycle();
      if (r.restarted || !r.closedCycleId) {
        setMsg(`✓ Ciclos reanudados — ciclo #${r.newCycleId || r.newCycle?.id} abierto.`);
      } else {
        setMsg(
          `✓ Ciclo #${r.closedCycleId} cerrado — ${r.snapshotted} snapshots, ${r.resetCount || 0} balances reiniciados a 500 MXNP. ` +
          (r.winners?.[0] ? `🥇 ${r.winners[0].username} (${Math.round(r.winners[0].finalBalance)} MXNP)` : '')
        );
      }
      await load();
    } catch (e) {
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
    } finally {
      setWorking(false);
    }
  }

  async function pauseCycles() {
    const ok = window.confirm(
      '¿Pausar los ciclos públicos?\n\n' +
      'Esto NO reinicia balances ni cierra snapshots. Solo hace que la página muestre “Próximamente” hasta que reanudes con el botón de reinicio.'
    );
    if (!ok) return;
    setWorking(true);
    setMsg(null);
    setErr(null);
    try {
      await adminPauseCycles();
      setMsg('✓ Ciclos pausados — la página pública mostrará Próximamente.');
      await load();
    } catch (e) {
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
    } finally {
      setWorking(false);
    }
  }

  if (!data && !err) {
    return <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: 20 }}>Cargando ciclos…</div>;
  }

  const current = data?.current;
  const closed = data?.closed || [];
  const paused = data?.paused !== false;

  return (
    <div>
      <section style={{
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
          CICLO ACTIVO
        </div>
        {paused && (
          <div style={{
            padding: '10px 12px',
            marginBottom: 14,
            borderRadius: 10,
            border: '1px solid rgba(245,158,11,0.35)',
            background: 'rgba(245,158,11,0.08)',
            color: '#f59e0b',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.04em',
            lineHeight: 1.5,
          }}>
            Ciclos pausados en público. La home muestra “Próximamente” hasta que abras un ciclo nuevo.
          </div>
        )}
        {current ? (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 8 }}>
              {current.label || `Ciclo #${current.id}`}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Inicio: {new Date(current.startedAt).toLocaleString('es-MX')} ·
              Cierra: {new Date(current.endsAt).toLocaleString('es-MX')}
              {current.pastDeadline && <span style={{ color: '#f59e0b', marginLeft: 8 }}>⏳ DEADLINE PASADO</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={rollover}
                disabled={working}
                style={{
                  padding: '10px 18px',
                  background: current.pastDeadline || paused ? 'var(--green)' : 'var(--surface2)',
                  color: current.pastDeadline || paused ? '#000' : 'var(--text-primary)',
                  border: `1px solid ${current.pastDeadline || paused ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: working ? 'not-allowed' : 'pointer',
                }}
              >
                {working ? 'Trabajando…' : paused ? '▶ Reanudar con ciclo nuevo' : '▶ Cerrar ciclo y abrir siguiente'}
              </button>
              {!paused && (
                <button
                  onClick={pauseCycles}
                  disabled={working}
                  style={{
                    padding: '10px 18px',
                    background: 'transparent',
                    color: '#f59e0b',
                    border: '1px solid rgba(245,158,11,0.45)',
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    cursor: working ? 'not-allowed' : 'pointer',
                  }}
                >
                  Pausar ciclos
                </button>
              )}
            </div>
            {msg && <div style={{ marginTop: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{msg}</div>}
            {err && <div style={{ marginTop: 12, color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {err}</div>}
          </>
        ) : (
          <>
            <div style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
              No hay ciclo activo. La página pública se queda en “Próximamente” hasta que lo reanudes aquí.
            </div>
            <button
              onClick={rollover}
              disabled={working}
              style={{
                padding: '10px 18px',
                background: 'var(--green)',
                color: '#000',
                border: '1px solid var(--green)',
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: working ? 'not-allowed' : 'pointer',
              }}
            >
              {working ? 'Abriendo ciclo…' : '▶ Reanudar ciclos'}
            </button>
            {msg && <div style={{ marginTop: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{msg}</div>}
            {err && <div style={{ marginTop: 12, color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {err}</div>}
          </>
        )}
      </section>

      <section>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', marginBottom: 8 }}>
          CICLOS CERRADOS
        </div>
        {closed.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: 12 }}>
            Todavía no hay ciclos cerrados. El primer rollover creará el historial.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {closed.map(c => (
              <div key={c.id} style={{
                padding: '12px 16px',
                background: 'var(--surface1)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}>
                <span>
                  <strong>{c.label || `Ciclo #${c.id}`}</strong>
                  <span style={{ color: 'var(--text-muted)', marginLeft: 10 }}>
                    cerrado {new Date(c.closedAt).toLocaleDateString('es-MX')}
                  </span>
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {c.snapshotCount} snapshots
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Social tasks queue ────────────────────────────────────────────────────
function SocialTasksQueue({ onQueueChange }) {
  const [status, setStatus] = useState('pending');
  const [tasks, setTasks] = useState(null);
  const [working, setWorking] = useState(null); // id of the task being reviewed

  async function load() {
    setTasks(null);
    try {
      const r = await adminListSocialTasks(status);
      setTasks(r.tasks || []);
    } catch (e) {
      setTasks([]);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function review(id, action) {
    let note = null;
    if (action === 'reject') {
      // Browser-native prompt keeps the admin UI lean; swap for a proper
      // modal if we ever support bulk rejection with canned reasons.
      note = window.prompt('Motivo del rechazo (mostrado al usuario):');
      if (!note || !note.trim()) return;
    }
    setWorking(id);
    try {
      await adminReviewSocialTask(id, action, note);
      await load();
      onQueueChange?.();
    } catch (e) {
      alert(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'}: ${e.code || e.message}`);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'pending', label: 'Pendientes' },
          { id: 'approved', label: 'Aprobadas' },
          { id: 'rejected', label: 'Rechazadas' },
          { id: 'history', label: 'Historial' },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${status === s.id ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: status === s.id ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: status === s.id ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {tasks === null && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>
      )}
      {tasks && tasks.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Sin tareas en esta categoría.
        </p>
      )}
      {tasks && tasks.map(t => {
        const statusLabel = t.status === 'approved'
          ? 'Aprobada'
          : t.status === 'rejected'
            ? 'Rechazada'
            : 'Pendiente';
        return (
          <div key={t.id} style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                #{t.id} · @{t.username} · {t.task_key} · {statusLabel} · +{t.reward} MXNP
              </div>
              {t.proof_url && (
                <a
                  href={t.proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', textDecoration: 'underline' }}
                >
                  Ver prueba
                </a>
              )}
              {t.rejection_note && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red, #ef4444)', marginTop: 4 }}>
                  Rechazo: {t.rejection_note}
                </div>
              )}
            </div>
            {t.status === 'pending' ? (
              <>
                <button
                  onClick={() => review(t.id, 'approve')}
                  disabled={working === t.id}
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: 11 }}
                >
                  Aprobar
                </button>
                <button
                  onClick={() => review(t.id, 'reject')}
                  disabled={working === t.id}
                  className="btn-ghost"
                  style={{ padding: '6px 12px', fontSize: 11 }}
                >
                  Rechazar
                </button>
              </>
            ) : (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                Revisada por @{t.reviewer || 'admin'} · {t.reviewed_at ? new Date(t.reviewed_at).toLocaleDateString('es-MX') : 'sin fecha'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Support tickets queue ─────────────────────────────────────────────────
function SupportTicketsQueue({ onQueueChange }) {
  const [status, setStatus] = useState('open');
  const [tickets, setTickets] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    setTickets(null);
    setError(null);
    try {
      const r = await adminListSupportTickets(status);
      setTickets(Array.isArray(r.tickets) ? r.tickets : []);
    } catch (e) {
      setError(e.code || e.message);
      setTickets([]);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  function setDraft(id, value) {
    setDrafts(d => ({ ...d, [id]: value }));
  }

  async function reply(ticket) {
    const message = String(drafts[ticket.id] || '').trim();
    if (message.length < 2) return;
    setWorking(`reply-${ticket.id}`);
    try {
      await adminReplySupportTicket({ id: ticket.id, message });
      setDraft(ticket.id, '');
      await load();
      onQueueChange?.();
    } catch (e) {
      alert(`No se pudo responder: ${e.code || e.message}`);
    } finally {
      setWorking(null);
    }
  }

  async function setTicketStatus(ticket, nextStatus) {
    setWorking(`status-${ticket.id}`);
    try {
      await adminSetSupportTicketStatus({ id: ticket.id, status: nextStatus });
      await load();
      onQueueChange?.();
    } catch (e) {
      alert(`No se pudo actualizar el ticket: ${e.code || e.message}`);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'open', label: 'Abiertos' },
          { id: 'closed', label: 'Cerrados' },
          { id: 'all', label: 'Todos' },
        ].map(s => (
          <button
            key={s.id}
            onClick={() => setStatus(s.id)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${status === s.id ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: status === s.id ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: status === s.id ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              cursor: 'pointer',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <p style={{ color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Error: {error}
        </p>
      )}
      {tickets === null && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando tickets...</p>
      )}
      {tickets && tickets.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Sin tickets en esta categoría.
        </p>
      )}

      {tickets && tickets.map(ticket => {
        const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
        const isClosed = ticket.status === 'closed';
        return (
          <article
            key={ticket.id}
            style={{
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 18px',
              marginBottom: 14,
            }}
          >
            <header style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 14,
              alignItems: 'start',
              marginBottom: 14,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                  #{ticket.id} · @{ticket.username || 'usuario'} · {ticket.email || 'sin correo'} · {ticket.type || 'other'}
                </div>
                <h3 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)' }}>
                  {ticket.subject || 'Sin asunto'}
                </h3>
                <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                  Actualizado {ticket.updatedAt ? new Date(ticket.updatedAt).toLocaleString('es-MX') : 'sin fecha'}
                </div>
              </div>
              <span style={{
                justifySelf: 'end',
                padding: '5px 10px',
                borderRadius: 999,
                border: `1px solid ${isClosed ? 'var(--border)' : 'rgba(0,232,122,0.35)'}`,
                color: isClosed ? 'var(--text-muted)' : 'var(--green)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}>
                {isClosed ? 'Cerrado' : 'Abierto'}
              </span>
            </header>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginBottom: 14,
              maxHeight: 360,
              overflowY: 'auto',
              paddingRight: 4,
            }}>
              {messages.map(message => {
                const isAdminMessage = message.senderType === 'admin';
                return (
                  <div
                    key={message.id}
                    style={{
                      alignSelf: isAdminMessage ? 'flex-end' : 'flex-start',
                      maxWidth: '82%',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: isAdminMessage ? 'rgba(0,232,122,0.06)' : 'var(--surface2)',
                    }}
                  >
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      marginBottom: 5,
                    }}>
                      {isAdminMessage ? `Pronos · @${message.senderUsername || 'admin'}` : `Usuario · @${ticket.username || 'usuario'}`}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                      {message.body}
                    </div>
                    <div style={{
                      marginTop: 6,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 9,
                      color: 'var(--text-muted)',
                    }}>
                      <span>{message.createdAt ? new Date(message.createdAt).toLocaleString('es-MX') : 'sin fecha'}</span>
                      {isAdminMessage && <span>{message.emailed ? 'enviado por correo' : 'sin correo'}</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <textarea
              value={drafts[ticket.id] || ''}
              onChange={(e) => setDraft(ticket.id, e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Responder al usuario..."
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5, marginBottom: 10 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={working === `reply-${ticket.id}` || !String(drafts[ticket.id] || '').trim()}
                onClick={() => reply(ticket)}
                style={{ padding: '8px 14px', fontSize: 11 }}
              >
                Responder
              </button>
              {isClosed ? (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={working === `status-${ticket.id}`}
                  onClick={() => setTicketStatus(ticket, 'open')}
                  style={{ padding: '8px 14px', fontSize: 11 }}
                >
                  Reabrir
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={working === `status-${ticket.id}`}
                  onClick={() => setTicketStatus(ticket, 'closed')}
                  style={{ padding: '8px 14px', fontSize: 11 }}
                >
                  Cerrar
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ─── Create market form ──────────────────────────────────────────────────────
// Two mode axes:
//   - `mode`: Binario (N=2) or Múltiple (N=3..10) — controls the outcome editor.
//   - `ammMode`: Unificado (one pool, N-outcome CPMM) or Paralelo
//     (Polymarket-style: one binary Sí/No market per outcome grouped under
//     a parent row). Only meaningful for Múltiple; Binario is locked to
//     Unificado since the two modes are equivalent at N=2.
function CreateMarketForm({ prefill }) {
  const [mode, setMode] = useState('binary'); // 'binary' | 'multi'
  const [ammMode, setAmmMode] = useState('unified'); // 'unified' | 'parallel'
  // `prefill` arrives via deep-link (currently from the /c/noticias
  // "Crear mercado de esta noticia" button). Seeds question +
  // category so admin only fills outcomes / end time.
  const [form, setForm] = useState({
    question: prefill?.question || '',
    category: prefill?.category || 'deportes',
    geo: prefill?.geo || 'auto',
    endDate: '',   // dd/mm/yyyy (text)
    endHour: '',   // 0-23 (string, validated on submit)
    endMinute: '', // 0-59 (string, validated on submit)
    outcomes: ['Sí', 'No'],
    seedLiquidities: [500, 500],
  });
  const [state, setState] = useState({ submitting: false, msg: null, err: null });

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setForm(f => ({
      ...f,
      // Reset outcomes to a sane default for the chosen mode so users
      // don't accidentally submit leftover binary labels as a multi.
      outcomes: next === 'binary' ? ['Sí', 'No'] : ['', '', ''],
      seedLiquidities: next === 'binary' ? [500, 500] : [500, 500, 500],
    }));
  }

  function updateOutcome(idx, value) {
    setForm(f => {
      const next = [...f.outcomes];
      next[idx] = value;
      return { ...f, outcomes: next };
    });
  }

  function addOutcome() {
    setForm(f => {
      if (f.outcomes.length >= 10) return f;
      return { ...f, outcomes: [...f.outcomes, ''], seedLiquidities: [...f.seedLiquidities, 500] };
    });
  }

  function removeOutcome(idx) {
    setForm(f => {
      if (f.outcomes.length <= 2) return f;
      const next = f.outcomes.filter((_, i) => i !== idx);
      const nextLiquidities = f.seedLiquidities.filter((_, i) => i !== idx);
      return { ...f, outcomes: next, seedLiquidities: nextLiquidities };
    });
  }

  function updateOutcomeLiquidity(idx, value) {
    setForm(f => {
      const next = [...f.seedLiquidities];
      next[idx] = value;
      return { ...f, seedLiquidities: next };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Client-side guardrails so the user sees friendly errors before a
    // round-trip to the server. Server validates these again.
    const cleanedPairs = form.outcomes
      .map((outcome, i) => ({
        outcome: outcome.trim(),
        liquidity: form.seedLiquidities[i],
      }))
      .filter(p => p.outcome);
    const cleaned = cleanedPairs.map(p => p.outcome);
    const cleanedLiquidities = cleanedPairs.map(p => Number(p.liquidity));
    if (cleaned.length < 2) {
      setState({ submitting: false, msg: null, err: 'Al menos 2 opciones con nombre.' });
      return;
    }
    if (cleaned.length > 10) {
      setState({ submitting: false, msg: null, err: 'Máximo 10 opciones.' });
      return;
    }
    if (cleanedLiquidities.some(v => !Number.isFinite(v) || v < 100)) {
      setState({ submitting: false, msg: null, err: 'La liquidez de cada opción debe ser de al menos 100 MXNP.' });
      return;
    }
    const timeStr = composeHhMm(form.endHour, form.endMinute);
    if (!timeStr) {
      setState({ submitting: false, msg: null, err: 'Hora inválida. Horas 0–23, minutos 0–59.' });
      return;
    }
    const endIso = partsToIso(form.endDate, timeStr);
    if (!endIso) {
      setState({ submitting: false, msg: null, err: 'Fecha inválida. Formato: dd/mm/yyyy.' });
      return;
    }
    setState({ submitting: true, msg: null, err: null });
    // Binary markets are always unified (parallel = unified at N=2).
    const effectiveAmmMode = mode === 'binary' ? 'unified' : ammMode;
    try {
      const r = await postJson('/api/points/admin/create-market', {
        question: form.question,
        category: form.category,
        geo: form.geo === 'auto' ? null : form.geo,
        icon: null,
        endTime: endIso,
        outcomes: cleaned,
        seedLiquidity: cleanedLiquidities[0] || 500,
        seedLiquidities: cleanedLiquidities,
        ammMode: effectiveAmmMode,
      });
      const modeLabel = effectiveAmmMode === 'parallel' ? 'paralelo' : 'unificado';
      setState({
        submitting: false,
        msg: `Mercado creado (#${r.marketId}) · ${cleaned.length} opciones · ${modeLabel}`,
        err: null,
      });
      setForm(f => ({
        ...f,
        question: '',
        endDate: '',
        endHour: '',
        endMinute: '',
        outcomes: mode === 'binary' ? ['Sí', 'No'] : ['', '', ''],
        seedLiquidities: mode === 'binary' ? [500, 500] : [500, 500, 500],
      }));
    } catch (e) {
      setState({ submitting: false, msg: null, err: e.code || e.message });
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface1)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 28, maxWidth: 720,
    }}>
      {/* ── Mode toggle ──────────────────────────────────────
          Binary = classic Sí/No; Múltiple = N outcomes (e.g.
          "Quién gana la Liga MX?" with 18 teams). */}
      <Field label="Tipo de mercado">
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { key: 'binary', label: 'Binario (Sí / No)' },
            { key: 'multi',  label: 'Múltiple (3–10 opciones)' },
          ].map(m => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => switchMode(m.key)}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: active ? 'var(--surface3, rgba(0,232,122,0.12))' : 'var(--surface2)',
                  border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                  borderRadius: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--green)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Pregunta">
        <textarea
          value={form.question}
          onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
          rows={2}
          required
          placeholder={mode === 'binary'
            ? '¿Mexico gana el Mundial 2026?'
            : '¿Quién gana la Liga MX Apertura 2026?'}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Categoría">
          <select
            value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            style={inputStyle}
          >
            {CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Región">
          <select
            value={form.geo}
            onChange={e => setForm(f => ({ ...f, geo: e.target.value }))}
            style={inputStyle}
          >
            {[{ key: 'auto', label: 'Auto' }, ...MARKET_CREATION_GEO_OPTIONS].map(g => (
              <option key={g.key} value={g.key}>{g.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Fecha de cierre">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 8px 70px', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="dd/mm/yyyy"
            value={form.endDate}
            onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
            required
            style={inputStyle}
          />
          <input
            type="number"
            min={0}
            max={23}
            step={1}
            placeholder="HH"
            value={form.endHour}
            onChange={e => setForm(f => ({ ...f, endHour: e.target.value }))}
            required
            style={{ ...inputStyle, textAlign: 'center' }}
          />
          <span style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}>:</span>
          <input
            type="number"
            min={0}
            max={59}
            step={1}
            placeholder="mm"
            value={form.endMinute}
            onChange={e => setForm(f => ({ ...f, endMinute: e.target.value }))}
            required
            style={{ ...inputStyle, textAlign: 'center' }}
          />
        </div>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--text-muted)',
          margin: '6px 0 0',
          letterSpacing: '0.04em',
        }}>
          Horas 0–23, minutos 0–59. Se guarda en zona: <strong>{currentTimezoneLabel()}</strong>.
        </p>
      </Field>

      {/* ── AMM mode toggle (only meaningful for multi) ─────
          Unificado = one pool, prices sum to 100%.
          Paralelo  = one binary market per outcome (Polymarket-style),
                      each pool has its own deeper liquidity. */}
      {mode === 'multi' && (
        <Field label="Tipo de AMM">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { key: 'unified',  label: 'Unificado', hint: 'Un pool · precios suman 100%' },
              { key: 'parallel', label: 'Paralelo',  hint: 'Cada opción es un mercado binario Sí/No' },
            ].map(m => {
              const active = ammMode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setAmmMode(m.key)}
                  style={{
                    flex: 1,
                    padding: '12px 14px',
                    background: active ? 'var(--surface3, rgba(0,232,122,0.12))' : 'var(--surface2)',
                    border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                    borderRadius: 8,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: active ? 'var(--green)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    lineHeight: 1.5,
                  }}
                >
                  {m.label}
                  <div style={{
                    marginTop: 4,
                    fontSize: 9,
                    fontWeight: 400,
                    letterSpacing: '0.04em',
                    textTransform: 'none',
                    color: 'var(--text-muted)',
                  }}>
                    {m.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {/* ── Outcome editor ──────────────────────────────────
          Binary mode renders two side-by-side inputs, multi mode a
          vertical stack with add/remove buttons. Keyboard-friendly:
          focus stays on the new row after pressing "Agregar". */}
      <Field label={mode === 'binary' ? 'Opciones' : `Opciones (${form.outcomes.length})`}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {form.outcomes.map((val, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                width: 24,
                flexShrink: 0,
                letterSpacing: '0.06em',
              }}>
                {String.fromCharCode(65 + i)}
              </span>
              <input
                value={val}
                onChange={e => updateOutcome(i, e.target.value)}
                required
                placeholder={mode === 'binary'
                  ? (i === 0 ? 'Sí' : 'No')
                  : `Opción ${i + 1}`}
                style={{ ...inputStyle, flex: 1 }}
              />
              <input
                type="number"
                min="100"
                step="100"
                value={form.seedLiquidities[i] ?? 500}
                onChange={e => updateOutcomeLiquidity(i, e.target.value)}
                aria-label={`Liquidez opción ${i + 1}`}
                title="Liquidez inicial de esta opción"
                style={{
                  ...inputStyle,
                  width: 132,
                  flex: '0 0 132px',
                  fontFamily: 'var(--font-mono)',
                  textAlign: 'right',
                }}
              />
              {mode === 'multi' && form.outcomes.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeOutcome(i)}
                  aria-label={`Quitar opción ${i + 1}`}
                  style={{
                    padding: '8px 12px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {mode === 'multi' && form.outcomes.length < 10 && (
            <button
              type="button"
              onClick={addOutcome}
              style={{
                alignSelf: 'flex-start',
                padding: '8px 14px',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderRadius: 8,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              + Agregar opción
            </button>
          )}
        </div>
      </Field>

      {state.msg && (
        <div style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 12 }}>
          ✓ {state.msg}
        </div>
      )}
      {state.err && (
        <div style={{ color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 12 }}>
          Error: {state.err}
        </div>
      )}

      <button
        type="submit"
        disabled={state.submitting}
        className="btn-primary"
        style={{ padding: '12px 20px' }}
      >
        {state.submitting ? 'Creando…' : 'Crear mercado'}
      </button>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: 'var(--text-muted)', marginBottom: 6,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
};

// ─── Markets table ───────────────────────────────────────────────────────────
function MarketsTable({ onQueueChange, pendingResolveCount = 0 }) {
  const [markets, setMarkets] = useState(null);
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sportFilter, setSportFilter] = useState('all');
  const [leagueFilter, setLeagueFilter] = useState('all');
  const [cryptoTypeFilter, setCryptoTypeFilter] = useState('all');
  const [geoFilter, setGeoFilter] = useState('all');
  const [topicFilter, setTopicFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);
  const [reviewingCandidate, setReviewingCandidate] = useState(null);
  const [canceling, setCanceling] = useState(null);
  const [autoResolving, setAutoResolving] = useState(false);
  // When non-null, render the edit modal for this market.
  const [editing, setEditing] = useState(null);

  const showSportFilters = categoryFilter === 'deportes';
  const showCryptoFilters = categoryFilter === 'crypto';
  const showMexicoFilters = categoryFilter === 'mexico';
  const showLeagueFilters = showSportFilters
    && (sportFilter === 'soccer' || sportFilter === 'baseball' || sportFilter === 'combate');
  const activeLeagueFilters = sportFilter === 'baseball'
    ? ADMIN_BASEBALL_LEAGUES
    : sportFilter === 'combate'
      ? ADMIN_COMBATE_LEAGUES
      : ADMIN_SOCCER_LEAGUES;

  async function load() {
    setLoading(true);
    try {
      const q = buildAdminMarketsQuery({
        status: filter,
        categoryFilter,
        sportFilter,
        leagueFilter,
        cryptoTypeFilter,
        geoFilter,
        topicFilter,
      });
      const r = await getJson(`/api/points/admin/markets?${q.toString()}`);
      setMarkets(r.markets || []);
    } catch (e) {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [
    filter,
    categoryFilter,
    sportFilter,
    leagueFilter,
    cryptoTypeFilter,
    geoFilter,
    topicFilter,
  ]);

  function selectCategoryFilter(next) {
    setCategoryFilter(next);
    setSportFilter('all');
    setLeagueFilter('all');
    setCryptoTypeFilter('all');
    setGeoFilter('all');
    setTopicFilter('all');
  }

  function selectSportFilter(next) {
    setSportFilter(next);
    if (next !== 'soccer' && next !== 'baseball' && next !== 'combate') {
      setLeagueFilter('all');
    }
  }

  async function resolveMarket(marketId, winningOutcomeIndex) {
    setResolving(marketId);
    try {
      await postJson('/api/points/admin/resolve-market', {
        marketId, winningOutcomeIndex,
      });
      // In-place patch instead of refetching the whole list — the
      // refetch would scroll the page back to the top and lose the
      // admin's place when they're working through a stack of
      // por-resolver candidates. Optimistically flip status to
      // resolved + write the winning outcome locally; on the next
      // explicit refresh / filter change the API state will be loaded.
      setMarkets(prev => (prev || []).map(m => m.id === marketId ? {
        ...m,
        status: 'resolved',
        outcome: winningOutcomeIndex,
        resolvedAt: new Date().toISOString(),
      } : m));
      onQueueChange?.();
    } catch (e) {
      alert(`No se pudo resolver: ${e.code || e.message}${e.detail ? '\n' + e.detail : ''}`);
    } finally {
      setResolving(null);
    }
  }

  async function reviewResolutionCandidate(market, candidate, action, outcomeIndex = null) {
    if (!candidate?.id || !market?.id) return;
    const selectedOutcome = outcomeIndex == null ? candidate.outcomeIndex : outcomeIndex;
    const verb = action === 'confirm' ? 'confirmar' : 'negar';
    const label = action === 'confirm'
      ? (market.outcomes?.[selectedOutcome] || `Resultado ${Number(selectedOutcome) + 1}`)
      : 'la sugerencia';
    if (!window.confirm(`¿${verb[0].toUpperCase()}${verb.slice(1)} ${label} para "${market.question}"?`)) return;

    setReviewingCandidate(candidate.id);
    try {
      await adminReviewResolutionCandidate({
        candidateId: candidate.id,
        action,
        outcomeIndex: action === 'confirm' ? selectedOutcome : null,
      });
      setMarkets(prev => (prev || []).flatMap((m) => {
        if (m.id !== market.id) return [m];
        const next = action === 'confirm'
          ? {
              ...m,
              status: 'resolved',
              outcome: selectedOutcome,
              resolvedAt: new Date().toISOString(),
              finalScore: candidate.finalScore || m.finalScore,
              resolutionCandidate: null,
            }
          : { ...m, resolutionCandidate: null };
        return (filter === 'pending' && action === 'confirm') ? [] : [next];
      }));
      onQueueChange?.();
    } catch (e) {
      alert(`No se pudo ${verb}: ${e.code || e.message}${e.detail ? '\n' + e.detail : ''}`);
    } finally {
      setReviewingCandidate(null);
    }
  }

  async function cancelMarket(market) {
    if (!market?.id) return false;
    const ok = window.confirm(
      `¿Anular "${market.question}"?\n\n`
      + 'Se devolverá el costo base de las posiciones abiertas y el mercado ya no contará como ganado o perdido.',
    );
    if (!ok) return false;
    setCanceling(market.id);
    try {
      const result = await adminCancelMarket({
        marketId: market.id,
        reason: 'Mercado anulado: el evento no ocurrió',
      });
      const refunded = Number(result?.totalRefunded || 0);
      setMarkets(prev => (prev || []).flatMap((m) => {
        if (m.id !== market.id) return [m];
        const next = {
          ...m,
          status: 'canceled',
          outcome: null,
          resolvedAt: new Date().toISOString(),
        };
        return (filter === 'all' || filter === 'canceled') ? [next] : [];
      }));
      onQueueChange?.();
      alert(`Mercado anulado. Devuelto: ${refunded.toFixed(2)} MXNP.`);
      return true;
    } catch (e) {
      alert(`No se pudo anular: ${e.code || e.message}${e.detail ? '\n' + e.detail : ''}`);
      return false;
    } finally {
      setCanceling(null);
    }
  }

  // Toggle 🔥 on an already-created market. Optimistic update; rolls
  // back on server rejection.
  async function toggleFeaturedMarket(m) {
    const next = !m.featured;
    setMarkets(prev => (prev || []).map(x => x.id === m.id ? { ...x, featured: next } : x));
    try {
      await adminToggleFeatured({ marketId: m.id, featured: next });
    } catch (e) {
      setMarkets(prev => (prev || []).map(x => x.id === m.id ? { ...x, featured: !next } : x));
      alert(`No se pudo actualizar: ${e.code || e.message}`);
    }
  }

  // Run the auto-resolve loop on demand. Vercel cron jobs only fire
  // on production deploys — this button is the only way to settle
  // past-end_time markets on a preview URL, and the fastest path on
  // prod right after a Retrofit. Relevant on the "Por resolver"
  // filter where candidates live.
  async function runAutoResolveNow() {
    if (!confirm('Ejecutar el auto-resolver ahora? (En preview, el cron no corre automáticamente.)')) return;
    setAutoResolving(true);
    try {
      const r = await adminRunAutoResolve({ dry: false });
      const resolvedCount = (r.resolved || []).length;
      const errorCount = (r.errors || []).length;
      const deferredCount = (r.deferred || []).length;
      const reviewCount = (r.deferred || [])
        .filter(d => String(d.reason || '').includes('manual_review')).length;
      const errorSample = (r.errors || []).slice(0, 3)
        .map(e => `#${e.id}: ${e.error}`)
        .join('\n');
      alert(
        `✓ Auto-resolver corrido.\n`
        + `Candidatos: ${r.checked || 0}\n`
        + `Resueltos: ${resolvedCount}\n`
        + `En revisión: ${reviewCount}\n`
        + `Diferidos: ${deferredCount}\n`
        + `Errores: ${errorCount}\n`
        + (errorSample ? `\nEjemplos de errores:\n${errorSample}` : ''),
      );
      await load();
      onQueueChange?.();
    } catch (e) {
      alert(`Auto-resolver falló: ${e.code || e.message}${e.detail ? '\n' + e.detail : ''}`);
    } finally {
      setAutoResolving(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { key: 'all',      label: 'Todos' },
          { key: 'active',   label: 'Activos' },
          { key: 'pending',  label: 'Por resolver' },
          { key: 'resolved', label: 'Resueltos' },
          { key: 'canceled', label: 'Anulados' },
        ].map(s => {
          const taskCount = s.key === 'pending' ? pendingResolveCount : 0;
          return (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: `1px solid ${filter === s.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: filter === s.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: filter === s.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
                letterSpacing: '0.06em', textTransform: 'uppercase',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}
            >
              {s.label}
              {taskCount > 0 && (
                <span style={{
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  borderRadius: 999,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(245,158,11,0.16)',
                  border: '1px solid rgba(245,158,11,0.45)',
                  color: '#f59e0b',
                  fontSize: 10,
                  letterSpacing: 0,
                  lineHeight: 1,
                }}>
                  {taskCount > 99 ? '99+' : taskCount}
                </span>
              )}
            </button>
          );
        })}

        {/* Run the auto-resolver now — surfaced only on the Por
            resolver view since that's where candidates live. Vercel
            cron only runs on production, so this is the canonical
            path on a preview URL. */}
        {filter === 'pending' && (
          <button
            onClick={runAutoResolveNow}
            disabled={autoResolving}
            title="Ejecuta el auto-resolver ahora (el cron solo corre en producción, no en preview)"
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: 16,
              border: '1px solid rgba(245,158,11,0.4)',
              background: 'rgba(245,158,11,0.1)',
              color: '#f59e0b',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: autoResolving ? 'not-allowed' : 'pointer',
              opacity: autoResolving ? 0.5 : 1,
              fontWeight: 600,
            }}
          >
            {autoResolving ? 'Resolviendo…' : '⚡ Resolver ahora'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {MARKET_CATEGORY_FILTERS.map(c => (
          <button
            key={c.key}
            onClick={() => selectCategoryFilter(c.key)}
            style={{
              padding: '6px 12px',
              borderRadius: 16,
              border: `1px solid ${categoryFilter === c.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: categoryFilter === c.key ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: categoryFilter === c.key ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {showMexicoFilters && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {ADMIN_GEO_FILTERS.map(g => (
              <button
                key={g.key}
                onClick={() => setGeoFilter(g.key)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 16,
                  border: `1px solid ${geoFilter === g.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                  background: geoFilter === g.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                  color: geoFilter === g.key ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {ADMIN_MEXICO_TOPIC_FILTERS.map(t => (
              <button
                key={t.key}
                onClick={() => setTopicFilter(t.key)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 14,
                  border: `1px solid ${topicFilter === t.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                  background: topicFilter === t.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                  color: topicFilter === t.key ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {showSportFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ADMIN_SPORT_FILTERS.map(s => (
            <button
              key={s.key}
              onClick={() => selectSportFilter(s.key)}
              style={{
                padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${sportFilter === s.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: sportFilter === s.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: sportFilter === s.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {showLeagueFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {activeLeagueFilters.map(l => (
            <button
              key={l.key}
              onClick={() => setLeagueFilter(l.key)}
              style={{
                padding: '5px 10px',
                borderRadius: 14,
                border: `1px solid ${leagueFilter === l.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: leagueFilter === l.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: leagueFilter === l.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}

      {showCryptoFilters && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {ADMIN_CRYPTO_FILTERS.map(c => (
            <button
              key={c.key}
              onClick={() => setCryptoTypeFilter(c.key)}
              style={{
                padding: '6px 12px',
                borderRadius: 16,
                border: `1px solid ${cryptoTypeFilter === c.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
                background: cryptoTypeFilter === c.key ? 'rgba(0,232,122,0.1)' : 'transparent',
                color: cryptoTypeFilter === c.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>}
      {!loading && markets?.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Sin mercados en esta categoría.
        </p>
      )}

      {!loading && markets?.map(m => (
        <div key={m.id} style={{
          background: 'var(--surface1)', border: '1px solid var(--border)',
          borderRadius: 10, padding: '14px 18px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {/* 🔥 Featured toggle — controls whether this market appears
              on home Trending in addition to its category page. */}
          <button
            onClick={() => toggleFeaturedMarket(m)}
            title={m.featured
              ? 'Quitar de Trending (solo en su categoría)'
              : 'Mostrar en Trending (además de su categoría)'}
            style={{
              flexShrink: 0,
              width: 32, height: 32,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              border: `1px solid ${m.featured ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
              background: m.featured ? 'rgba(245,158,11,0.15)' : 'transparent',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
              filter: m.featured ? 'none' : 'grayscale(1)',
              opacity: m.featured ? 1 : 0.45,
              transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
            }}
          >
            🔥
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
              #{m.id} · {m.category} · {m.tradeCount} trades · seed {m.seedLiquidity} MXNP
              {m.sport && <> · {m.sport}</>}
              {m.league && <>/{m.league}</>}
              {m.crypto5min && <> · 5min</>}
              {m.seriesMeta?.subtitle && <> · {m.seriesMeta.subtitle}</>}
              {m.source && <> · {m.source}</>}
              {(m.resolverConfig?.eventId || m.sourceEventId) && <> · event {m.resolverConfig?.eventId || m.sourceEventId}</>}
              {m.resolverConfig?.dateYmd && <> · fecha {m.resolverConfig.dateYmd}</>}
              {m.endTime && <> · cierra {formatAdminMarketDate(m.endTime)}</>}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {m.question}
            </div>
            {m.resolutionCandidate && (
              <ResolutionCandidatePanel
                market={m}
                candidate={m.resolutionCandidate}
                reviewing={reviewingCandidate === m.resolutionCandidate.id}
                onReview={(action, outcomeIndex) => reviewResolutionCandidate(
                  m,
                  m.resolutionCandidate,
                  action,
                  outcomeIndex,
                )}
              />
            )}
          </div>
          {m.status === 'active' ? (
            <>
              <button
                onClick={() => setEditing(m)}
                title="Editar nombre, inicio o cierre"
                style={{
                  padding: '6px 10px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  cursor: 'pointer',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                Editar
              </button>
              {filter === 'pending' && (
                <button
                  onClick={() => cancelMarket(m)}
                  disabled={canceling === m.id}
                  title="Anular el mercado y devolver el costo base de las posiciones abiertas"
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(239,68,68,0.10)',
                    border: '1px solid rgba(239,68,68,0.35)',
                    borderRadius: 8,
                    color: 'var(--red, #ef4444)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    cursor: canceling === m.id ? 'not-allowed' : 'pointer',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    opacity: canceling === m.id ? 0.55 : 1,
                  }}
                >
                  {canceling === m.id ? 'Anulando…' : 'Anular mercado'}
                </button>
              )}
              {m.resolutionCandidate ? null : (
                <ResolveControls
                  market={m}
                  resolving={resolving === m.id}
                  onResolve={(winnerIndex) => resolveMarket(m.id, winnerIndex)}
                />
              )}
            </>
          ) : (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: m.status === 'canceled' ? 'var(--text-muted)' : 'var(--green)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}>
              {m.status === 'canceled' ? 'Anulado' : `✓ ${m.outcomes[m.outcome]}`}
            </span>
          )}
        </div>
      ))}

      {editing && (
        <EditMarketModal
          market={editing}
          onCancel={cancelMarket}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─── Edit-market modal ──────────────────────────────────────────────────────
// Lets an admin patch the user-facing question, start/close datetimes,
// and category. Reserves, outcomes, and status stay locked — mutating
// those post-creation would desync the AMM or confuse existing holders.
// Wired to POST /api/points/admin/edit-market.
function EditMarketModal({ market, onClose, onSaved, onCancel }) {
  const [question, setQuestion] = useState(market.question || '');
  const [category, setCategory] = useState(market.category || 'general');
  // Split date + time into three plain inputs so format is stable
  // across browser locales. Hour/minute are number inputs clamped to
  // 0-23 / 0-59 via their native min/max attributes.
  const [startDate, setStartDate] = useState(isoToDdMmYyyy(market.startTime));
  const [startHour, setStartHour] = useState(isoToHourPart(market.startTime));
  const [startMinute, setStartMinute] = useState(isoToMinutePart(market.startTime));
  const [endDate, setEndDate] = useState(isoToDdMmYyyy(market.endTime));
  const [endHour, setEndHour] = useState(isoToHourPart(market.endTime));
  const [endMinute, setEndMinute] = useState(isoToMinutePart(market.endTime));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [actionMode, setActionMode] = useState('save');

  const initialStartDate = isoToDdMmYyyy(market.startTime);
  const initialStartHour = isoToHourPart(market.startTime);
  const initialStartMinute = isoToMinutePart(market.startTime);
  const initialEndDate = isoToDdMmYyyy(market.endTime);
  const initialEndHour = isoToHourPart(market.endTime);
  const initialEndMinute = isoToMinutePart(market.endTime);
  const initialCategory = market.category || 'general';

  function normalizeEditedIso(dateValue, hourValue, minuteValue, initialDateValue, initialHourValue, initialMinuteValue, label) {
    const touched =
      dateValue !== initialDateValue ||
      hourValue !== initialHourValue ||
      minuteValue !== initialMinuteValue;
    if (!touched) return { value: undefined };

    const timeStr = composeHhMm(hourValue, minuteValue);
    if (!timeStr) {
      return { error: `Hora de ${label} inválida. Horas 0–23, minutos 0–59.` };
    }
    const iso = partsToIso(dateValue, timeStr);
    if (!iso) {
      return { error: `Fecha de ${label} inválida. Formato: dd/mm/yyyy.` };
    }
    return { value: iso };
  }

  async function save() {
    setSaving(true);
    setErr(null);

    const nextStart = normalizeEditedIso(
      startDate,
      startHour,
      startMinute,
      initialStartDate,
      initialStartHour,
      initialStartMinute,
      'inicio',
    );
    if (nextStart.error) {
      setErr(nextStart.error);
      setSaving(false);
      return;
    }

    const nextEnd = normalizeEditedIso(
      endDate,
      endHour,
      endMinute,
      initialEndDate,
      initialEndHour,
      initialEndMinute,
      'cierre',
    );
    if (nextEnd.error) {
      setErr(nextEnd.error);
      setSaving(false);
      return;
    }

    const effectiveStart = nextStart.value ?? market.startTime ?? null;
    const effectiveEnd = nextEnd.value ?? market.endTime ?? null;
    if (effectiveStart && effectiveEnd && new Date(effectiveStart).getTime() >= new Date(effectiveEnd).getTime()) {
      setErr('La fecha de inicio debe ser anterior a la fecha de cierre.');
      setSaving(false);
      return;
    }

    try {
      await adminEditMarket({
        marketId: market.id,
        question: question.trim() !== (market.question || '').trim() ? question.trim() : undefined,
        startTime: nextStart.value,
        endTime: nextEnd.value,
        category: category !== initialCategory ? category : undefined,
      });
      await onSaved?.();
    } catch (e) {
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
      setSaving(false);
    }
  }

  async function runPrimaryAction() {
    if (actionMode === 'cancel') {
      setSaving(true);
      setErr(null);
      const ok = await onCancel?.(market);
      if (ok) {
        await onSaved?.();
        return;
      }
      setSaving(false);
      return;
    }
    await save();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{
        width: 'min(480px, 100%)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '24px 28px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--green)',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Editar mercado #{market.id}
        </div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 0, marginBottom: 20 }}>
          {market.question}
        </h3>

        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Pregunta
        </label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          maxLength={500}
          style={{
            width: '100%',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: 14,
            resize: 'vertical',
          }}
        />

        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Categoría
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: 14,
          }}
        >
          {CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Fecha de inicio
        </label>
        {(() => {
          const smallInput = {
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            width: '100%',
          };
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 8px 70px', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="dd/mm/yyyy"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={smallInput}
                />
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  placeholder="HH"
                  value={startHour}
                  onChange={(e) => setStartHour(e.target.value)}
                  style={{ ...smallInput, textAlign: 'center' }}
                />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}>:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="mm"
                  value={startMinute}
                  onChange={(e) => setStartMinute(e.target.value)}
                  style={{ ...smallInput, textAlign: 'center' }}
                />
              </div>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                margin: '6px 0 14px',
                letterSpacing: '0.04em',
              }}>
                Horas 0–23, minutos 0–59. Zona: <strong>{currentTimezoneLabel()}</strong>.
              </p>
            </>
          );
        })()}

        <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Fecha de cierre
        </label>
        {(() => {
          const smallInput = {
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            color: 'var(--text-primary)',
            outline: 'none',
            width: '100%',
          };
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 8px 70px', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="dd/mm/yyyy"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={smallInput}
                />
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  placeholder="HH"
                  value={endHour}
                  onChange={(e) => setEndHour(e.target.value)}
                  style={{ ...smallInput, textAlign: 'center' }}
                />
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                }}>:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  step={1}
                  placeholder="mm"
                  value={endMinute}
                  onChange={(e) => setEndMinute(e.target.value)}
                  style={{ ...smallInput, textAlign: 'center' }}
                />
              </div>
              <p style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--text-muted)',
                margin: '6px 0 14px',
                letterSpacing: '0.04em',
              }}>
                Horas 0–23, minutos 0–59. Zona: <strong>{currentTimezoneLabel()}</strong>.
              </p>
            </>
          );
        })()}

        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
          Pregunta, fecha de inicio, fecha de cierre y categoría son editables.
          Opciones y reservas del AMM no se pueden cambiar después de crear el mercado.
        </p>

        {actionMode === 'cancel' && (
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--red, #ef4444)',
            lineHeight: 1.5,
            margin: '0 0 12px',
          }}>
            Se devolverá el costo base de las posiciones abiertas y este mercado quedará anulado.
          </p>
        )}

        {err && (
          <div style={{
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: 'var(--red, #ef4444)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            padding: '8px 12px',
            borderRadius: 8,
            marginBottom: 12,
          }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <select
            value={actionMode}
            onChange={(e) => setActionMode(e.target.value)}
            disabled={saving}
            title="Acción principal"
            style={{
              minWidth: 126,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: actionMode === 'cancel' ? 'var(--red, #ef4444)' : 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '0 10px',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="save">Guardar</option>
            <option value="cancel">Anular mercado</option>
          </select>
          <button
            onClick={runPrimaryAction}
            disabled={saving}
            className={actionMode === 'cancel' ? 'btn-ghost' : 'btn-primary'}
            style={{
              flex: 1,
              padding: '10px 14px',
              fontSize: 11,
              color: actionMode === 'cancel' ? 'var(--red, #ef4444)' : undefined,
              borderColor: actionMode === 'cancel' ? 'rgba(239,68,68,0.35)' : undefined,
            }}
          >
            {saving
              ? (actionMode === 'cancel' ? 'Anulando…' : 'Guardando…')
              : (actionMode === 'cancel' ? 'Anular mercado' : 'Guardar')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolutionCandidatePanel({ market, candidate, reviewing, onReview }) {
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  const initialOutcome = Number.isInteger(candidate.outcomeIndex) ? candidate.outcomeIndex : 0;
  const [selected, setSelected] = useState(initialOutcome);
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];

  return (
    <div style={{
      marginTop: 10,
      padding: '10px 12px',
      border: '1px solid rgba(245,158,11,0.35)',
      borderRadius: 10,
      background: 'rgba(245,158,11,0.08)',
      display: 'grid',
      gap: 8,
    }}>
      <div style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        flexWrap: 'wrap',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: '#f59e0b',
      }}>
        <span>Resolución sugerida</span>
        <span style={{ color: 'var(--text-muted)' }}>
          {candidate.source || 'manual-review'}
        </span>
        {candidate.confidenceLabel && (
          <span style={{ color: 'var(--text-muted)' }}>
            Confianza {candidate.confidenceLabel}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
          disabled={reviewing}
          style={{
            padding: '6px 10px',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-primary)',
            cursor: reviewing ? 'not-allowed' : 'pointer',
            minWidth: 160,
          }}
        >
          {outcomes.map((label, i) => (
            <option key={i} value={i}>
              {label}
            </option>
          ))}
        </select>
        <button
          onClick={() => onReview?.('confirm', selected)}
          disabled={reviewing}
          className="btn-primary"
          style={{ padding: '6px 12px', fontSize: 11 }}
        >
          {reviewing ? 'Revisando…' : 'Confirmar resolución'}
        </button>
        <button
          onClick={() => onReview?.('deny', null)}
          disabled={reviewing}
          className="btn-ghost"
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--red, #ef4444)',
            borderColor: 'rgba(239,68,68,0.35)',
          }}
        >
          Negar
        </button>
      </div>

      {(candidate.finalScore || candidate.rationale || evidence.length > 0) && (
        <div style={{
          display: 'grid',
          gap: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          lineHeight: 1.5,
          color: 'var(--text-muted)',
        }}>
          {candidate.finalScore && <div>Marcador / resultado: {candidate.finalScore}</div>}
          {candidate.rationale && <div>{candidate.rationale}</div>}
          {evidence.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {evidence.slice(0, 4).map((item, i) => {
                const label = item?.title || item?.url || `Fuente ${i + 1}`;
                return item?.url ? (
                  <a
                    key={`${label}-${i}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--green)', textDecoration: 'underline' }}
                  >
                    {label}
                  </a>
                ) : (
                  <span key={`${label}-${i}`}>{label}</span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Resolve controls ───────────────────────────────────────────────────────
// Compact dropdown + confirm button that works for any N outcomes. The
// previous hardcoded "Ganó X / Ganó Y" pair of buttons only covered
// N=2 markets, which broke resolution for 3-outcome W/D/L markets.
function ResolveControls({ market, resolving, onResolve }) {
  const [selected, setSelected] = useState(0);
  const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
  return (
    <>
      <select
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        disabled={resolving}
        style={{
          padding: '6px 10px',
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          minWidth: 120,
        }}
      >
        {outcomes.map((label, i) => (
          <option key={i} value={i}>
            {label}
          </option>
        ))}
      </select>
      <button
        onClick={() => onResolve(selected)}
        disabled={resolving}
        className="btn-primary"
        style={{ padding: '6px 12px', fontSize: 11 }}
      >
        {resolving ? 'Resolviendo…' : `Ganó ${outcomes[selected] || '—'}`}
      </button>
    </>
  );
}

// ─── Stats panel ─────────────────────────────────────────────────────────────
function StatsPanel() {
  const { user } = usePointsAuth();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    getJson('/api/points/admin/stats').then(setStats).catch(() => setStats(null));
  }, []);
  if (!stats) return <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>;
  return (
    <div>
      {/* "Signed in as @username" banner — Fran asked for the username
          at the top of the stats tab so admins can confirm which account
          they're viewing the dashboard as. */}
      {user?.username && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          background: 'var(--surface1)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          marginBottom: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}>
          <span style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--green)',
            boxShadow: '0 0 8px var(--green)',
          }} />
          Sesión admin: <strong style={{ color: 'var(--text-primary)' }}>@{user.username}</strong>
          {user.balance != null && (
            <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>
              {Number(user.balance).toLocaleString('es-MX')} MXNP
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Usuarios" value={stats.users.toLocaleString('es-MX')} />
        <StatCard label="MXNP en circulación" value={`${Number(stats.totalSupply).toLocaleString('es-MX')} MXNP`} />
        <StatCard label="Mercados (activos / total)" value={`${stats.markets.active} / ${stats.markets.total}`} />
      </div>

      <div style={{
        background: 'var(--surface1)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 20,
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
          Distribuciones (últimos 7 días)
        </div>
        {stats.recentDistributions.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            Sin actividad reciente.
          </p>
        )}
        {stats.recentDistributions.map(d => (
          <div key={d.kind} style={{
            display: 'flex', justifyContent: 'space-between',
            padding: '6px 0', borderBottom: '1px solid var(--border)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-secondary)' }}>{d.kind}</span>
            <span style={{ color: d.total >= 0 ? 'var(--green)' : 'var(--red, #ef4444)', fontWeight: 700 }}>
              {d.total >= 0 ? '+' : ''}{Number(d.total).toLocaleString('es-MX')} MXNP ({d.count})
            </span>
          </div>
        ))}
      </div>

      <AdminPublicityPanel publicity={stats.publicity} />
      <AdminInterestPanel interest={stats.interest} />
      <AdminVolumePanel volume={stats.volume} />
      <AdminSiteTimePanel siteTime={stats.siteTime} />
      <AdminActivityPanel activity={stats.activity} />
    </div>
  );
}

function adminNumber(value, options = {}) {
  return Number(value || 0).toLocaleString('es-MX', options);
}

function adminMxnp(value) {
  return `${adminNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXNP`;
}

function formatAdminDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  if (total < 60) return `${Math.round(total)}s`;
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remMinutes}m`;
  return `${minutes}m`;
}

function adminActionLabel(row) {
  if (row.kind === 'trade') {
    if (row.action === 'buy') return 'Compra';
    if (row.action === 'sell') return 'Venta';
    if (row.action === 'redeem') return 'Reclamo';
    return row.action || 'Trade';
  }
  const labels = {
    daily_claim: 'Reclamo diario',
    signup_bonus: 'Bono de bienvenida',
    referral_bonus: 'Referido',
    social_task: 'Tarea social',
    market_cancel_refund: 'Reembolso por anulación',
    void_refund: 'Reembolso',
  };
  return labels[row.action] || row.action || 'Distribución';
}

function AdminPublicityPanel({ publicity }) {
  const rows = Array.isArray(publicity?.sources) ? publicity.sources : [];
  const [copiedSource, setCopiedSource] = useState(null);

  const copyLink = async (source, href) => {
    try {
      await navigator.clipboard?.writeText(href);
      setCopiedSource(source);
      window.setTimeout(() => setCopiedSource(null), 1600);
    } catch {
      setCopiedSource(null);
    }
  };

  return (
    <section style={adminPanelStyle}>
      <div style={adminPanelTitle}>Enlaces de publicidad</div>
      <p style={{
        margin: '0 0 14px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        lineHeight: 1.6,
      }}>
        Usa estos links en las bios. Las conversiones cuentan la primera cuenta atribuida a cada canal.
      </p>
      {rows.length === 0 ? (
        <p style={adminEmptyStyle}>Aún no hay enlaces configurados.</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map(row => {
            const href = `https://pronos.io${row.path}`;
            return (
              <div key={row.source} style={{
                display: 'grid',
                gridTemplateColumns: '120px minmax(220px, 1fr) minmax(140px, auto) minmax(150px, auto) 92px',
                gap: 12,
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
              }}>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700 }}>
                  {row.label}
                </span>
                <span style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: 'var(--text-secondary)',
                }}>
                  {href}
                </span>
                <span style={{ color: 'var(--green)', textAlign: 'right', fontWeight: 700 }}>
                  {adminNumber(row.monthVisits)} visitas 30d
                </span>
                <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                  {adminNumber(row.monthUnique)} únicos · {adminNumber(row.monthConversions)} cuentas
                  {' '}({adminNumber(row.monthConversionRate, { maximumFractionDigits: 1 })}%)
                </span>
                <button
                  type="button"
                  onClick={() => copyLink(row.source, href)}
                  style={{
                    border: '1px solid var(--border)',
                    background: copiedSource === row.source ? 'rgba(16, 185, 129, 0.14)' : 'var(--surface2)',
                    color: copiedSource === row.source ? 'var(--green)' : 'var(--text-secondary)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {copiedSource === row.source ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AdminVolumePanel({ volume }) {
  const rows = Array.isArray(volume?.markets) ? volume.markets : [];
  return (
    <section style={adminPanelStyle}>
      <div style={adminPanelTitle}>Volumen invertido por mercado</div>
      {rows.length === 0 ? (
        <p style={adminEmptyStyle}>Aún no hay volumen de compra registrado.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row, idx) => (
            <div key={row.id} style={adminRowGridStyle}>
              <span style={{ color: 'var(--text-muted)' }}>{idx + 1}.</span>
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
              }}>
                {row.question}
              </span>
              <span style={{ color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>
                {adminMxnp(row.investedVolume)}
              </span>
              <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                {row.traders} usuarios · {row.buyCount} compras
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminSiteTimePanel({ siteTime }) {
  const rows = Array.isArray(siteTime?.users) ? siteTime.users : [];
  return (
    <section style={adminPanelStyle}>
      <div style={adminPanelTitle}>Tiempo en el sitio (30 días)</div>
      {rows.length === 0 ? (
        <p style={adminEmptyStyle}>Aún no hay señales de tiempo registradas.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(row => (
            <div key={row.username} style={adminRowGridStyle}>
              <span style={{ color: 'var(--text-muted)' }}>@</span>
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
              }}>
                {row.username}
              </span>
              <span style={{ color: 'var(--green)', fontWeight: 700, textAlign: 'right' }}>
                {formatAdminDuration(row.totalSeconds)}
              </span>
              <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                {adminNumber(row.sharePct, { maximumFractionDigits: 1 })}% · {row.lastPath || '/'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AdminActivityPanel({ activity }) {
  const rows = Array.isArray(activity) ? activity : [];
  return (
    <section style={adminPanelStyle}>
      <div style={adminPanelTitle}>Actividad por usuario</div>
      {rows.length === 0 ? (
        <p style={adminEmptyStyle}>Sin actividad reciente.</p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map((row, idx) => (
            <div key={`${row.kind}-${row.createdAt}-${idx}`} style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(110px, 0.35fr) minmax(120px, 0.35fr) minmax(0, 1fr) minmax(96px, auto)',
              gap: 12,
              alignItems: 'center',
              padding: '9px 0',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
                @{row.username}
              </span>
              <span style={{ color: 'var(--green)' }}>{adminActionLabel(row)}</span>
              <span style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-secondary)',
              }}>
                {row.question || `Mercado #${row.marketId || '-'}`}
              </span>
              <span style={{
                color: Number(row.amount || 0) >= 0 ? 'var(--green)' : 'var(--red, #ef4444)',
                textAlign: 'right',
              }}>
                {adminMxnp(row.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const adminPanelStyle = {
  marginTop: 20,
  background: 'var(--surface1)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 20,
};

const adminPanelTitle = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  marginBottom: 12,
};

const adminEmptyStyle = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

const adminRowGridStyle = {
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr) minmax(120px, auto) minmax(130px, auto)',
  gap: 12,
  alignItems: 'center',
  padding: '9px 0',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
};

function StatCard({ label, value }) {
  return (
    <div style={{
      background: 'var(--surface1)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '16px 18px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

// ─── Pending markets (agent queue) ──────────────────────────────────────────
// Daily cron (generate-markets-pending) drops rows into
// points_pending_markets. Admin triages them here: Aprobar copies the
// spec into points_markets via the API; Rechazar just marks the row so
// re-runs of the generator skip the same source_event_id.
function PendingMarketsTable({ onQueueChange }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [editingPending, setEditingPending] = useState(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const r = await adminListPendingMarkets(filter);
      setRows(r.pending || []);
    } catch (e) {
      setRows([]);
      setErr(e.code || e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function review(id, action) {
    setBusyId(id);
    try {
      await adminReviewPendingMarket(id, action, null);
      // Don't reload — admin's scroll position is preserved if we
      // mutate the local rows array instead of refetching. Reload
      // was causing the page to "jump back to the top" between
      // every approval. Backend already committed the status flip;
      // the next manual refresh (or a tab switch) re-syncs.
      setRows(prev => {
        if (!Array.isArray(prev)) return prev;
        // On the Pending tab, drop the row entirely so the queue
        // shrinks underneath the cursor. On Approved / Rejected
        // tabs, update the row in place so the new status reflects.
        if (filter === 'pending') {
          return prev.filter(r => r.id !== id);
        }
        if (filter === 'rejected' && action === 'readd') {
          return prev.filter(r => r.id !== id);
        }
        const nextStatus = action === 'approve'
          ? 'approved'
          : action === 'reject'
            ? 'rejected'
            : 'pending';
        return prev.map(r => r.id === id
          ? { ...r, status: nextStatus }
          : r);
      });
      onQueueChange?.();
    } catch (e) {
      alert(`${action} falló: ${e.code || e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function refreshPricing(id) {
    setBusyId(id);
    try {
      const r = await adminRefreshPendingPricing(id);
      setRows(prev => (Array.isArray(prev)
        ? prev.map(row => row.id === id
          ? {
              ...row,
              suggestedPricing: r.suggestedPricing || row.suggestedPricing || null,
              sourceData: {
                ...(row.sourceData || {}),
                suggestedPricing: r.suggestedPricing || row.sourceData?.suggestedPricing || null,
              },
              seedLiquidities: Array.isArray(r.seedLiquidities) ? r.seedLiquidities : row.seedLiquidities,
              seedLiquidity: Array.isArray(r.seedLiquidities) ? r.seedLiquidities[0] : row.seedLiquidity,
            }
          : row)
        : prev));
      const source = formatSuggestedPricingSource(r.suggestedPricing);
      alert(r.foundExternalOdds
        ? `Odds actualizados con ${source}.`
        : `No se encontró un match externo confiable. Se quedó en ${source}.`);
    } catch (e) {
      alert(`Buscar odds falló: ${e.code || e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function refreshAllPricing() {
    const pendingCount = rows?.filter(r => r.status === 'pending').length || 0;
    if (pendingCount === 0) return;
    if (!confirm(`¿Buscar odds para hasta ${Math.min(pendingCount, 100)} mercados pendientes?`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const r = await adminRefreshAllPendingPricing();
      await load();
      alert(
        `✓ Odds revisados: ${r.refreshedCount || 0}/${r.checked || 0}.\n`
        + `Con Polymarket: ${r.foundExternalCount || 0}.\n`
        + `Fallidos: ${r.failedCount || 0}.`,
      );
      onQueueChange?.();
    } catch (e) {
      alert(`Buscar odds falló: ${e.code || e.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function approveAll() {
    const pendingCount = rows?.filter(r => r.status === 'pending').length || 0;
    if (pendingCount === 0) return;
    if (!confirm(`¿Aprobar los ${pendingCount} mercados pendientes? Se crearán todos con la seed y modo sugeridos.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const r = await adminApproveAllPendingMarkets();
      await load();
      const msg = r.failedCount > 0
        ? `Aprobados ${r.approvedCount} de ${r.checked}. ${r.failedCount} fallaron — revisa el historial.`
        : `✓ ${r.approvedCount} mercados aprobados.`;
      alert(msg);
      onQueueChange?.();
    } catch (e) {
      alert(`Aprobar todos falló: ${e.code || e.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function runGenerators() {
    if (!confirm('¿Ejecutar todos los generadores ahora? Inserta/actualiza filas en la cola de pendientes.')) {
      return;
    }
    setBulkBusy(true);
    try {
      const r = await adminRunGenerators({ dry: false });
      await load();
      const counts = Object.entries(r.sources || {})
        .filter(([, v]) => v.count > 0)
        .map(([k, v]) => `${k}:${v.count}`)
        .join(' · ') || '(sin eventos)';
      alert(`✓ Generación completa.\nInsertados: ${r.inserted} · Actualizados: ${r.updated} · Saltados: ${r.skipped}\n${counts}`);
      onQueueChange?.();
    } catch (e) {
      alert(`Generar falló: ${e.code || e.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function backfillResolvers() {
    setBulkBusy(true);
    try {
      const preview = await adminBackfillResolvers({ dry: true });
      const n = preview.candidateCount || 0;
      if (n === 0) {
        alert('No hay mercados que necesiten retrofit. Todo al día.');
        return;
      }
      if (!confirm(`Retrofit: ${n} mercados activos recibirán resolver + sport/league + logos donde falten. Continuar?`)) {
        return;
      }
      const r = await adminBackfillResolvers({ dry: false });
      const breakdown = Object.entries(r.patchCounts || r.byResolverType || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      alert(`✓ ${r.updatedCount} mercados actualizados.\n${breakdown}`);
    } catch (e) {
      alert(`Retrofit falló: ${e.code || e.message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  // Toggle the 🔥 featured flag on a PENDING row. Carries into the
  // created market at approval time. Optimistic update; rolls back
  // on server rejection.
  async function togglePendingFeatured(row) {
    const next = !row.pendingFeatured;
    setRows(prev => (prev || []).map(r =>
      r.id === row.id ? { ...r, pendingFeatured: next } : r,
    ));
    try {
      await adminToggleFeatured({ pendingId: row.id, featured: next });
    } catch (e) {
      setRows(prev => (prev || []).map(r =>
        r.id === row.id ? { ...r, pendingFeatured: !next } : r,
      ));
      alert(`No se pudo actualizar: ${e.code || e.message}`);
    }
  }

  async function progressWorldCup() {
    setBulkBusy(true);
    try {
      const preview = await adminProgressWorldCup({ dry: true });
      const n = preview.totalPlanned || 0;
      const lines = [
        `Eventos ESPN: ${preview.espnEvents || 0}`,
        `Partidos de grupo enlazados: ${preview.groupFixturesMatched || 0}/72`,
        `Parches de resolver: ${preview.groupResolverPatches || 0}`,
        `Grupos por resolver: ${preview.groupMatchesToResolve || 0}`,
        `Ganadores de grupo por cerrar: ${preview.groupWinnerMarketsToResolve || 0}`,
        `Knockouts por crear: ${preview.knockoutMarketsToCreate || 0}`,
        `Knockouts por resolver: ${preview.knockoutMarketsToResolve || 0}`,
      ];
      if (n === 0) {
        alert(`Sin cambios pendientes para Mundial.\n\n${lines.join('\n')}`);
        return;
      }
      if (!confirm(`Aplicar reparación ESPN del Mundial?\n\n${lines.join('\n')}`)) {
        return;
      }
      const r = await adminProgressWorldCup({ dry: false });
      const applied = r.applied || {};
      alert(
        `✓ Mundial actualizado.\n`
        + `Resolvers parchados: ${applied.groupResolverPatches || 0}\n`
        + `Grupos resueltos: ${applied.groupMatchesResolved || 0}\n`
        + `Ganadores de grupo: ${applied.groupWinnerMarketsResolved || 0}\n`
        + `Knockouts creados/parchados: ${applied.knockoutMarketsCreatedOrPatched || 0}\n`
        + `Knockouts resueltos: ${applied.knockoutMarketsResolved || 0}`,
      );
      await load();
      onQueueChange?.();
    } catch (e) {
      alert(`Progresar Mundial falló: ${e.code || e.message}${e.detail ? '\n' + e.detail : ''}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function showResolveDiagnostic() {
    try {
      const r = await adminResolveDiagnostic();
      const s = r.summary || {};
      const sample = (r.missingResolver || []).slice(0, 5)
        .map(x => `#${x.id} · ${x.question?.slice(0, 48)}`)
        .join('\n');
      alert(
        `Estado de resolución (activos: ${r.totalActive})\n\n`
        + `Listos para resolver (cron debería tomarlos): ${s.resolvable}\n`
        + `Esperando fin de ventana: ${s.waitingWindow}\n`
        + `Sin resolver_type (correr Retrofit): ${s.missingResolver}\n`
        + `Manuales (admin resuelve): ${s.manual}\n`
        + (sample ? `\nEjemplos sin resolver:\n${sample}` : ''),
      );
    } catch (e) {
      alert(`Diagnóstico falló: ${e.code || e.message}`);
    }
  }

  const pendingCount = rows?.filter(r => r.status === 'pending').length || 0;

  return (
    <div>
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap',
        alignItems: 'center',
      }}>
        {[
          { key: 'pending',  label: 'Pendientes' },
          { key: 'approved', label: 'Aprobados' },
          { key: 'rejected', label: 'Rechazados' },
          { key: 'all',      label: 'Todos' },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setFilter(s.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${filter === s.key ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: filter === s.key ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: filter === s.key ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s.label}
          </button>
        ))}

        {/* Bulk approve — only renders on the Pending view when there's
            something to approve. Backend processes per-row txns so one
            bad spec doesn't undo the rest. */}
        {filter === 'pending' && pendingCount > 0 && (
          <button
            onClick={approveAll}
            disabled={bulkBusy}
            title={`Aprobar los ${pendingCount} mercados pendientes de un jalón`}
            style={{
              marginLeft: 'auto',
              padding: '6px 14px',
              borderRadius: 16,
              border: '1px solid rgba(0,232,122,0.45)',
              background: 'rgba(0,232,122,0.14)',
              color: 'var(--green)',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: bulkBusy ? 'not-allowed' : 'pointer',
              opacity: bulkBusy ? 0.5 : 1,
              fontWeight: 600,
            }}
          >
            {bulkBusy ? `Aprobando ${pendingCount}…` : `✓ Aprobar todos (${pendingCount})`}
          </button>
        )}

        {filter === 'pending' && pendingCount > 0 && (
          <button
            onClick={refreshAllPricing}
            disabled={bulkBusy}
            title={`Buscar odds externos para hasta ${Math.min(pendingCount, 100)} mercados pendientes`}
            style={{
              marginLeft: (filter === 'pending' && pendingCount > 0) ? 0 : 'auto',
              padding: '6px 14px',
              borderRadius: 16,
              border: '1px solid rgba(255,92,0,0.45)',
              background: 'rgba(255,92,0,0.1)',
              color: 'var(--orange)',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: bulkBusy ? 'not-allowed' : 'pointer',
              opacity: bulkBusy ? 0.5 : 1,
              fontWeight: 600,
            }}
          >
            {bulkBusy ? 'Buscando odds…' : 'Buscar odds'}
          </button>
        )}

        {/* Generate now — runs every pipeline and upserts. Same code
            path as the daily cron; useful on preview deploys (which
            Vercel doesn't cron) and after editing entertainment-config. */}
        <button
          onClick={runGenerators}
          disabled={bulkBusy}
          title="Ejecuta todos los generadores y hace upsert en la cola pendiente"
          style={{
            marginLeft: (filter === 'pending' && pendingCount > 0) ? 0 : 'auto',
            padding: '6px 14px',
            borderRadius: 16,
            border: '1px solid rgba(59,130,246,0.4)',
            background: 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: bulkBusy ? 'not-allowed' : 'pointer',
            opacity: bulkBusy ? 0.5 : 1,
            fontWeight: 600,
          }}
        >
          🔄 Generar ahora
        </button>

        {/* Retrofit resolvers — one-shot migration for markets
            approved before the auto-resolver code landed. Dry-runs
            first to show the candidate count, then applies on confirm. */}
        <button
          onClick={backfillResolvers}
          disabled={bulkBusy}
          title="Copia resolver_type + resolver_config + sport/league + logos hacia points_markets donde falten"
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: bulkBusy ? 'not-allowed' : 'pointer',
            opacity: bulkBusy ? 0.5 : 1,
          }}
        >
          🔧 Retrofit resolvers
        </button>

        {/* Repair/progress World Cup from ESPN. Safe to re-run:
            dry-runs first, then patches existing group rows, resolves
            completed fixtures, and creates/open knockouts through
            the current semifinal window. */}
        <button
          onClick={progressWorldCup}
          disabled={bulkBusy}
          title="Parcha y progresa mercados del Mundial con ESPN"
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: '1px solid rgba(59,130,246,0.4)',
            background: 'rgba(59,130,246,0.1)',
            color: '#3b82f6',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: bulkBusy ? 'not-allowed' : 'pointer',
            opacity: bulkBusy ? 0.5 : 1,
          }}
        >
          Reparar Mundial
        </button>

        {/* Resolver diagnostic — read-only "why aren't my markets
            resolving?" report. Buckets active markets into
            resolvable / waiting / missing-resolver / manual. */}
        <button
          onClick={showResolveDiagnostic}
          disabled={bulkBusy}
          title="Diagnóstico: estado de la cola auto-resolver"
          style={{
            padding: '6px 14px',
            borderRadius: 16,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: 11,
            letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: bulkBusy ? 'not-allowed' : 'pointer',
            opacity: bulkBusy ? 0.5 : 1,
          }}
        >
          🩺 Diagnóstico resolver
        </button>

      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
        El agente (cron diario <code>/api/cron/generate-markets-pending</code>) descubre eventos
        y los deja aquí para revisión. Aprobar crea el mercado con odds/liquidez sugeridos
        usando el modo AMM sugerido. Rechazar lo deja marcado — la siguiente corrida lo omite por
        <code> (source, source_event_id)</code>.
      </p>

      {loading && <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>}
      {err && (
        <p style={{ color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Error: {err}
        </p>
      )}
      {!loading && rows?.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Nada en esta lista.
        </p>
      )}

      {!loading && rows?.map(r => {
        const isPending = r.status === 'pending';
        const isRejected = r.status === 'rejected';
        const suggestedOdds = formatSuggestedPricing(r);
        return (
          <div key={r.id} style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 10,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              gap: 12, marginBottom: 8,
            }}>
              {/* Featured (🔥) toggle — PENDING rows only. When ON at
                  approval time, the created market goes into the home
                  Trending grid in addition to its category page. When
                  OFF (default), it only shows under /c/<category>.
                  The approved-row equivalent of this lives in the
                  Mercados tab so admins can flip featured after the
                  market already exists. */}
              {isPending && (
                <button
                  onClick={() => togglePendingFeatured(r)}
                  title={r.pendingFeatured
                    ? 'Este mercado irá a Trending al aprobarse (click para quitar)'
                    : 'Click para que este mercado salga en Trending al aprobarse'}
                  style={{
                    flexShrink: 0,
                    width: 32, height: 32,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '50%',
                    border: `1px solid ${r.pendingFeatured ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                    background: r.pendingFeatured ? 'rgba(245,158,11,0.15)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 16,
                    lineHeight: 1,
                    padding: 0,
                    filter: r.pendingFeatured ? 'none' : 'grayscale(1)',
                    opacity: r.pendingFeatured ? 1 : 0.45,
                    transition: 'opacity 0.15s, background 0.15s, border-color 0.15s',
                  }}
                >
                  🔥
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
                  letterSpacing: '0.04em', marginBottom: 4, textTransform: 'uppercase',
                }}>
                  #{r.id} · {r.source} · {r.category} · {r.ammMode}
                  {r.sourceData?.competitionName && <> · {r.sourceData.competitionName}</>}
                  {r.resolverType && <> · resolver: {r.resolverType}</>}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                  {r.question}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
                  marginTop: 4, letterSpacing: '0.04em',
                }}>
                  Opciones: {Array.isArray(r.outcomes) ? r.outcomes.join(' · ') : '—'}
                  {' · Cierra: '}{formatAdminMarketDate(r.endTime)}
                  {' · Seed: '}
                  {Array.isArray(r.seedLiquidities) && r.seedLiquidities.length === r.outcomes?.length
                    ? r.seedLiquidities.map(v => Number(v).toLocaleString('es-MX')).join(' / ')
                    : Number(r.seedLiquidity || 0).toLocaleString('es-MX')}
                  {' MXNP'}
                  {suggestedOdds && <> · Odds sugeridos: {suggestedOdds}</>}
                </div>
              </div>

              {isPending ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    onClick={() => refreshPricing(r.id)}
                    disabled={busyId === r.id}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(255,92,0,0.08)',
                      border: '1px solid rgba(255,92,0,0.34)',
                      borderRadius: 8,
                      color: 'var(--orange)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      cursor: busyId === r.id ? 'not-allowed' : 'pointer',
                      opacity: busyId === r.id ? 0.5 : 1,
                    }}
                  >
                    Buscar odds
                  </button>
                  <button
                    onClick={() => setEditingPending(r)}
                    disabled={busyId === r.id}
                    style={{
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      cursor: busyId === r.id ? 'not-allowed' : 'pointer',
                      opacity: busyId === r.id ? 0.5 : 1,
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => review(r.id, 'approve')}
                    disabled={busyId === r.id}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(0,232,122,0.12)',
                      border: '1px solid rgba(0,232,122,0.4)',
                      borderRadius: 8,
                      color: 'var(--green)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      cursor: busyId === r.id ? 'not-allowed' : 'pointer',
                      opacity: busyId === r.id ? 0.5 : 1,
                    }}
                  >
                    Aprobar
                  </button>
                  <button
                    onClick={() => review(r.id, 'reject')}
                    disabled={busyId === r.id}
                    style={{
                      padding: '6px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11, letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      cursor: busyId === r.id ? 'not-allowed' : 'pointer',
                      opacity: busyId === r.id ? 0.5 : 1,
                    }}
                  >
                    Rechazar
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10,
                    color: r.status === 'approved' ? 'var(--green)' : 'var(--text-muted)',
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>
                    {r.status === 'approved'
                      ? `✓ Aprobado · #${r.approvedMarketId}`
                      : '✗ Rechazado'}
                    {r.reviewer && <> · @{r.reviewer}</>}
                  </span>
                  {isRejected && (
                    <button
                      onClick={() => review(r.id, 'readd')}
                      disabled={busyId === r.id}
                      title="Mover este mercado rechazado de vuelta a Pendientes"
                      style={{
                        padding: '6px 12px',
                        background: 'rgba(0,232,122,0.12)',
                        border: '1px solid rgba(0,232,122,0.4)',
                        borderRadius: 8,
                        color: 'var(--green)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11, letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        cursor: busyId === r.id ? 'not-allowed' : 'pointer',
                        opacity: busyId === r.id ? 0.5 : 1,
                      }}
                    >
                      Reagregar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {editingPending && (
        <PendingMarketEditModal
          row={editingPending}
          onClose={() => setEditingPending(null)}
          onSaved={async () => {
            setEditingPending(null);
            await load();
            onQueueChange?.();
          }}
        />
      )}
    </div>
  );
}

function PendingMarketEditModal({ row, onClose, onSaved }) {
  const initialOutcomes = Array.isArray(row.outcomes) && row.outcomes.length >= 2
    ? row.outcomes
    : ['Sí', 'No'];
  const initialSeeds = Array.isArray(row.seedLiquidities) && row.seedLiquidities.length === initialOutcomes.length
    ? row.seedLiquidities
    : initialOutcomes.map(() => Number(row.seedLiquidity || 500));

  const [question, setQuestion] = useState(row.question || '');
  const [category, setCategory] = useState(row.category || 'general');
  const [ammMode, setAmmMode] = useState(row.ammMode === 'parallel' ? 'parallel' : 'unified');
  const [outcomes, setOutcomes] = useState(initialOutcomes);
  const [seedLiquidities, setSeedLiquidities] = useState(initialSeeds);
  const [startDate, setStartDate] = useState(isoToDdMmYyyy(row.startTime));
  const [startHour, setStartHour] = useState(isoToHourPart(row.startTime));
  const [startMinute, setStartMinute] = useState(isoToMinutePart(row.startTime));
  const [endDate, setEndDate] = useState(isoToDdMmYyyy(row.endTime));
  const [endHour, setEndHour] = useState(isoToHourPart(row.endTime));
  const [endMinute, setEndMinute] = useState(isoToMinutePart(row.endTime));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const suggestedPricing = pendingSuggestedPricing(row);
  const suggestedOdds = formatSuggestedPricing(row);

  function updateOutcome(idx, value) {
    setOutcomes(prev => prev.map((v, i) => i === idx ? value : v));
  }

  function updateLiquidity(idx, value) {
    setSeedLiquidities(prev => prev.map((v, i) => i === idx ? value : v));
  }

  function addOutcome() {
    if (outcomes.length >= 10) return;
    setOutcomes(prev => [...prev, '']);
    setSeedLiquidities(prev => [...prev, 500]);
  }

  function removeOutcome(idx) {
    if (outcomes.length <= 2) return;
    setOutcomes(prev => prev.filter((_, i) => i !== idx));
    setSeedLiquidities(prev => prev.filter((_, i) => i !== idx));
  }

  async function save() {
    const pairs = outcomes
      .map((outcome, i) => ({ outcome: String(outcome || '').trim(), liquidity: seedLiquidities[i] }))
      .filter(p => p.outcome);
    const cleanedOutcomes = pairs.map(p => p.outcome);
    const cleanedLiquidities = pairs.map(p => Number(p.liquidity));
    if (question.trim().length < 8) {
      setErr('La pregunta debe tener al menos 8 caracteres.');
      return;
    }
    if (cleanedOutcomes.length < 2) {
      setErr('Al menos 2 opciones con nombre.');
      return;
    }
    if (cleanedLiquidities.some(v => !Number.isFinite(v) || v < 100)) {
      setErr('La liquidez de cada opción debe ser de al menos 100 MXNP.');
      return;
    }

    const endTimeStr = composeHhMm(endHour, endMinute);
    const endIso = endTimeStr ? partsToIso(endDate, endTimeStr) : null;
    if (!endIso) {
      setErr('Fecha de cierre inválida. Formato: dd/mm/yyyy y hora 0–23:0–59.');
      return;
    }

    const hasStart = [startDate, startHour, startMinute].some(v => String(v || '').trim() !== '');
    let startIso = null;
    if (hasStart) {
      const startTimeStr = composeHhMm(startHour, startMinute);
      startIso = startTimeStr ? partsToIso(startDate, startTimeStr) : null;
      if (!startIso) {
        setErr('Fecha de inicio inválida. Déjala vacía o usa dd/mm/yyyy y hora 0–23:0–59.');
        return;
      }
      if (new Date(startIso).getTime() >= new Date(endIso).getTime()) {
        setErr('La fecha de inicio debe ser anterior al cierre.');
        return;
      }
    }

    setSaving(true);
    setErr(null);
    try {
      await adminEditPendingMarket(row.id, {
        question: question.trim(),
        category,
        icon: null,
        ammMode,
        outcomes: cleanedOutcomes,
        seedLiquidity: cleanedLiquidities[0] || 500,
        seedLiquidities: cleanedLiquidities,
        startTime: startIso,
        endTime: endIso,
      });
      await onSaved?.();
    } catch (e) {
      setErr(`${e.code || e.message}${e.detail ? ' · ' + e.detail : ''}`);
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose?.(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.68)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{
        width: 'min(760px, 100%)',
        maxHeight: 'min(88vh, 900px)',
        overflowY: 'auto',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '24px 28px',
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--green)',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Editar pendiente #{row.id}
        </div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginTop: 0, marginBottom: 20 }}>
          Antes de aprobar
        </h3>

        <Field label="Pregunta">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            maxLength={500}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12 }}>
          <Field label="Categoría">
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {CATEGORIES.map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="AMM">
            <select value={ammMode} onChange={(e) => setAmmMode(e.target.value)} style={inputStyle}>
              <option value="unified">Unificado</option>
              <option value="parallel">Paralelo</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Inicio">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 8px 62px', gap: 8, alignItems: 'center' }}>
              <input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="dd/mm/yyyy" style={inputStyle} />
              <input type="number" min={0} max={23} value={startHour} onChange={(e) => setStartHour(e.target.value)} placeholder="HH" style={{ ...inputStyle, textAlign: 'center' }} />
              <span style={{ color: 'var(--text-muted)', textAlign: 'center' }}>:</span>
              <input type="number" min={0} max={59} value={startMinute} onChange={(e) => setStartMinute(e.target.value)} placeholder="mm" style={{ ...inputStyle, textAlign: 'center' }} />
            </div>
          </Field>
          <Field label="Cierre">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px 8px 62px', gap: 8, alignItems: 'center' }}>
              <input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="dd/mm/yyyy" style={inputStyle} />
              <input type="number" min={0} max={23} value={endHour} onChange={(e) => setEndHour(e.target.value)} placeholder="HH" style={{ ...inputStyle, textAlign: 'center' }} />
              <span style={{ color: 'var(--text-muted)', textAlign: 'center' }}>:</span>
              <input type="number" min={0} max={59} value={endMinute} onChange={(e) => setEndMinute(e.target.value)} placeholder="mm" style={{ ...inputStyle, textAlign: 'center' }} />
            </div>
          </Field>
        </div>

        <Field label="Opciones y liquidez">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suggestedOdds && (
              <div style={{
                border: '1px solid rgba(255,92,0,0.28)',
                background: 'rgba(255,92,0,0.08)',
                borderRadius: 10,
                padding: '10px 12px',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                lineHeight: 1.55,
                letterSpacing: '0.04em',
              }}>
                <div style={{ color: 'var(--orange)', textTransform: 'uppercase', marginBottom: 4 }}>
                  Odds sugeridos · {formatSuggestedPricingSource(suggestedPricing)}
                </div>
                <div>{suggestedOdds}</div>
                {suggestedPricing?.rationale && (
                  <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                    {suggestedPricing.rationale}
                  </div>
                )}
              </div>
            )}
            {outcomes.map((outcome, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{
                  flexShrink: 0,
                  width: 24,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  letterSpacing: '0.06em',
                }}>
                  {String.fromCharCode(65 + i)}
                </span>
                <input
                  value={outcome}
                  onChange={(e) => updateOutcome(i, e.target.value)}
                  placeholder={`Opción ${i + 1}`}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={seedLiquidities[i] ?? 500}
                  onChange={(e) => updateLiquidity(i, e.target.value)}
                  aria-label={`Liquidez opción ${i + 1}`}
                  style={{
                    ...inputStyle,
                    width: 132,
                    flex: '0 0 132px',
                    fontFamily: 'var(--font-mono)',
                    textAlign: 'right',
                  }}
                />
                {outcomes.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removeOutcome(i)}
                    style={{
                      padding: '8px 12px',
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {outcomes.length < 10 && (
              <button
                type="button"
                onClick={addOutcome}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 14px',
                  background: 'transparent',
                  border: '1px dashed var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                + Agregar opción
              </button>
            )}
          </div>
        </Field>

        {err && (
          <div style={{ color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 12 }}>
            Error: {err}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={saving} className="btn-ghost" style={{ padding: '10px 16px' }}>
            Cerrar
          </button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary" style={{ padding: '10px 18px' }}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
