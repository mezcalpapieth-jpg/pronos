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
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import {
  getJson,
  postJson,
  adminListSocialTasks,
  adminReviewSocialTask,
  adminListCycles,
  adminRolloverCycle,
} from '../lib/pointsApi.js';

const CATEGORIES = [
  { key: 'general',  label: 'General' },
  { key: 'mexico',   label: '🇲🇽 México' },
  { key: 'politica', label: '🌎 Política' },
  { key: 'deportes', label: '⚽ Deportes' },
  { key: 'finanzas', label: '$ Finanzas' },
  { key: 'crypto',   label: '₿ Crypto' },
  { key: 'musica',   label: '🎵 Música' },
];

export default function PointsAdmin({ isAdmin }) {
  const navigate = useNavigate();
  const { authenticated, user, loading: authLoading } = usePointsAuth();
  const [tab, setTab] = useState('create'); // 'create' | 'markets' | 'stats'

  useEffect(() => {
    if (authLoading) return;
    if (!authenticated) {
      navigate('/');
    }
  }, [authLoading, authenticated, navigate]);

  if (!authenticated) return null;
  if (!isAdmin) {
    return (
      <main style={{ padding: '100px 48px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
        <p style={{ color: 'var(--text-muted)' }}>No tienes acceso de admin.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1160, margin: '0 auto', padding: '60px 24px' }}>
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
          { id: 'markets', label: 'Mercados' },
          { id: 'social',  label: 'Tareas sociales' },
          { id: 'cycles',  label: 'Ciclos' },
          { id: 'stats',   label: 'Estadísticas' },
        ].map(t => {
          const active = tab === t.id;
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
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'create' && <CreateMarketForm />}
      {tab === 'markets' && <MarketsTable />}
      {tab === 'social' && <SocialTasksQueue />}
      {tab === 'cycles' && <CyclesPanel />}
      {tab === 'stats' && <StatsPanel />}
    </main>
  );
}

// ─── Competition cycles ───────────────────────────────────────────────────
// Admin tool for closing the current 2-week cycle: snapshots the top-100
// leaderboard, marks the cycle closed, and opens a new 14-day window.
// Users keep their MXNP — the rollover is just a checkpoint for
// distributing off-platform prize payouts.
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
    // Double-confirm because this is destructive-adjacent: it closes the
    // active cycle and snapshots immutable leaderboard positions. Running
    // it too early means you miss late trades; running it late means the
    // UI shows "cierre pendiente" for longer than ideal.
    const ok = window.confirm(
      '¿Cerrar el ciclo actual y abrir uno nuevo?\n\n' +
      'Esto guarda un snapshot del top-100 y empieza el siguiente ciclo de 14 días. ' +
      'Los balances de los usuarios NO se reinician.'
    );
    if (!ok) return;
    setWorking(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await adminRolloverCycle();
      setMsg(
        `✓ Ciclo #${r.closedCycleId} cerrado — ${r.snapshotted} snapshots guardados. ` +
        (r.winners?.[0] ? `🥇 ${r.winners[0].username} (${Math.round(r.winners[0].finalBalance)} MXNP)` : '')
      );
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
            <button
              onClick={rollover}
              disabled={working}
              style={{
                padding: '10px 18px',
                background: current.pastDeadline ? 'var(--green)' : 'var(--surface2)',
                color: current.pastDeadline ? '#000' : 'var(--text-primary)',
                border: `1px solid ${current.pastDeadline ? 'var(--green)' : 'var(--border)'}`,
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: working ? 'not-allowed' : 'pointer',
              }}
            >
              {working ? 'Cerrando ciclo…' : '▶ Cerrar ciclo y abrir siguiente'}
            </button>
            {msg && <div style={{ marginTop: 12, color: 'var(--green)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{msg}</div>}
            {err && <div style={{ marginTop: 12, color: 'var(--red, #ef4444)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Error: {err}</div>}
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>No hay ciclo activo (visita /api/points/cycles/current para crear uno).</div>
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
function SocialTasksQueue() {
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
    } catch (e) {
      alert(`No se pudo ${action === 'approve' ? 'aprobar' : 'rechazar'}: ${e.code || e.message}`);
    } finally {
      setWorking(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['pending', 'approved', 'rejected'].map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${status === s ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: status === s ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: status === s ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s === 'pending' ? 'Pendientes' : s === 'approved' ? 'Aprobadas' : 'Rechazadas'}
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
      {tasks && tasks.map(t => (
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
              #{t.id} · @{t.username} · {t.task_key} · +{t.reward} MXNP
            </div>
            {t.proof_url && (
              <a
                href={t.proof_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', textDecoration: 'underline' }}
              >
                Ver prueba ↗
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
              Revisada por @{t.reviewer} · {new Date(t.reviewed_at).toLocaleDateString('es-MX')}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Create market form ──────────────────────────────────────────────────────
function CreateMarketForm() {
  const [form, setForm] = useState({
    question: '',
    category: 'deportes',
    icon: '⚽',
    endTime: '',
    outcomeYes: 'Sí',
    outcomeNo: 'No',
    seedLiquidity: 500,
  });
  const [state, setState] = useState({ submitting: false, msg: null, err: null });

  async function handleSubmit(e) {
    e.preventDefault();
    setState({ submitting: true, msg: null, err: null });
    try {
      const r = await postJson('/api/points/admin/create-market', {
        question: form.question,
        category: form.category,
        icon: form.icon,
        endTime: new Date(form.endTime).toISOString(),
        outcomes: [form.outcomeYes, form.outcomeNo],
        seedLiquidity: Number(form.seedLiquidity),
      });
      setState({ submitting: false, msg: `Mercado creado (#${r.marketId})`, err: null });
      setForm(f => ({ ...f, question: '', endTime: '' }));
    } catch (e) {
      setState({ submitting: false, msg: null, err: e.code || e.message });
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: 'var(--surface1)', border: '1px solid var(--border)',
      borderRadius: 14, padding: 28, maxWidth: 720,
    }}>
      <Field label="Pregunta">
        <textarea
          value={form.question}
          onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
          rows={2}
          required
          placeholder="¿Mexico gana el Mundial 2026?"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
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
        <Field label="Icono">
          <input
            value={form.icon}
            onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
            maxLength={2}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Fecha de cierre">
        <input
          type="datetime-local"
          value={form.endTime}
          onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
          required
          style={inputStyle}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label='Opción "Sí"'>
          <input
            value={form.outcomeYes}
            onChange={e => setForm(f => ({ ...f, outcomeYes: e.target.value }))}
            required
            style={inputStyle}
          />
        </Field>
        <Field label='Opción "No"'>
          <input
            value={form.outcomeNo}
            onChange={e => setForm(f => ({ ...f, outcomeNo: e.target.value }))}
            required
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Liquidez inicial (MXNP)">
        <input
          type="number"
          min="100"
          step="100"
          value={form.seedLiquidity}
          onChange={e => setForm(f => ({ ...f, seedLiquidity: e.target.value }))}
          required
          style={inputStyle}
        />
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
function MarketsTable() {
  const [markets, setMarkets] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await getJson(`/api/points/admin/markets?status=${filter}`);
      setMarkets(r.markets || []);
    } catch (e) {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  async function resolveMarket(marketId, winningOutcomeIndex) {
    setResolving(marketId);
    try {
      await postJson('/api/points/admin/resolve-market', {
        marketId, winningOutcomeIndex,
      });
      await load();
    } catch (e) {
      alert(`No se pudo resolver: ${e.code || e.message}`);
    } finally {
      setResolving(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {['all', 'active', 'resolved'].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding: '6px 14px',
              borderRadius: 16,
              border: `1px solid ${filter === s ? 'rgba(0,232,122,0.4)' : 'var(--border)'}`,
              background: filter === s ? 'rgba(0,232,122,0.1)' : 'transparent',
              color: filter === s ? 'var(--green)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {s === 'all' ? 'Todos' : s === 'active' ? 'Activos' : 'Resueltos'}
          </button>
        ))}
      </div>

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
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
              #{m.id} · {m.category} · {m.tradeCount} trades · seed {m.seedLiquidity} MXNP
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3 }}>
              {m.question}
            </div>
          </div>
          {m.status === 'active' ? (
            <>
              <button
                onClick={() => resolveMarket(m.id, 0)}
                disabled={resolving === m.id}
                className="btn-primary"
                style={{ padding: '6px 12px', fontSize: 11 }}
              >
                Ganó {m.outcomes[0]}
              </button>
              <button
                onClick={() => resolveMarket(m.id, 1)}
                disabled={resolving === m.id}
                className="btn-ghost"
                style={{ padding: '6px 12px', fontSize: 11 }}
              >
                Ganó {m.outcomes[1]}
              </button>
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)' }}>
              ✓ {m.outcomes[m.outcome]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Stats panel ─────────────────────────────────────────────────────────────
function StatsPanel() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    getJson('/api/points/admin/stats').then(setStats).catch(() => setStats(null));
  }, []);
  if (!stats) return <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>;
  return (
    <div>
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
    </div>
  );
}

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
