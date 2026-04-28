/**
 * MVP Portfolio — Turnkey-era.
 *
 * Positions + balance + history all come from the points API. There's no
 * direct wallet read anymore — the backend mirrors on-chain state from the
 * indexer (and DB-locked state for mode='points' markets). Selling goes
 * through /api/points/sell which routes to Turnkey-signed tx for
 * mode='onchain' and to the DB AMM for mode='points'.
 *
 * Two tabs: Activo (open positions) and Historial (all trades).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav.jsx';
import Footer from '../components/Footer.jsx';
import EarnMXNP from '../components/EarnMXNP.jsx';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

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

function formatNum(n, digits = 2) {
  if (!Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(digits);
}

function formatDeadline(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
}

function PositionRow({ pos, onSell, busy }) {
  const t = useT();
  const navigate = useNavigate();
  const label = pos.outcomeLabel || `Opción ${Number(pos.outcomeIndex) + 1}`;
  const pl = pos.unrealizedPnl ?? ((Number(pos.currentValue || 0) - Number(pos.costBasis || 0)));
  const plPct = pos.costBasis > 0 ? (pl / Number(pos.costBasis)) * 100 : 0;

  return (
    <div style={{
      padding: 16,
      border: '1px solid var(--border)',
      borderRadius: 12,
      background: 'var(--surface1)',
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: 16,
      alignItems: 'center',
      marginBottom: 10,
    }}>
      <div>
        <div
          onClick={() => navigate(`/market?id=${pos.marketId}`)}
          style={{ cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}
          role="button"
          tabIndex={0}
        >
          {pos.question || `Market #${pos.marketId}`}
        </div>
        <div style={{ display: 'flex', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>{label} · {formatNum(pos.shares, 4)} shares</span>
          <span>costo ${formatNum(pos.costBasis)}</span>
          <span>ahora ${formatNum(pos.currentValue)}</span>
          <span style={{ color: pl >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {pl >= 0 ? '+' : ''}{formatNum(pl)} ({plPct >= 0 ? '+' : ''}{formatNum(plPct, 1)}%)
          </span>
        </div>
      </div>
      <button
        className="btn-ghost"
        onClick={() => onSell(pos)}
        disabled={busy}
        style={{ minWidth: 90 }}
      >
        {busy ? '…' : t('pf.sell') || 'Vender'}
      </button>
    </div>
  );
}

function HistoryRow({ trade }) {
  const side = trade.side === 'buy' ? 'Compra' : trade.side === 'sell' ? 'Venta' : trade.side;
  const color = trade.side === 'buy' ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{
      padding: '12px 16px',
      border: '1px solid var(--border)',
      borderRadius: 10,
      background: 'var(--surface1)',
      marginBottom: 8,
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      gap: 12,
      alignItems: 'center',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.1em',
        padding: '4px 8px',
        borderRadius: 6,
        background: 'var(--surface2)',
        color,
        textTransform: 'uppercase',
      }}>
        {side}
      </span>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--text-primary)' }}>
        {trade.question || `Market #${trade.marketId}`}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {formatNum(trade.shares, 4)} shares @ {formatNum(trade.priceAtTrade * 100, 1)}¢ · {formatDeadline(trade.createdAt)}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>
        ${formatNum(trade.collateral)}
        {trade.txHash && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            tx {String(trade.txHash).slice(0, 8)}…
          </div>
        )}
      </div>
    </div>
  );
}

export default function Portfolio({ onOpenLogin }) {
  const t = useT();
  const { authenticated, user, loading: authLoading, refresh } = usePointsAuth();
  const [positions, setPositions] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('activo');
  const [sellingId, setSellingId] = useState(null);
  const [notice, setNotice] = useState(null);

  const loadAll = useCallback(async () => {
    if (!authenticated) return;
    setLoading(true);
    setError(null);
    try {
      const [posRes, histRes] = await Promise.all([
        getJson('/api/points/positions?mode=onchain'),
        getJson('/api/points/history?mode=onchain'),
      ]);
      setPositions(Array.isArray(posRes.data?.positions) ? posRes.data.positions : []);
      setHistory(Array.isArray(histRes.data?.trades) ? histRes.data.trades : []);
    } catch (e) {
      setError(e?.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [authenticated]);

  useEffect(() => {
    if (authenticated) loadAll();
  }, [authenticated, loadAll]);

  async function handleSell(pos) {
    const confirmMsg = `¿Vender ${formatNum(pos.shares, 4)} acciones de "${pos.outcomeLabel || pos.question}"?`;
    if (!window.confirm(confirmMsg)) return;
    setSellingId(`${pos.marketId}-${pos.outcomeIndex}`);
    setNotice(null);
    try {
      const { ok, data } = await postJson('/api/points/sell', {
        marketId: pos.marketId,
        outcomeIndex: pos.outcomeIndex,
        shares: pos.shares,
      });
      if (!ok) throw new Error(data?.error || 'sell_failed');
      setNotice({ type: 'success', msg: `Vendido por $${formatNum(data?.collateralOut)}.` });
      await Promise.all([loadAll(), refresh?.()]);
    } catch (e) {
      setNotice({ type: 'error', msg: e?.message || 'sell_failed' });
    } finally {
      setSellingId(null);
    }
  }

  const openPositions = useMemo(() => positions.filter(p => Number(p.shares) > 1e-6), [positions]);

  return (
    <>
      <Nav onOpenLogin={onOpenLogin} />

      <main style={{
        padding: 'clamp(20px, 4vw, 32px) clamp(14px, 4vw, 48px) 56px',
        maxWidth: 1100,
        margin: '0 auto',
      }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.04em', color: 'var(--text-primary)', marginBottom: 10 }}>
            {t('pf.title') || 'Mi Portafolio'}
          </h1>
          {authenticated && user?.balance !== undefined && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
              Balance: <strong style={{ color: 'var(--green)' }}>${formatNum(user.balance)}</strong>
            </div>
          )}
        </div>

        {!authenticated && !authLoading && (
          <div style={{
            padding: 40, textAlign: 'center',
            border: '1px solid var(--border)', borderRadius: 14,
            background: 'var(--surface1)',
          }}>
            <p style={{ fontFamily: 'var(--font-body)', color: 'var(--text-secondary)', marginBottom: 14 }}>
              Inicia sesión para ver tus posiciones.
            </p>
            <button className="btn-primary" onClick={onOpenLogin}>
              {t('nav.predict') || 'Iniciar sesión'}
            </button>
          </div>
        )}

        {authenticated && (
          <>
            {/* Tabs */}
            <div style={{
              display: 'flex', gap: 2, marginBottom: 20,
              borderBottom: '1px solid var(--border)',
            }}>
              {['activo', 'historial'].map(tab => (
                <button
                  key={tab}
                  className={activeTab === tab ? 'tab active' : 'tab'}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '10px 18px',
                    color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === tab ? '2px solid var(--green)' : '2px solid transparent',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  {tab}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <Link to="/" style={{
                alignSelf: 'center',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: 'var(--text-muted)',
                padding: '10px 18px',
              }}>
                ← {t('pf.backToMarkets') || 'volver'}
              </Link>
            </div>

            {notice && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 16,
                background: notice.type === 'success' ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,69,0.08)',
                border: `1px solid ${notice.type === 'success' ? 'rgba(0,232,122,0.25)' : 'rgba(255,69,69,0.25)'}`,
                color: notice.type === 'success' ? 'var(--green)' : 'var(--red)',
                fontFamily: 'var(--font-mono)', fontSize: 12,
              }}>
                {notice.msg}
              </div>
            )}

            {loading && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Cargando…
              </div>
            )}
            {error && (
              <div style={{ padding: 20, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
                Error: {error}
              </div>
            )}

            {!loading && !error && activeTab === 'activo' && (
              <div>
                {openPositions.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No tienes posiciones abiertas todavía.
                  </div>
                ) : (
                  openPositions.map(pos => (
                    <PositionRow
                      key={`${pos.marketId}-${pos.outcomeIndex}`}
                      pos={pos}
                      onSell={handleSell}
                      busy={sellingId === `${pos.marketId}-${pos.outcomeIndex}`}
                    />
                  ))
                )}
              </div>
            )}

            {!loading && !error && activeTab === 'historial' && (
              <div>
                {history.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Aún no hay transacciones.
                  </div>
                ) : (
                  history.map((trade, i) => (
                    <HistoryRow key={trade.id || `${trade.marketId}-${i}`} trade={trade} />
                  ))
                )}
              </div>
            )}

            {/* Socials + referrals — plumbing only, no rewards credited until mainnet. */}
            <EarnMXNP />
          </>
        )}
      </main>

      <Footer />
    </>
  );
}
