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
  adminEditMarket,
  adminListPendingMarkets,
  adminReviewPendingMarket,
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
          { id: 'pending', label: 'Por aprobar' },
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
      {tab === 'pending' && <PendingMarketsTable />}
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
    // Double-confirm because this is destructive: it snapshots the
    // leaderboard AND resets every user's balance to 500 MXNP. Running
    // it too early means users lose late-cycle gains; running it late
    // leaves everyone staring at "cierre pendiente" for longer than
    // ideal.
    const ok = window.confirm(
      '¿Cerrar el ciclo actual y abrir uno nuevo?\n\n' +
      '⚠️  Esto es DESTRUCTIVO:\n' +
      '1. Guarda un snapshot inmutable del top-100.\n' +
      '2. REINICIA el balance de TODOS los usuarios a 500 MXNP.\n' +
      '3. Abre un ciclo nuevo de 14 días.\n\n' +
      '¿Continuar?'
    );
    if (!ok) return;
    setWorking(true);
    setMsg(null);
    setErr(null);
    try {
      const r = await adminRolloverCycle();
      setMsg(
        `✓ Ciclo #${r.closedCycleId} cerrado — ${r.snapshotted} snapshots, ${r.resetCount || 0} balances reiniciados a 500 MXNP. ` +
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
// Two mode axes:
//   - `mode`: Binario (N=2) or Múltiple (N=3..10) — controls the outcome editor.
//   - `ammMode`: Unificado (one pool, N-outcome CPMM) or Paralelo
//     (Polymarket-style: one binary Sí/No market per outcome grouped under
//     a parent row). Only meaningful for Múltiple; Binario is locked to
//     Unificado since the two modes are equivalent at N=2.
function CreateMarketForm() {
  const [mode, setMode] = useState('binary'); // 'binary' | 'multi'
  const [ammMode, setAmmMode] = useState('unified'); // 'unified' | 'parallel'
  const [form, setForm] = useState({
    question: '',
    category: 'deportes',
    icon: '⚽',
    endDate: '',   // dd/mm/yyyy (text)
    endHour: '',   // 0-23 (string, validated on submit)
    endMinute: '', // 0-59 (string, validated on submit)
    outcomes: ['Sí', 'No'],
    seedLiquidity: 500,
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
      return { ...f, outcomes: [...f.outcomes, ''] };
    });
  }

  function removeOutcome(idx) {
    setForm(f => {
      if (f.outcomes.length <= 2) return f;
      const next = f.outcomes.filter((_, i) => i !== idx);
      return { ...f, outcomes: next };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // Client-side guardrails so the user sees friendly errors before a
    // round-trip to the server. Server validates these again.
    const cleaned = form.outcomes.map(o => o.trim()).filter(Boolean);
    if (cleaned.length < 2) {
      setState({ submitting: false, msg: null, err: 'Al menos 2 opciones con nombre.' });
      return;
    }
    if (cleaned.length > 10) {
      setState({ submitting: false, msg: null, err: 'Máximo 10 opciones.' });
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
        icon: form.icon,
        endTime: endIso,
        outcomes: cleaned,
        seedLiquidity: Number(form.seedLiquidity),
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

      <Field label="Liquidez inicial por opción (MXNP)">
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
  // When non-null, render the edit modal for this market.
  const [editing, setEditing] = useState(null);

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { key: 'all',      label: 'Todos' },
          { key: 'active',   label: 'Activos' },
          { key: 'pending',  label: 'Por resolver' },
          { key: 'resolved', label: 'Resueltos' },
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
                onClick={() => setEditing(m)}
                title="Editar nombre o fecha de cierre"
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
              <ResolveControls
                market={m}
                resolving={resolving === m.id}
                onResolve={(winnerIndex) => resolveMarket(m.id, winnerIndex)}
              />
            </>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)' }}>
              ✓ {m.outcomes[m.outcome]}
            </span>
          )}
        </div>
      ))}

      {editing && (
        <EditMarketModal
          market={editing}
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
// Lets an admin patch the user-facing question, the close datetime, and
// the category. Reserves, outcomes, and status stay locked — mutating
// those post-creation would desync the AMM or confuse existing holders.
// Wired to POST /api/points/admin/edit-market.
function EditMarketModal({ market, onClose, onSaved }) {
  const [question, setQuestion] = useState(market.question || '');
  const [category, setCategory] = useState(market.category || 'general');
  // Split date + time into three plain inputs so format is stable
  // across browser locales. Hour/minute are number inputs clamped to
  // 0-23 / 0-59 via their native min/max attributes.
  const [date, setDate] = useState(isoToDdMmYyyy(market.endTime));
  const [hour, setHour] = useState(isoToHourPart(market.endTime));
  const [minute, setMinute] = useState(isoToMinutePart(market.endTime));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const initialDate = isoToDdMmYyyy(market.endTime);
  const initialHour = isoToHourPart(market.endTime);
  const initialMinute = isoToMinutePart(market.endTime);
  const initialCategory = market.category || 'general';

  async function save() {
    setSaving(true);
    setErr(null);

    const dateTouched = date !== initialDate || hour !== initialHour || minute !== initialMinute;
    let nextIso;
    if (dateTouched) {
      const timeStr = composeHhMm(hour, minute);
      if (!timeStr) {
        setErr('Hora inválida. Horas 0–23, minutos 0–59.');
        setSaving(false);
        return;
      }
      nextIso = partsToIso(date, timeStr);
      if (!nextIso) {
        setErr('Fecha inválida. Formato: dd/mm/yyyy.');
        setSaving(false);
        return;
      }
    }

    try {
      await adminEditMarket({
        marketId: market.id,
        question: question.trim() !== (market.question || '').trim() ? question.trim() : undefined,
        endTime: nextIso,
        category: category !== initialCategory ? category : undefined,
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
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={smallInput}
                />
                <input
                  type="number"
                  min={0}
                  max={23}
                  step={1}
                  placeholder="HH"
                  value={hour}
                  onChange={(e) => setHour(e.target.value)}
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
                  value={minute}
                  onChange={(e) => setMinute(e.target.value)}
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
          Pregunta, fecha de cierre y categoría son editables. Opciones y
          reservas del AMM no se pueden cambiar después de crear el mercado.
        </p>

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

        <div style={{ display: 'flex', gap: 8 }}>
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
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary"
            style={{ flex: 1, padding: '10px 14px', fontSize: 11 }}
          >
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
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

// ─── Pending markets (agent queue) ──────────────────────────────────────────
// Daily cron (generate-markets-pending) drops rows into
// points_pending_markets. Admin triages them here: Aprobar copies the
// spec into points_markets via the API; Rechazar just marks the row so
// re-runs of the generator skip the same source_event_id.
function PendingMarketsTable() {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

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
      await load();
    } catch (e) {
      alert(`${action} falló: ${e.code || e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  function formatWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
      </div>

      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
        El agente (cron diario <code>/api/cron/generate-markets-pending</code>) descubre eventos
        y los deja aquí para revisión. Aprobar crea el mercado con seed 1000 MXNP usando el
        modo AMM sugerido. Rechazar lo deja marcado — la siguiente corrida lo omite por
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
        return (
          <div key={r.id} style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 10,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              gap: 12, marginBottom: 8,
            }}>
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
                  {r.icon && <span style={{ marginRight: 6 }}>{r.icon}</span>}
                  {r.question}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
                  marginTop: 4, letterSpacing: '0.04em',
                }}>
                  Opciones: {Array.isArray(r.outcomes) ? r.outcomes.join(' · ') : '—'}
                  {' · Cierra: '}{formatWhen(r.endTime)}
                  {' · Seed: '}{r.seedLiquidity} MXNP
                </div>
              </div>

              {isPending ? (
                <div style={{ display: 'flex', gap: 6 }}>
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
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
