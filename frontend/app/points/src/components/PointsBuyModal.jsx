/**
 * Buy flow for the points-app.
 *
 * The user enters an MXNP amount, we quote the trade server-side (which
 * runs the same AMM math the backend will use when it actually executes),
 * and show fee + shares-out + price-after. Confirm → POST /api/points/buy
 * → balance updates → modal closes.
 *
 * We intentionally keep this modal simple because the math is authoritative
 * on the server. No sell-flow here (sells live on the Portfolio page).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { quoteBuy, executeBuy } from '../lib/pointsApi.js';
import { usePointsAuth } from '@app/lib/pointsAuth.js';

const QUICK_AMOUNTS = [5, 10, 25, 50, 100];

export default function PointsBuyModal({ open, market, outcomeIndex, outcomeLabel, onClose, onSuccess }) {
  const { user, refresh } = usePointsAuth();
  const [amount, setAmount] = useState('10');
  const [quote, setQuote] = useState(null);
  const [quoteState, setQuoteState] = useState('idle'); // idle | loading | ready | error
  const [quoteError, setQuoteError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState(false);

  const balance = Number(user?.balance || 0);
  const numAmount = parseFloat(amount) || 0;
  const insufficientBalance = numAmount > balance;

  // Debounced quote — re-request when the amount changes
  useEffect(() => {
    if (!open || numAmount <= 0 || !market?.id) {
      setQuote(null);
      setQuoteState('idle');
      return;
    }
    let cancelled = false;
    setQuoteState('loading');
    setQuoteError('');
    const handle = setTimeout(() => {
      quoteBuy({ marketId: market.id, outcomeIndex, collateral: numAmount })
        .then(q => {
          if (cancelled) return;
          setQuote(q);
          setQuoteState('ready');
        })
        .catch(e => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(e.code || e.message || 'quote_failed');
          setQuoteState('error');
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, numAmount, market?.id, outcomeIndex]);

  if (!open || !market) return null;

  async function handleConfirm() {
    if (submitting || !quote) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await executeBuy({ marketId: market.id, outcomeIndex, collateral: numAmount });
      await refresh();
      setSuccess(true);
      // Give the user a beat to see the success state, then close.
      setTimeout(() => {
        setSuccess(false);
        onSuccess?.();
      }, 900);
    } catch (e) {
      setSubmitError(e.code || e.message || 'buy_failed');
    } finally {
      setSubmitting(false);
    }
  }

  const isYes = outcomeIndex === 0;
  const accent = isYes ? 'var(--yes)' : '#ff3b3b';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        width: 'min(440px, 92vw)',
        background: 'var(--surface1)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '28px 26px',
        fontFamily: 'var(--font-body)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '0.14em', color: 'var(--text-muted)',
              textTransform: 'uppercase', marginBottom: 4,
            }}>
              Comprar
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: accent, letterSpacing: '0.02em' }}>
              {outcomeLabel?.toUpperCase()}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: 20,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
          {market.question}
        </p>

        {/* Balance + amount */}
        <div style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>Balance</span>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>
            {balance.toLocaleString('es-MX')} MXNP
          </span>
        </div>

        <label style={{
          display: 'block',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 6,
        }}>
          Monto (MXNP)
        </label>
        <input
          type="number"
          min="1"
          step="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={submitting}
          style={{
            width: '100%',
            background: 'var(--surface2)',
            border: `1px solid ${insufficientBalance ? 'rgba(255,59,59,0.5)' : 'var(--border)'}`,
            borderRadius: 10,
            padding: '12px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 18,
            color: 'var(--text-primary)',
            outline: 'none',
            marginBottom: 10,
          }}
        />

        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {QUICK_AMOUNTS.map(v => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              disabled={submitting || v > balance}
              style={{
                flex: 1,
                padding: '8px 0',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: v > balance ? 'var(--text-muted)' : 'var(--text-secondary)',
                cursor: v > balance ? 'not-allowed' : 'pointer',
                opacity: v > balance ? 0.4 : 1,
              }}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Quote card */}
        <div style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 14,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          <QuoteRow label="Comisión" value={
            quoteState === 'ready' ? `${quote.fee.toFixed(2)} MXNP (${quote.feePct.toFixed(2)}%)` :
            quoteState === 'loading' ? 'Calculando…' :
            '—'
          } />
          <QuoteRow label="Acciones que recibes" value={
            quoteState === 'ready' ? `${quote.sharesOut.toFixed(2)}` :
            quoteState === 'loading' ? 'Calculando…' :
            '—'
          } bold accent={accent} />
          <QuoteRow label="Ganancia si aciertas" value={
            quoteState === 'ready' ? `+${Math.max(0, quote.sharesOut - numAmount).toFixed(2)} MXNP` :
            '—'
          } good />
          <QuoteRow label="Precio tras la compra" value={
            quoteState === 'ready' ? `${Math.round(quote.priceBefore * 100)}% → ${Math.round(quote.priceAfter * 100)}%` :
            '—'
          } />
          {quoteState === 'error' && (
            <div style={{ color: 'var(--red, #ef4444)', fontSize: 11, marginTop: 8 }}>
              No se pudo calcular el precio ({quoteError}).
            </div>
          )}
        </div>

        {insufficientBalance && (
          <div style={{
            background: 'rgba(255,59,59,0.08)',
            border: '1px solid rgba(255,59,59,0.3)',
            color: '#ff3b3b',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
          }}>
            ⚠️ Balance insuficiente. Tienes {balance.toLocaleString('es-MX')} MXNP.
          </div>
        )}

        {submitError && (
          <div style={{
            background: 'rgba(255,59,59,0.08)',
            border: '1px solid rgba(255,59,59,0.3)',
            color: '#ff3b3b',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            padding: '10px 12px',
            borderRadius: 8,
            marginBottom: 12,
          }}>
            {mapError(submitError)}
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={submitting || insufficientBalance || quoteState !== 'ready' || numAmount <= 0}
          style={{
            width: '100%',
            padding: '14px 16px',
            background: success ? 'var(--green)' : accent,
            color: '#000',
            border: 'none',
            borderRadius: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            cursor: submitting || insufficientBalance || quoteState !== 'ready' ? 'not-allowed' : 'pointer',
            opacity: submitting || insufficientBalance || quoteState !== 'ready' ? 0.6 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {success ? '✓ Compra realizada' :
           submitting ? 'Enviando…' :
           insufficientBalance ? 'Balance insuficiente' :
           `Comprar ${numAmount || '—'} MXNP`}
        </button>
      </div>
    </div>
  );
}

function QuoteRow({ label, value, bold, accent, good }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '5px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        color: accent || (good ? 'var(--green)' : 'var(--text-primary)'),
        fontWeight: bold ? 700 : 400,
      }}>
        {value}
      </span>
    </div>
  );
}

function mapError(code) {
  if (!code) return 'Algo salió mal.';
  if (typeof code !== 'string') return String(code);
  if (code.includes('insufficient')) return 'Balance insuficiente.';
  if (code.includes('not_authenticated')) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (code.includes('market_closed')) return 'El mercado cerró o se resolvió.';
  if (code.includes('market_not_found')) return 'Mercado no encontrado.';
  return `Error: ${code}`;
}
