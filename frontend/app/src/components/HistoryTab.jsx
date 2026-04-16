/**
 * HistoryTab — Full transaction history for the Portfolio page.
 *
 * Shows every market the user has traded, grouped by market, with
 * each market's transactions expandable underneath. Markets show:
 *   - won:    green "+$X.XX" badge, full transaction list
 *   - lost:   no amount (user's request), "Perdido" label only
 *   - exited: purple "+$X.XX" or "-$X.XX" (early exit with PnL)
 *   - open:   "En curso" label (still active — rare in history tab)
 *
 * Data source: /api/history?address=0x...
 */
import React, { useState, useEffect } from 'react';
import { useT } from '../lib/i18n.js';

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-MX', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtMoney(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '$0.00';
  return `$${x.toFixed(2)}`;
}

// Per-market status pill + PnL chip
function MarketOutcomeBadge({ market }) {
  const { outcomeStatus, netPnl } = market;

  if (outcomeStatus === 'won') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          background: 'rgba(0,232,122,0.12)', color: 'var(--green)',
          border: '1px solid rgba(0,232,122,0.3)',
          padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
        }}>
          🏆 GANADO
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
          color: 'var(--green)',
        }}>
          +{fmtMoney(netPnl)}
        </span>
      </div>
    );
  }

  if (outcomeStatus === 'lost') {
    return (
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        background: 'rgba(239,68,68,0.1)', color: 'var(--red, #ef4444)',
        border: '1px solid rgba(239,68,68,0.25)',
        padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
      }}>
        PERDIDO
      </span>
    );
  }

  if (outcomeStatus === 'exited') {
    const pos = netPnl >= 0;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          background: 'rgba(148,163,184,0.08)', color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
          padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
        }}>
          ↗ RETIRADO
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700,
          color: pos ? 'var(--green)' : 'var(--text-secondary)',
        }}>
          {pos ? '+' : ''}{fmtMoney(netPnl)}
        </span>
      </div>
    );
  }

  if (outcomeStatus === 'pending') {
    // Market deadline passed but oracle/admin hasn't resolved yet.
    // Show orange "pendiente" — never "perdido" until resolution lands.
    return (
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
        background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
        border: '1px solid rgba(245,158,11,0.3)',
        padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
      }}>
        ⏳ PENDIENTE
      </span>
    );
  }

  // open — user still holds, deadline in the future
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      background: 'rgba(245,200,66,0.08)', color: 'var(--gold, #F5C842)',
      border: '1px solid rgba(245,200,66,0.25)',
      padding: '3px 8px', borderRadius: 4, textTransform: 'uppercase',
    }}>
      EN CURSO
    </span>
  );
}

function TransactionRow({ tx }) {
  const isBuy = tx.side === 'buy';
  const isSell = tx.side === 'sell';
  const isRedeem = tx.side === 'redeem';
  const pct = Math.round((tx.priceAtTrade ?? 0) * 100);

  let label, labelColor, amountColor, amountPrefix;
  if (isBuy) {
    label = '↓ Compra';
    labelColor = 'var(--green)';
    amountColor = 'var(--text-primary)';
    amountPrefix = '-';
  } else if (isSell) {
    label = '↑ Venta';
    labelColor = 'var(--text-secondary)';
    amountColor = 'var(--green)';
    amountPrefix = '+';
  } else {
    // redeem
    label = '🏆 Cobro';
    labelColor = 'var(--green)';
    amountColor = 'var(--green)';
    amountPrefix = '+';
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(80px, 90px) 1fr minmax(90px, 110px) minmax(90px, 110px)',
      alignItems: 'center',
      gap: 10,
      padding: '8px 14px',
      borderTop: '1px solid var(--border)',
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
    }}>
      <span style={{
        color: labelColor,
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
      <span style={{ color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--text-primary)', marginRight: 6 }}>{tx.outcomeLabel || '—'}</span>
        {!isRedeem && <>· {pct}%</>}
        {isRedeem && <span style={{ opacity: 0.8 }}>· redención on-chain</span>}
        <span style={{ marginLeft: 6, opacity: 0.7 }}>
          · {formatDate(tx.createdAt)}
        </span>
      </span>
      <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
        {Number(tx.shares || 0).toFixed(2)} shs
      </span>
      <span style={{
        color: amountColor,
        textAlign: 'right',
        fontWeight: 600,
      }}>
        {amountPrefix}{fmtMoney(tx.collateral)}
      </span>
    </div>
  );
}

function MarketHistoryCard({ market }) {
  const [expanded, setExpanded] = useState(false);
  const { question, totalInvested, totalReceived, transactions, outcomeStatus, winningOutcomeLabel } = market;

  return (
    <div style={{
      background: 'var(--surface1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Collapsed header (always visible) */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '16px 18px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Top row: market title + outcome badge */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            margin: 0,
            flex: 1,
            minWidth: 0,
          }}>
            {question}
          </p>
          <div style={{ flexShrink: 0 }}>
            <MarketOutcomeBadge market={market} />
          </div>
        </div>

        {/* Bottom row: summary stats */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            {transactions.length} transacci{transactions.length === 1 ? 'ón' : 'ones'}
            {outcomeStatus === 'won' && winningOutcomeLabel && (
              <span style={{ marginLeft: 10, color: 'var(--green)' }}>
                · Ganó {winningOutcomeLabel}
              </span>
            )}
            {outcomeStatus === 'lost' && winningOutcomeLabel && (
              <span style={{ marginLeft: 10, opacity: 0.7 }}>
                · Ganó {winningOutcomeLabel}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
              Invertido: <strong style={{ color: 'var(--text-secondary)' }}>{fmtMoney(totalInvested)}</strong>
            </span>
            {outcomeStatus !== 'lost' && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                Recibido: <strong style={{ color: 'var(--text-secondary)' }}>{fmtMoney(totalReceived)}</strong>
              </span>
            )}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}>
              ▸
            </span>
          </div>
        </div>
      </div>

      {/* Expanded transactions list */}
      {expanded && (
        <div style={{ background: 'var(--surface0, var(--surface2))' }}>
          <div style={{
            padding: '6px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: 'var(--text-muted)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            borderTop: '1px solid var(--border)',
          }}>
            TRANSACCIONES
          </div>
          {transactions.map((tx, i) => (
            <TransactionRow key={tx.id || i} tx={tx} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function HistoryTab({ address }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/history?address=${encodeURIComponent(address)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [address]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        Cargando historial…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: 13,
        padding: '20px', background: 'var(--red-dim)', borderRadius: 10,
      }}>
        Error: {error}
      </div>
    );
  }

  const history = data?.history || [];
  const summary = data?.summary || {};

  if (history.length === 0) {
    return (
      <div style={{
        textAlign: 'center', padding: '60px 24px',
        border: '1px dashed var(--border)', borderRadius: 16,
      }}>
        <p style={{ fontSize: 32, marginBottom: 12 }}>📜</p>
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
          Sin actividad aún. Cuando operes en un mercado, tu historial aparecerá aquí.
        </p>
      </div>
    );
  }

  const totalPositive = (summary.totalPnl ?? 0) >= 0;

  return (
    <div>
      {/* Quick stats row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 10,
        marginBottom: 18,
      }}>
        {[
          { label: 'Mercados',   value: summary.marketsTotal ?? 0,   color: 'var(--text-primary)' },
          { label: 'Ganados',    value: summary.marketsWon ?? 0,     color: 'var(--green)' },
          { label: 'Perdidos',   value: summary.marketsLost ?? 0,    color: 'var(--red, #ef4444)' },
          { label: 'Pendientes', value: summary.marketsPending ?? 0, color: '#f59e0b' },
          { label: 'Retirados',  value: summary.marketsExited ?? 0,  color: 'var(--text-secondary)' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            background: 'var(--surface1)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '12px 10px',
            textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
              {label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color, letterSpacing: '0.02em' }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Market history list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
        {history.map(market => (
          <MarketHistoryCard key={market.marketId} market={market} />
        ))}
      </div>

      {/* Total Profit footer */}
      <div style={{
        background: totalPositive ? 'rgba(0,232,122,0.06)' : 'var(--surface1)',
        border: `1px solid ${totalPositive ? 'rgba(0,232,122,0.3)' : 'var(--border)'}`,
        borderRadius: 14,
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--text-muted)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            Ganancia total
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}>
            Suma de todos los retiros y ganancias netas
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 36,
          color: totalPositive ? 'var(--green)' : 'var(--text-secondary)',
          letterSpacing: '0.02em',
        }}>
          {totalPositive ? '+' : ''}{fmtMoney(summary.totalPnl)}
        </div>
      </div>
    </div>
  );
}
