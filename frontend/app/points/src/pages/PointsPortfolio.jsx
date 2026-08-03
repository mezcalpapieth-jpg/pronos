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
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import { useT } from '@app/lib/i18n.js';
import { historyPnlValue } from '../lib/historyPnl.js';
import { buildSellPreview } from '../lib/sellPreview.js';
import { HistorySkeleton, LeaderboardSkeleton, PositionSkeleton } from '../components/PointsSkeleton.jsx';
import {
  fetchPositions,
  fetchHistory,
  fetchLeaderboard,
  fetchCycleHistory,
  quoteSell,
  executeSell,
  redeemWinnings,
  claimDaily,
  fetchDailyStatus,
  dismissPosition,
} from '../lib/pointsApi.js';

function fmt(n) {
  const v = Number(n) || 0;
  const sign = v >= 0 ? '' : '-';
  return `${sign}${Math.abs(v).toFixed(2)}`;
}

function signedFmt(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(2)}`;
}

function portfolioMarketHref(item) {
  const id = item?.parentMarketId || item?.marketId;
  return id ? `/market?id=${encodeURIComponent(id)}` : null;
}

function SellPreviewModal({ state, onClose, onConfirm }) {
  if (!state) return null;
  const { position, preview, loading, error, submitting } = state;
  const salePositive = Number(preview?.salePnl || 0) >= 0;
  const impactNegative = Number(preview?.slippageMxnp || 0) < 0;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0,0,0,0.68)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
    >
      <div style={{
        width: 'min(520px, 100%)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '26px 24px',
        boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              color: 'var(--orange)',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}>
              Venta anticipada
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              lineHeight: 1.1,
              margin: 0,
              color: 'var(--text-primary)',
            }}>
              {position?.outcomeLabel}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 22,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            x
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.45, margin: '0 0 18px' }}>
          {position?.question}
        </p>

        {loading ? (
          <div style={{
            padding: '28px 0',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)',
            fontSize: 12,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}>
            Calculando salida real...
          </div>
        ) : error ? (
          <div style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.35)',
            color: 'var(--red, #ef4444)',
            borderRadius: 12,
            padding: '14px 16px',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            No se pudo calcular la venta: {error}
          </div>
        ) : (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 10,
              marginBottom: 14,
            }}>
              {[
                ['VALOR MARCADO', `${fmt(preview.markValue)} MXNP`, 'var(--text-primary)'],
                ['SALIDA REAL', `${fmt(preview.collateralOut)} MXNP`, 'var(--green)'],
                ['PNL MARCADO', `${signedFmt(preview.markPnl)} MXNP`, preview.markPnl >= 0 ? 'var(--green)' : 'var(--red, #ef4444)'],
                ['PNL AL VENDER', `${signedFmt(preview.salePnl)} MXNP`, salePositive ? 'var(--green)' : 'var(--red, #ef4444)'],
              ].map(([label, value, color]) => (
                <div key={label} style={{
                  background: 'var(--surface2)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: '13px 14px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: 'var(--text-muted)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 16,
                    color,
                    fontWeight: 800,
                  }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              background: 'rgba(255,91,26,0.07)',
              border: '1px solid rgba(255,91,26,0.28)',
              borderRadius: 12,
              padding: '13px 14px',
              marginBottom: 18,
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--orange)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 7,
              }}>
                IMPACTO POR LIQUIDEZ
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                La venta mueve el mercado de {fmt(preview.priceBeforePct)}% a {fmt(preview.priceAfterPct)}%.
                {' '}Recibes {signedFmt(preview.slippageMxnp)} MXNP contra el valor marcado
                {' '}({signedFmt(preview.slippagePct)}%).
              </div>
              {impactNegative && (
                <div style={{
                  marginTop: 8,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  lineHeight: 1.5,
                }}>
                  El PnL real usa la salida del AMM, no el valor marcado antes de vender.
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
            style={{ padding: '10px 14px', fontSize: 12 }}
          >
            Cancelar
          </button>
          <button
            className="btn-primary"
            onClick={onConfirm}
            disabled={!preview || loading || error || submitting}
            style={{ padding: '10px 16px', fontSize: 12, cursor: submitting ? 'wait' : 'pointer' }}
          >
            {submitting ? 'Vendiendo...' : 'Confirmar venta'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Position card ───────────────────────────────────────────────────────────
function PositionCard({ position, onSell, onRedeem, onDismiss, selling, redeeming, dismissing }) {
  const {
    marketId, outcomeLabel, question, shares, costBasis, currentPrice,
    currentValue, pnl, canRedeem, status,
  } = position;
  const pnlPos = pnl >= 0;
  // Losing resolved position: the market is settled, this outcome
  // didn't win, so there's nothing to redeem or sell. Offer an OK
  // button to acknowledge the loss and clear it from the Active tab.
  const isLostBet = status === 'resolved' && !canRedeem;
  const marketHref = portfolioMarketHref(position);

  return (
    <div className="points-position-card">
      {marketHref ? (
        <Link
          to={marketHref}
          className="points-portfolio-market-link"
          style={{ fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.4, margin: 0 }}
        >
          {question || `Mercado #${marketId}`}
        </Link>
      ) : (
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.4, margin: 0 }}>
          {question || `Mercado #${marketId}`}
        </p>
      )}

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

      <div className="points-position-metrics">
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

      <div className="points-position-actions">
        <div style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{Number(shares).toFixed(2)} acciones</span>
          {marketHref && (
            <Link to={marketHref} className="points-portfolio-market-action">
              Ver mercado
            </Link>
          )}
        </div>
        {canRedeem ? (
          <button
            className="btn-primary"
            onClick={() => onRedeem(position)}
            disabled={redeeming}
            style={{ padding: '8px 16px', fontSize: 11 }}
          >
            {redeeming ? 'Cobrando…' : 'Cobrar ganancias'}
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
        ) : isLostBet ? (
          <button
            onClick={() => onDismiss?.(position)}
            disabled={dismissing}
            title="Reconocer la pérdida y mover a Historial"
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: dismissing ? 'wait' : 'pointer',
              opacity: dismissing ? 0.6 : 1,
            }}
          >
            {dismissing ? 'Cerrando…' : 'OK'}
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
        : `+${r.amount} MXNP — Racha día ${r.streakDay}`, err: null });
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
    <div className="points-daily-claim-card">
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--green)', marginBottom: 8 }}>
        Reclamo diario
      </div>
      <p className="points-daily-claim-copy">
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
// Each row is now a button → /u/:username, and there's a search input
// above the list that jumps to whatever username the user types. Both
// route to the public PointsUserProfile page.
function MiniLeaderboard({ currentUsername }) {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    fetchLeaderboard().then(setData).catch(() => setData(null));
  }, []);

  function gotoProfile(username) {
    const clean = String(username || '').trim().toLowerCase();
    if (!clean) return;
    navigate(`/u/${encodeURIComponent(clean)}`, {
      state: { from: `${location.pathname}${location.search}${location.hash}` || '/portfolio' },
    });
  }
  function onSearchSubmit(e) {
    e.preventDefault();
    gotoProfile(search);
  }

  if (!data) {
    return (
      <div className="points-sidebar-card">
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
          Top predictores
        </div>
        <LeaderboardSkeleton rows={4} />
      </div>
    );
  }
  return (
    <div className="points-sidebar-card">
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12 }}>
        Top predictores
      </div>

      {/* Username search — Enter submits to /u/:username. Untyped strings
          land on the 404 state, which has a Volver button. */}
      <form
        onSubmit={onSearchSubmit}
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 12,
        }}
      >
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar usuario…"
          autoComplete="off"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 10px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            background: 'var(--green)',
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '6px 12px',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontWeight: 700,
          }}
        >
          Ver
        </button>
      </form>

      {data.top.length === 0 && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          Aún no hay participantes — sé el primero.
        </div>
      )}
      {data.top.map(u => {
        const isMe = u.username === currentUsername;
        const delta = Number(u.cycleDelta ?? 0);
        const deltaPos = delta >= 0;
        return (
          <button
            key={u.username}
            type="button"
            onClick={() => gotoProfile(u.username)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 0',
              borderBottom: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: isMe ? 'var(--green)' : 'var(--text-secondary)',
              background: 'transparent',
              border: 'none',
              borderBottomColor: 'var(--border)',
              borderBottomWidth: 1,
              borderBottomStyle: 'solid',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
              transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 20, color: 'var(--text-muted)' }}>{u.rank}.</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {isMe ? '(tú) ' : ''}{u.username}
            </span>
            <span
              title={`${deltaPos ? '+' : ''}${fmt(delta)} MXNP desde el inicio del ciclo`}
              style={{ color: 'var(--text-primary)', fontWeight: 700 }}
            >
              {fmt(u.balance)}
            </span>
            <span style={{
              width: 56,
              textAlign: 'right',
              fontSize: 10,
              color: deltaPos ? 'var(--green)' : 'var(--red, #ef4444)',
            }}>
              {deltaPos ? '+' : ''}{fmt(delta)}
            </span>
          </button>
        );
      })}
      {data.me && data.me.rank && data.me.rank > 10 && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>
          Tu posición: #{data.me.rank} · {fmt(data.me.balance)} MXNP
        </div>
      )}
    </div>
  );
}

// ─── Past-cycle history leaderboard ───────────────────────────────────────
// One collapsible card per closed cycle, each showing the snapshotted
// top 10 (rank, username, final balance, final pnl). The most-recent
// cycle is expanded by default; older ones are collapsed so the side-
// bar stays scannable. Data comes from /api/points/cycles/history,
// which already returns rank<=10 per cycle.
function CycleHistoryLeaderboard({ currentUsername }) {
  const [cycles, setCycles] = useState(null);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    fetchCycleHistory(6)
      .then(rows => {
        const arr = Array.isArray(rows) ? rows : (rows?.cycles || []);
        setCycles(arr);
        if (arr.length > 0) setOpenId(arr[0].id);
      })
      .catch(() => setCycles([]));
  }, []);
  if (!cycles) {
    return (
      <div className="points-sidebar-card">
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          letterSpacing: '0.1em', color: 'var(--text-muted)',
          textTransform: 'uppercase', marginBottom: 12,
        }}>
          Ciclos anteriores
        </div>
        <LeaderboardSkeleton rows={3} />
      </div>
    );
  }
  if (cycles.length === 0) return null;
  return (
    <div className="points-sidebar-card">
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 10,
        letterSpacing: '0.1em', color: 'var(--text-muted)',
        textTransform: 'uppercase', marginBottom: 12,
      }}>
        Ciclos anteriores
      </div>
      {cycles.map(cycle => {
        const isOpen = openId === cycle.id;
        const top = Array.isArray(cycle.top) ? cycle.top : [];
        return (
          <div key={cycle.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 8 }}>
            <button
              onClick={() => setOpenId(isOpen ? null : cycle.id)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '6px 0',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-primary)',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cycle.label || `Ciclo #${cycle.id}`}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div style={{ marginTop: 4 }}>
                {top.length === 0 && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>
                    Sin ganadores registrados.
                  </div>
                )}
                {top.map(row => {
                  const isMe = row.username === currentUsername;
                  const pnl = Number(row.finalPnl ?? 0);
                  const pnlPos = pnl >= 0;
                  return (
                    <div
                      key={`${cycle.id}-${row.rank}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '4px 0',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: isMe ? 'var(--green)' : 'var(--text-secondary)',
                      }}
                    >
                      <span style={{ width: 20, color: 'var(--text-muted)' }}>{row.rank}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isMe ? '(tú) ' : ''}{row.username}
                      </span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                        {fmt(Number(row.finalBalance))}
                      </span>
                      <span style={{
                        width: 56,
                        textAlign: 'right',
                        fontSize: 10,
                        color: pnlPos ? 'var(--green)' : 'var(--red, #ef4444)',
                      }}>
                        {pnlPos ? '+' : ''}{fmt(pnl)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Portfolio ──────────────────────────────────────────────────────────
export default function PointsPortfolio() {
  const navigate = useNavigate();
  const t = useT();
  const { authenticated, user, loading: authLoading, refresh } = usePointsAuth();
  const [tab, setTab] = useState('activo'); // 'activo' | 'historial'
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [historySummary, setHistorySummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionState, setActionState] = useState({ id: null, type: null });
  const [sellPreview, setSellPreview] = useState(null);
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
    setSellPreview({ position: pos, loading: true, error: null, preview: null, quote: null, submitting: false });
    try {
      const quote = await quoteSell({
        marketId: pos.marketId,
        outcomeIndex: pos.outcomeIndex,
        shares: pos.shares,
      });
      const preview = buildSellPreview(pos, quote);
      setSellPreview({ position: pos, quote, preview, loading: false, error: null, submitting: false });
    } catch (e) {
      setSellPreview({ position: pos, loading: false, error: e.code || e.message || 'quote_failed', preview: null, quote: null, submitting: false });
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  async function confirmSellPreview() {
    if (!sellPreview?.position || !sellPreview?.preview || sellPreview.submitting) return;
    const pos = sellPreview.position;
    const preview = sellPreview.preview;
    const key = `${pos.marketId}-${pos.outcomeIndex}`;
    setMsg(null);
    setActionState({ id: key, type: 'selling' });
    setSellPreview(prev => prev ? { ...prev, submitting: true, error: null } : prev);
    try {
      await executeSell({
        marketId: pos.marketId,
        outcomeIndex: pos.outcomeIndex,
        shares: pos.shares,
        minCollateralOut: preview.minCollateralOut,
      });
      setMsg({
        type: 'success',
        text: `Posición retirada: ${fmt(preview.collateralOut)} MXNP (${signedFmt(preview.salePnl)} PnL)`,
      });
      setSellPreview(null);
      await refresh();
      await load();
    } catch (e) {
      setSellPreview(prev => prev ? {
        ...prev,
        submitting: false,
        error: e.code === 'price_moved'
          ? 'El precio se movió. Cierra y vuelve a cotizar.'
          : (e.code || e.message || 'sell_failed'),
      } : prev);
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  async function handleRedeem(pos) {
    setMsg(null);
    setActionState({ id: `${pos.marketId}-${pos.outcomeIndex}`, type: 'redeeming' });
    try {
      const r = await redeemWinnings({ marketId: pos.marketId, outcomeIndex: pos.outcomeIndex });
      setMsg({ type: 'success', text: `Cobraste ${fmt(r.payout)} MXNP` });
      await refresh();
      await load();
    } catch (e) {
      setMsg({ type: 'error', text: `No se pudo cobrar: ${e.code || e.message}` });
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  // Acknowledge a losing resolved position. Drops it off the Active
  // tab immediately (optimistic) and persists via
  // /api/points/dismiss-position so the dismissal stays across
  // devices. Trade history in the Historial tab is untouched.
  async function handleDismiss(pos) {
    const key = `${pos.marketId}-${pos.outcomeIndex}`;
    // Optimistic removal — server guard ensures we only hide
    // losing resolved positions, so if something goes wrong we
    // refetch to restore state.
    setPositions(prev => prev.filter(p =>
      !(p.marketId === pos.marketId && p.outcomeIndex === pos.outcomeIndex),
    ));
    setActionState({ id: key, type: 'dismissing' });
    try {
      await dismissPosition({ marketId: pos.marketId, outcomeIndex: pos.outcomeIndex });
    } catch (e) {
      setMsg({ type: 'error', text: `No se pudo cerrar: ${e.code || e.message}` });
      await load(); // rollback
    } finally {
      setActionState({ id: null, type: null });
    }
  }

  const balance = Number(user?.balance || 0);

  return (
    <>
    <main className="points-portfolio-page">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(32px, 5vw, 52px)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          marginBottom: 8,
        }}>
          {t('points.portfolio.title')}
        </h1>
      </div>

      {/* Tabs */}
      <div className="points-portfolio-tabs">
        {[
          { id: 'activo', label: t('points.portfolio.tab.open') },
          { id: 'historial', label: t('points.portfolio.tab.history') },
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

      <div className="points-portfolio-layout">
        {/* Left: main content */}
        <div className="points-portfolio-main">
          {tab === 'activo' && (
            <>
              <div className="points-portfolio-stats">
                {[
                  { label: 'Balance', value: `${fmt(balance)} MXNP`, color: 'var(--green)' },
                  { label: 'En posiciones', value: `${fmt(summary?.currentValue || 0)} MXNP`, color: 'var(--text-primary)' },
                  { label: 'PnL total', value: `${(summary?.pnl || 0) >= 0 ? '+' : ''}${fmt(summary?.pnl || 0)}`, color: (summary?.pnl || 0) >= 0 ? 'var(--green)' : 'var(--red, #ef4444)' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="points-portfolio-stat-card">
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 8, textTransform: 'uppercase' }}>
                      {label}
                    </div>
                    <div className="points-portfolio-stat-value" style={{ color }}>
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

              {loading && positions.length === 0 && <PositionSkeleton count={2} />}
              {!loading && positions.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '60px 24px',
                  border: '1px dashed var(--border)', borderRadius: 16,
                }}>
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
                        onDismiss={handleDismiss}
                        selling={actionState.id === key && actionState.type === 'selling'}
                        redeeming={actionState.id === key && actionState.type === 'redeeming'}
                        dismissing={actionState.id === key && actionState.type === 'dismissing'}
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
        <aside className="points-portfolio-sidebar">
          <DailyClaimCard onClaimed={() => { refresh(); load(); }} />
          <MiniLeaderboard currentUsername={user?.username} />
          <CycleHistoryLeaderboard currentUsername={user?.username} />
        </aside>
      </div>
    </main>
    <SellPreviewModal
      state={sellPreview}
      onClose={() => {
        if (!sellPreview?.submitting) setSellPreview(null);
      }}
      onConfirm={confirmSellPreview}
    />
    </>
  );
}

// ─── History view (inlined — mirrors MVP HistoryTab structure) ───────────────
function HistoryView({ history, summary, loading }) {
  if (loading) {
    return <HistorySkeleton count={4} />;
  }
  if (!history || history.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 24px',
        border: '1px dashed var(--border)', borderRadius: 16,
      }}>
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Sin actividad aún.
        </p>
      </div>
    );
  }
  const totalPositive = (summary?.totalPnl ?? 0) >= 0;

  const statusMap = {
    won:     { label: 'GANADO',       bg: 'rgba(0,232,122,0.12)',  color: 'var(--green)' },
    lost:    { label: 'PERDIDO',       bg: 'rgba(239,68,68,0.1)',   color: 'var(--red, #ef4444)' },
    exited:  { label: '↗ RETIRADO',    bg: 'rgba(148,163,184,0.08)', color: 'var(--text-secondary)' },
    canceled:{ label: 'ANULADO',        bg: 'rgba(148,163,184,0.08)', color: 'var(--text-secondary)' },
    pending: { label: 'PENDIENTE',    bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' },
    open:    { label: 'EN CURSO',      bg: 'rgba(245,200,66,0.08)', color: 'var(--gold, #F5C842)' },
  };

  return (
    <>
      <div className="points-history-summary-grid">
        {[
          ['Mercados',   summary?.marketsTotal ?? 0, 'var(--text-primary)'],
          ['Ganados',    summary?.marketsWon ?? 0,   'var(--green)'],
          ['Perdidos',   summary?.marketsLost ?? 0,  'var(--red, #ef4444)'],
          ['Pendientes', summary?.marketsPending ?? 0, '#f59e0b'],
          ['Anulados',   summary?.marketsCanceled ?? 0, 'var(--text-secondary)'],
        ].map(([label, value, color]) => (
          <div key={label} className="points-history-summary-card">
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
          const pnl = historyPnlValue(m);
          const pnlPos = pnl >= 0;
          const marketHref = portfolioMarketHref(m);
          return (
            <div key={m.marketId} style={{
              background: 'var(--surface1)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 18px',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
                {marketHref ? (
                  <Link
                    to={marketHref}
                    className="points-portfolio-market-link"
                    style={{ fontFamily: 'var(--font-body)', fontSize: 14, margin: 0, flex: 1, lineHeight: 1.4 }}
                  >
                    {m.question || `Mercado #${m.marketId}`}
                  </Link>
                ) : (
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', margin: 0, flex: 1, lineHeight: 1.4 }}>
                    {m.question || `Mercado #${m.marketId}`}
                  </p>
                )}
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
                <span style={{ color: pnlPos ? 'var(--green)' : 'var(--red, #ef4444)', fontWeight: 700 }}>
                  {pnlPos ? '+' : ''}{fmt(pnl)} MXNP
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="points-history-total-card"
        style={{
          background: totalPositive ? 'rgba(0,232,122,0.06)' : 'var(--surface1)',
          borderColor: totalPositive ? 'rgba(0,232,122,0.3)' : 'var(--border)',
        }}
      >
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
