/**
 * Portfolio for the points-app.
 *
 * Two tabs: "Activo" (current positions) and "Historial" (all trades grouped
 * by market). Same visual structure as the MVP's Portfolio with USDC → MXNP
 * swapped and the on-chain sell flow replaced with a server-side call.
 *
 * Sidebar: live MXNP balance, streak, daily-claim card, mini leaderboard
 * preview. The campaign's earn/rewards section lives here too so logged-in
 * users have one dashboard for everything.
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import {
  fetchPositions,
  fetchHistory,
  fetchLeaderboard,
  quoteSell,
  executeSell,
  redeemWinnings,
  claimDaily,
  fetchDailyStatus,
} from '../lib/pointsApi.js';

function fmt(n) {
  const v = Number(n) || 0;
  const sign = v >= 0 ? '' : '-';
  return `${sign}${Math.abs(v).toFixed(2)}`;
}

// ─── Position card ───────────────────────────────────────────────────────────
function PositionCard({ position, onSell, onRedeem, selling, redeeming }) {
  const {
    marketId, outcomeLabel, question, shares, costBasis, currentPrice,
    currentValue, pnl, canRedeem, status,
  } = position;
  const pnlPos = pnl >= 0;

  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
        {question}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          background: 'var(--yes-dim, rgba(22,163,74,0.1))',
          color: 'var(--yes)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 600,
          padding: '3px 10px',
          borderRadius: 20,
          letterSpacing: '0.06em',
        }}>
          {outcomeLabel}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {Math.round((currentPrice || 0) * 100)}% prob
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
            INVERTIDO
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {fmt(costBasis)} MXNP
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
            VALOR ACTUAL
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
            {fmt(currentValue)} MXNP
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 2 }}>
            PnL
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: pnlPos ? 'var(--green)' : 'var(--red, #ef4444)' }}>
            {pnlPos ? '+' : ''}{fmt(pnl)}
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 10, paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
          {Number(shares).toFixed(2)} acciones
        </div>
        {canRedeem ? (
          <button
            className="btn-primary"
            onClick={() => onRedeem(position)}
            disabled={redeeming}
            style={{ padding: '8px 16px', fontSize: 11 }}
          >
            {redeeming ? 'Cobrando…' : '🏆 Cobrar ganancias'}
          </button>
        ) : status === 'active' ? (
          <button
            className="btn-ghost"
            onClick={() => onSell(position)}
            disabled={selling}
            style={{ padding: '8px 12px', fontSize: 11, cursor: selling ? 'wait' : 'pointer' }}
          >
            {selling ? 'Vendiendo…' : 'Vender anticipado'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── Daily claim card ────────────────────────────────────────────────────────
// Hydrates claim status on mount via /api/points/daily-status so when the
// user already claimed today the card hides itself entirely — per Fran's
// request, we want the sidebar to feel "done" after claiming rather than
// showing a disabled button. The claim card still appears on /earn with a
// greyed-out locked state, so the user can see the streak progression.
function DailyClaimCard({ onClaimed }) {
  // `status` = null → still loading, undefined payload → no check ran yet,
  // `{ alreadyClaimedToday: true, ... }` → already claimed (card hidden).
  const [status, setStatus] = useState(null);
  const [state, setState] = useState({ loading: false, msg: null, err: null });

  async function refreshStatus() {
    try {
      const r = await fetchDailyStatus();
      setStatus(r);
    } catch {
      setStatus({ alreadyClaimedToday: false });
    }
  }
  useEffect(() => { refreshStatus(); }, []);

  async function handle() {
    setState({ loading: true, msg: null, err: null });
    try {
      const r = await claimDaily();
      setState({ loading: false, msg: r.alreadyClaimedToday
        ? `Ya reclamaste hoy (+${r.amount} MXNP, racha ${r.streakDay})`
        : `+${r.amount} MXNP — Racha día ${r.streakDay} 🔥`, err: null });
      onClaimed?.(r);
      await refreshStatus(); // hides the card
    } catch (e) {
      setState({ loading: false, msg: null, err: e.code || e.message });
    }
  }

  // Hide the whole card once today's claim is locked in. The user can
  // still see their streak + history on /earn.
  if (status === null) {
    // Status probe still in flight — render a slim placeholder so the
    // sidebar doesn't flash-empty then flash-full.
    return (
      <div style={{ height: 4, marginBottom: 20 }} aria-hidden="true" />
    );
  }
  if (status.alreadyClaimedToday) return null;

  return (
    <div style={{
      background: 'rgba(0,232,122,0.05)',
      border: '1px solid rgba(0,232,122,0.28)',
      borderRadius: 14,
      padding: '18px 22px',
      marginBottom: 20,
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 8 }}>
        ⚡ Reclamo diario
      </div>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 12px' }}>
        Reclama tus MXNP diarios. Mantén la racha para ganar más cada día (+20 por cada día consecutivo).
      </p>
      {state.msg && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', marginBottom: 10 }}>
          {state.msg}
        </div>
      )}
      {state.err && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--red, #ef4444)', marginBottom: 10 }}>
          Error: {state.err}
        </div>
      )}
      <button
        className="btn-primary"
        onClick={handle}
        disabled={state.loading}
        style={{ width: '100%', padding: '11px 20px' }}
      >
        {state.loading ? 'Reclamando…' : 'Reclamar'}
      </button>
    </div>
  );
}

// ─── Mini leaderboard ─────────────────────────────────────────────────────
function MiniLeaderboard({ currentUsername }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    fetchLeaderboard().then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '18px 20px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
        🏆 Top predictores
      </div>
      {data.top.length === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          Aún no hay participantes — sé el primero.
        </div>
      )}
      {data.top.map(u => {
        const isMe = u.username === currentUsername;
        return (
          <div
            key={u.username}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: isMe ? 'var(--green)' : 'var(--text-secondary)',
            }}
          >
            <span style={{ width: 20, color: 'var(--text-muted)' }}>{u.rank}.</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isMe ? '(tú) ' : ''}{u.username}
            </span>
            <span style={{ color: u.pnl >= 0 ? 'var(--green)' : 'var(--red, #ef4444)', fontWeight: 700 }}>
              {u.pnl >= 0 ? '+' : ''}{fmt(u.pnl)}
            </span>
          </div>
        );
      })}
      {data.me && data.me.rank && data.me.rank > 10 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>
          Tu posición: #{data.me.rank} · {fmt(data.me.pnl)} MXNP
        </div>
      )}
    </div>
  );
}

// ─── Main Portfolio ──────────────────────────────────────────────────────────
export default function PointsPortfolio() {
  const navigate = useNavigate();
  const { authenticated, user, loading: authLoading, refresh } = usePointsAuth();
  const [tab, setTab] = useState('activo'); // 'activo' | 'historial'
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [historySummary, setHistorySummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionState, setActionState] = useState({ id: null, type: null });
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!authenticated) {
      navigate('/');
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, authenticated, tab]);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'activo') {
        const r = await fetchPositions();
        setPositions(r.positions || []);
        setSummary(r.summary || null);
      } else {
        const r = await fetchHistory();
        setHistory(r.history || []);
        setHistorySummary(r.summary || null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSell(pos) {
    setMsg(null);
    setActionState({ id: `${pos.marketId}-${pos.outcomeIndex}`, type: 'selling' });
    try {
      // Sell the full position. UX-wise, a more advanced flow would let users
      // pick an amount — for v1 a single "vender anticipado" button is enough.
      await executeSell({
        marketId: pos.marketId,
        outcomeIndex: pos.outcomeIndex,
        shares: pos.shares,
      });
      setMsg({ type: 'success', text: `Posición retirada (+${fmt(pos.currentValue)} MXNP estimado)` });
      await refresh();
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: `No se pudo vender: ${e.code || e.message}` });
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  async function handleRedeem(pos) {
    setMsg(null);
    setActionState({ id: `${pos.marketId}-${pos.outcomeIndex}`, type: 'redeeming' });
    try {
      const r = await redeemWinnings({ marketId: pos.marketId, outcomeIndex: pos.outcomeIndex });
      setMsg({ type: 'success', text: `🏆 Cobraste ${fmt(r.payout)} MXNP` });
      await refresh();
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: `No se pudo cobrar: ${e.code || e.message}` });
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  const balance = Number(user?.balance || 0);

  return (
    <main style={{ maxWidth: 1160, margin: '0 auto', padding: '60px 24px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(32px, 5vw, 52px)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}>
          Portafolio
        </h1>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'activo', label: 'Activo' },
          { id: 'historial', label: 'Historial' },
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

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 36, alignItems: 'start' }}>
        {/* Left: main content */}
        <div>
          {tab === 'activo' && (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 16,
                marginBottom: 32,
              }}>
                {[
                  { label: 'Balance', value: `${fmt(balance)} MXNP`, color: 'var(--green)' },
                  { label: 'En posiciones', value: `${fmt(summary?.currentValue || 0)} MXNP`, color: 'var(--text-primary)' },
                  { label: 'PnL total', value: `${(summary?.pnl || 0) >= 0 ? '+' : ''}${fmt(summary?.pnl || 0)}`, color: (summary?.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red, #ef4444)' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{
                    background: 'var(--surface1)', border: '1px solid var(--border)',
                    borderRadius: 12, padding: 20, textAlign: 'center',
                  }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
                      {label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, color }}>
                      {loading ? '…' : value}
                    </div>
                  </div>
                ))}
              </div>

              {msg && (
                <div style={{
                  background: msg.type === 'error' ? 'rgba(239,68,68,0.08)' : 'rgba(0,232,122,0.08)',
                  border: `1px solid ${msg.type === 'error' ? 'rgba(239,68,68,0.3)' : 'rgba(0,232,122,0.3)'}`,
                  color: msg.type === 'error' ? 'var(--red, #ef4444)' : 'var(--green)',
                  padding: '12px 14px', borderRadius: 10, marginBottom: 20,
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                }}>
                  {msg.text}
                </div>
              )}

              {loading && positions.length === 0 && (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                  Cargando posiciones…
                </div>
              )}
              {!loading && positions.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '60px 24px',
                  border: '1px dashed var(--border)', borderRadius: 16,
                }}>
                  <p style={{ fontSize: 32, marginBottom: 12 }}>🎯</p>
                  <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                    No tienes posiciones activas todavía.
                  </p>
                  <Link to="/" className="btn-primary" style={{ display: 'inline-block', marginTop: 20, textDecoration: 'none' }}>
                    Ver mercados
                  </Link>
                </div>
              )}
              {positions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {positions.map(p => {
                    const key = `${p.marketId}-${p.outcomeIndex}`;
                    return (
                      <PositionCard
                        key={key}
                        position={p}
                        onSell={handleSell}
                        onRedeem={handleRedeem}
                        selling={actionState.id === key && actionState.type === 'selling'}
                        redeeming={actionState.id === key && actionState.type === 'redeeming'}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'historial' && (
            <HistoryView history={history} summary={historySummary} loading={loading} />
          )}
        </div>

        {/* Right sidebar */}
        <aside style={{ position: 'sticky', top: 80, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <DailyClaimCard onClaimed={() => { refresh(); load(); }} />
          <MiniLeaderboard currentUsername={user?.username} />
        </aside>
      </div>
    </main>
  );
}

// ─── History view (inlined — mirrors MVP HistoryTab structure) ───────────────
function HistoryView({ history, summary, loading }) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        Cargando historial…
      </div>
    );
  }
  if (!history || history.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 24px',
        border: '1px dashed var(--border)', borderRadius: 16,
      }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>📜</p>
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Sin actividad aún.
        </p>
      </div>
    );
  }
  const totalPositive = (summary?.totalPnl ?? 0) >= 0;

  const statusMap = {
    won:     { label: '🏆 GANADO',    bg: 'rgba(0,232,122,0.12)',  color: 'var(--green)' },
    lost:    { label: 'PERDIDO',       bg: 'rgba(239,68,68,0.1)',   color: 'var(--red, #ef4444)' },
    exited:  { label: '↗ RETIRADO',    bg: 'rgba(148,163,184,0.08)', color: 'var(--text-secondary)' },
    pending: { label: '⏳ PENDIENTE',  bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' },
    open:    { label: 'EN CURSO',      bg: 'rgba(245,200,66,0.08)', color: 'var(--gold, #F5C842)' },
  };

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 18,
      }}>
        {[
          ['Mercados',   summary?.marketsTotal ?? 0, 'var(--text-primary)'],
          ['Ganados',    summary?.marketsWon ?? 0,   'var(--green)'],
          ['Perdidos',   summary?.marketsLost ?? 0,  'var(--red, #ef4444)'],
          ['Pendientes', summary?.marketsPending ?? 0, '#f59e0b'],
          ['Retirados',  summary?.marketsExited ?? 0, 'var(--text-secondary)'],
        ].map(([label, value, color]) => (
          <div key={label} style={{
            background: 'var(--surface1)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '12px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        {history.map(m => {
          const s = statusMap[m.outcomeStatus] || statusMap.open;
          const pnlPos = (m.netPnl || 0) >= 0;
          return (
            <div key={m.marketId} style={{
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', margin: 0, flex: 1, lineHeight: 1.4 }}>
                  {m.question}
                </p>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                  background: s.bg, color: s.color,
                  border: `1px solid ${s.color}40`,
                  padding: '3px 8px', borderRadius: 4, flexShrink: 0,
                }}>
                  {s.label}
                </span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
              }}>
                <span>{m.transactions?.length || 0} transaccion{(m.transactions?.length || 0) === 1 ? '' : 'es'}</span>
                {m.outcomeStatus !== 'lost' && (
                  <span style={{ color: pnlPos ? 'var(--green)' : 'var(--red, #ef4444)', fontWeight: 700 }}>
                    {pnlPos ? '+' : ''}{fmt(m.netPnl)} MXNP
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        background: totalPositive ? 'rgba(0,232,122,0.06)' : 'var(--surface1)',
        border: `1px solid ${totalPositive ? 'rgba(0,232,122,0.3)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>
            PnL Total
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
            Realizado + mark-to-market de posiciones activas
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 32,
          color: totalPositive ? 'var(--green)' : 'var(--text-secondary)',
        }}>
          {totalPositive ? '+' : ''}{fmt(summary?.totalPnl)}
        </div>
      </div>
    </>
  );
}
