import React, { useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';

const QUICK_AMOUNTS = [5, 10, 25, 50];

export default function BetModal({ open, onClose, outcome, outcomePct, marketId, marketTitle }) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);

  if (!open) return null;

  const numAmount = parseFloat(amount) || 0;
  const payout = outcomePct > 0 ? (numAmount / (outcomePct / 100)).toFixed(2) : '—';
  const profit = outcomePct > 0 ? (numAmount / (outcomePct / 100) - numAmount).toFixed(2) : '—';

  const handleBet = async () => {
    if (!authenticated) {
      login();
      return;
    }
    if (numAmount <= 0) {
      setStatus({ type: 'error', msg: 'Ingresa un monto válido.' });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      // Placeholder: actual on-chain tx would go here via contract.js
      await new Promise(r => setTimeout(r, 1200));
      setStatus({ type: 'success', msg: `¡Apuesta colocada! ${numAmount} USDC en "${outcome}"` });
      setAmount('');
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || 'Error al colocar apuesta.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bet-modal-overlay show" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bet-modal-box">
        <div className="bet-modal-header">
          <span className="bet-modal-title">COLOCAR APUESTA</span>
          <button className="bet-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Outcome tag */}
        <div className="bet-outcome-tag">
          <span className="bet-outcome-label">{outcome}</span>
          <span className="bet-outcome-pct">{outcomePct}%</span>
        </div>

        {marketTitle && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            {marketTitle}
          </p>
        )}

        {/* Amount input */}
        <div className="bet-amount-wrap">
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
            MONTO (USDC)
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>$</span>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0"
              className="bet-amount-input"
              style={{ width: '100%', paddingLeft: 28 }}
            />
          </div>
        </div>

        {/* Quick amounts */}
        <div className="bet-quick-btns">
          {QUICK_AMOUNTS.map(a => (
            <button
              key={a}
              className={`bet-quick-btn${numAmount === a ? ' active' : ''}`}
              onClick={() => setAmount(String(a))}
            >
              ${a}
            </button>
          ))}
        </div>

        {/* Payout info */}
        {numAmount > 0 && (
          <div className="bet-payout-info">
            <div className="bet-payout-row">
              <span>Pago estimado</span>
              <span className="green">${payout} USDC</span>
            </div>
            <div className="bet-payout-row">
              <span>Ganancia potencial</span>
              <span className="green">+${profit} USDC</span>
            </div>
            <div className="bet-payout-row">
              <span>Probabilidad implícita</span>
              <span>{outcomePct}%</span>
            </div>
          </div>
        )}

        {status && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: status.type === 'success' ? 'rgba(0,232,122,0.08)' : 'rgba(255,69,69,0.08)',
            border: `1px solid ${status.type === 'success' ? 'rgba(0,232,122,0.25)' : 'rgba(255,69,69,0.25)'}`,
            color: status.type === 'success' ? 'var(--green)' : 'var(--red)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            marginBottom: 16,
          }}>
            {status.msg}
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: '100%' }}
          onClick={handleBet}
          disabled={loading}
        >
          {loading ? 'PROCESANDO…' : authenticated ? `APOSTAR ${numAmount > 0 ? `$${numAmount} USDC` : ''}` : 'CONECTAR PARA APOSTAR'}
        </button>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
          Las apuestas se ejecutan on-chain en Polygon
        </p>
      </div>
    </div>
  );
}
