/**
 * MVP Admin — manage on-chain (Turnkey-signed) markets.
 *
 * Scope is intentionally small vs. the Points admin at /admin:
 *   - Create a mode='onchain' market row (mirrors a contract deployed by
 *     MarketFactory on the configured chain — the operator pastes the
 *     chain address + optional market id).
 *   - List existing mode='onchain' markets with trade counts + status.
 *   - Resolve an active market by setting a winning outcome index.
 *
 * All endpoints are the shared /api/points/admin/* ones, with
 * `?mode=onchain` on list calls and `mode: 'onchain'` on create. Server
 * enforces the admin check via points-admin.js.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

const CATEGORIES = [
  { value: 'deportes', label: 'Deportes', icon: '⚽' },
  { value: 'politica', label: 'Política', icon: '🗳️' },
  { value: 'crypto',   label: 'Crypto',   icon: '₿'  },
  { value: 'finanzas', label: 'Finanzas', icon: '📈' },
  { value: 'mexico',   label: 'México',   icon: '🇲🇽' },
  { value: 'musica',   label: 'Música',   icon: '🎵' },
  { value: 'general',  label: 'General',  icon: '📊' },
];

const DEFAULT_CHAIN_ID = 421614; // Arbitrum Sepolia

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function inputStyle() {
  return {
    width: '100%',
    padding: '9px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--surface2)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
  };
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{
        display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
        marginBottom: 6, textTransform: 'uppercase',
      }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', lineHeight: 1.4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

// ── Create Market form ──────────────────────────────────────────────────────
function CreateMarketForm({ onCreated }) {
  const [question, setQuestion] = useState('');
  const [category, setCategory] = useState('deportes');
  const [icon, setIcon] = useState('⚽');
  const [outcomes, setOutcomes] = useState(['Sí', 'No']);
  const [endTime, setEndTime] = useState('');
  const [seed, setSeed] = useState('1000');
  const [chainId, setChainId] = useState(String(DEFAULT_CHAIN_ID));
  const [chainAddress, setChainAddress] = useState('');
  const [chainMarketId, setChainMarketId] = useState('');
  const [featured, setFeatured] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  function updateOutcome(i, val) {
    setOutcomes(prev => prev.map((o, idx) => idx === i ? val : o));
  }
  function addOutcome()    { setOutcomes(prev => prev.length < 10 ? [...prev, ''] : prev); }
  function removeOutcome(i) { setOutcomes(prev => prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev); }

  async function handleSubmit(e) {
    e.preventDefault();
    setNotice(null);
    const trimmedOutcomes = outcomes.map(o => o.trim()).filter(Boolean);
    if (trimmedOutcomes.length < 2) {
      setNotice({ type: 'error', msg: 'Necesitas al menos 2 outcomes.' });
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await postJson('/api/points/admin/create-market', {
        question: question.trim(),
        category,
        icon,
        endTime,
        outcomes: trimmedOutcomes,
        seedLiquidity: Number(seed),
        ammMode: 'unified',
        mode: 'onchain',
        chainId: Number(chainId),
        chainAddress: chainAddress.trim(),
        chainMarketId: chainMarketId.trim() || null,
        featured,
      });
      if (!ok) throw new Error(data?.error ? `${data.error}${data.detail ? ` · ${data.detail}` : ''}` : 'create_failed');
      setNotice({ type: 'success', msg: `Mercado creado · id=${data.marketId}` });
      setQuestion(''); setOutcomes(['Sí', 'No']); setChainAddress(''); setChainMarketId('');
      onCreated?.(data.marketId);
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'create_failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      padding: 20,
      border: '1px solid var(--border)',
      borderRadius: 14,
      background: 'var(--surface1)',
      marginBottom: 32,
    }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-primary)', marginBottom: 18, letterSpacing: '0.03em' }}>
        Registrar mercado on-chain
      </h3>

      <Field label="Pregunta" hint="Debe ser específica y resolver en una fecha clara.">
        <input type="text" required minLength={8} maxLength={200} value={question} onChange={e => setQuestion(e.target.value)} style={inputStyle()} placeholder="¿México gana el partido inaugural del Mundial 2026?" />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Categoría">
          <select value={category} onChange={e => {
            setCategory(e.target.value);
            const c = CATEGORIES.find(c => c.value === e.target.value);
            if (c) setIcon(c.icon);
          }} style={inputStyle()}>
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Ícono (emoji)">
          <input type="text" value={icon} onChange={e => setIcon(e.target.value)} style={inputStyle()} maxLength={4} />
        </Field>
      </div>

      <Field label="Outcomes (2–10)" hint="Orden importa — el índice se usa al firmar trades on-chain.">
        {outcomes.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input
              type="text" required value={o}
              onChange={e => updateOutcome(i, e.target.value)}
              placeholder={`Outcome ${i + 1}`}
              style={{ ...inputStyle(), flex: 1 }}
            />
            {outcomes.length > 2 && (
              <button type="button" onClick={() => removeOutcome(i)} style={{
                padding: '6px 10px', borderRadius: 6,
                background: 'transparent', border: '1px solid var(--border)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}>×</button>
            )}
          </div>
        ))}
        {outcomes.length < 10 && (
          <button type="button" onClick={addOutcome} style={{
            padding: '6px 12px', borderRadius: 6,
            background: 'transparent', border: '1px dashed var(--border)',
            color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            fontSize: 11, cursor: 'pointer', letterSpacing: '0.06em',
          }}>
            + agregar outcome
          </button>
        )}
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Fecha de cierre" hint="UTC — la ventana de trading se cierra aquí.">
          <input type="datetime-local" required value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Seed liquidity (display)" hint="No afecta la liquidez on-chain; sólo para la UI.">
          <input type="number" required min={100} value={seed} onChange={e => setSeed(e.target.value)} style={inputStyle()} />
        </Field>
      </div>

      <div style={{
        padding: 14, borderRadius: 10, background: 'var(--surface2)',
        border: '1px solid var(--border)', marginTop: 8, marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
          color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12,
        }}>
          Metadatos on-chain
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 10 }}>
          <Field label="Chain ID" hint="421614 = Arbitrum Sepolia">
            <input type="number" required min={1} value={chainId} onChange={e => setChainId(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Contract address" hint="La AMM ya desplegada.">
            <input type="text" required pattern="0x[a-fA-F0-9]{40}" value={chainAddress} onChange={e => setChainAddress(e.target.value)} style={inputStyle()} placeholder="0x…" />
          </Field>
          <Field label="Market ID (opcional)" hint="Índice dentro del contract (si aplica).">
            <input type="text" value={chainMarketId} onChange={e => setChainMarketId(e.target.value)} style={inputStyle()} placeholder="0 · 1 · …" />
          </Field>
        </div>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 0', marginTop: 6, marginBottom: 14,
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)',
      }}>
        <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
        Mostrar como destacado en el hero del /mvp.
      </label>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 12,
          background: notice.type === 'success' ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,69,0.08)',
          border: `1px solid ${notice.type === 'success' ? 'rgba(0,232,122,0.25)' : 'rgba(255,69,69,0.25)'}`,
          color: notice.type === 'success' ? 'var(--green)' : 'var(--red)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          {notice.msg}
        </div>
      )}

      <button type="submit" className="btn-primary" disabled={submitting} style={{ width: '100%' }}>
        {submitting ? 'Creando…' : 'Registrar mercado'}
      </button>
    </form>
  );
}

// ── Markets list with resolve action ────────────────────────────────────────
function MarketsList({ refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resolvingId, setResolvingId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { ok, data } = await getJson('/api/points/admin/markets?status=all&mode=onchain');
      if (!ok) throw new Error(data?.error || 'list_failed');
      setRows(Array.isArray(data?.markets) ? data.markets : []);
    } catch (e) {
      setError(e?.message || 'list_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function handleResolve(market) {
    const input = window.prompt(
      `Índice del outcome ganador para "${market.question}":\n\n` +
      market.outcomes.map((o, i) => `  ${i}: ${o}`).join('\n'),
    );
    if (input === null) return;
    const idx = Number.parseInt(input, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= market.outcomes.length) {
      alert('Índice inválido.');
      return;
    }
    setResolvingId(market.id);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/points/admin/resolve-market', {
        marketId: market.id,
        outcomeIndex: idx,
      });
      if (!ok) throw new Error(data?.error || 'resolve_failed');
      setNotice({ type: 'success', msg: `Resuelto: ${market.outcomes[idx]}` });
      load();
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'resolve_failed' });
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--text-primary)', letterSpacing: '0.03em', margin: 0 }}>
          Mercados on-chain ({rows.length})
        </h3>
        <button onClick={load} className="btn-ghost" style={{ fontSize: 11 }}>
          Refrescar
        </button>
      </div>

      {notice && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 12,
          background: notice.type === 'success' ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,69,0.08)',
          border: `1px solid ${notice.type === 'success' ? 'rgba(0,232,122,0.25)' : 'rgba(255,69,69,0.25)'}`,
          color: notice.type === 'success' ? 'var(--green)' : 'var(--red)',
          fontFamily: 'var(--font-mono)', fontSize: 12,
        }}>
          {notice.msg}
        </div>
      )}

      {loading && <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</div>}
      {error && <div style={{ padding: 16, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>Error: {error}</div>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          No hay mercados on-chain todavía.
        </div>
      )}

      {rows.map(m => (
        <div key={m.id} style={{
          padding: 14, border: '1px solid var(--border)', borderRadius: 10,
          background: 'var(--surface1)', marginBottom: 10,
          display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
        }}>
          <div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
              <span style={{ marginRight: 6 }}>{m.icon || '📈'}</span>
              {m.question}
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              <span>#{m.id}</span>
              <span>{(m.outcomes || []).length} outcomes</span>
              <span>
                {m.status === 'active' ? 'ACTIVO' : m.status === 'resolved' ? `✓ ${m.outcomes?.[m.outcome ?? 0] || 'resuelto'}` : m.status}
              </span>
              <span>{m.tradeCount || 0} trades</span>
              {m.chainAddress && (
                <span style={{ color: 'var(--green)' }}>
                  chain: {m.chainAddress.slice(0, 8)}…{m.chainAddress.slice(-6)}
                </span>
              )}
              {m.endTime && (
                <span>cierra {new Date(m.endTime).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {m.status === 'active' && (
              <button
                onClick={() => handleResolve(m)}
                disabled={resolvingId === m.id}
                className="btn-ghost"
                style={{ fontSize: 11, minWidth: 90 }}
              >
                {resolvingId === m.id ? '…' : 'Resolver'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page shell ──────────────────────────────────────────────────────────────
export default function Admin({ username, userIsAdmin, loading, onOpenLogin }) {
  const t = useT();
  const { authenticated } = usePointsAuth();
  const [refreshKey, setRefreshKey] = useState(0);

  const body = useMemo(() => {
    if (loading) return <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cargando…</p>;
    if (!authenticated) return (
      <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)' }}>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 14 }}>
          Inicia sesión para ver el panel administrativo.
        </p>
        <button className="btn-primary" onClick={onOpenLogin}>
          {t('nav.predict') || 'Iniciar sesión'}
        </button>
      </div>
    );
    if (!userIsAdmin) return (
      <div style={{ padding: 24, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface1)', color: 'var(--text-secondary)' }}>
        Tu usuario <strong>{username}</strong> no tiene permisos administrativos.
      </div>
    );
    return (
      <>
        <CreateMarketForm onCreated={() => setRefreshKey(k => k + 1)} />
        <MarketsList refreshKey={refreshKey} />
      </>
    );
  }, [authenticated, loading, onOpenLogin, refreshKey, t, userIsAdmin, username]);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />
      <main style={{ padding: '32px 48px 80px', maxWidth: 900, margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 6 }}>
            Admin · MVP
          </h1>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            Gestión exclusiva de mercados on-chain (Turnkey · Arbitrum Sepolia · MXNB).
          </p>
        </div>
        {body}
      </main>
      <Footer />
    </>
  );
}
