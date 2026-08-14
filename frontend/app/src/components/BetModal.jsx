/**
 * MVP BetModal — Turnkey delegated signing.
 *
 * The UI posts {marketId, outcomeIndex, collateral} to /api/protocol/buy
 * which routes through Turnkey-signed tx via _lib/onchain-trader.js.
 * The points-app has its own modal (PointsBuyModal) that talks to the
 * off-chain /api/points/buy endpoint — these two flows are completely
 * separate now (the points-app's MXNP ledger is never on-chain).
 *
 * Quotes come from /api/protocol/quote-buy, then confirmation sends
 * minSharesOut/maxAvgPrice guards to /api/protocol/buy. The contract
 * also receives the min-output guard so mined transactions cannot drift
 * below the preview tolerance.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

const QUICK_AMOUNTS = [5, 10, 25, 50];

const STEPS = {
  IDLE:     'idle',
  QUOTING:  'quoting',    // fetching live quote for slippage preview
  PLACING:  'placing',    // POST /api/protocol/buy
  SUCCESS:  'success',
  ERROR:    'error',
};

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

export default function BetModal({
  open,
  onClose,
  outcome,
  outcomePct,
  outcomeIndex = 0,
  marketId,
  marketTitle,
  market = null,
  onOpenLogin,
  variant = 'modal',
}) {
  const t = useT();
  const { authenticated, user, refresh } = usePointsAuth();

  const [amount, setAmount]     = useState('');
  const [step, setStep]         = useState(STEPS.IDLE);
  const [statusMsg, setStatusMsg] = useState('');
  const [txHash, setTxHash]     = useState(null);
  const [quote, setQuote]       = useState(null);
  const [quoteError, setQuoteError] = useState('');

  const numAmount = parseFloat(amount) || 0;
  const isQuoting = step === STEPS.QUOTING;
  const isLoading = step === STEPS.PLACING;
  const isDrawer = variant === 'drawer';

  const balance = typeof user?.balance === 'number' ? user.balance : null;
  // Every market the MVP shows is on-chain (the off-chain MXNP ledger
  // lives in the points-app, not here). Keeping the flag as a constant
  // so the existing UI conditionals continue to compile without spread
  // changes; can be deleted once they're cleaned up.
  const isOnchain = true;

  useEffect(() => {
    if (!open || !marketId || numAmount <= 0) {
      setQuote(null);
      setQuoteError('');
      setStep(current => (current === STEPS.QUOTING ? STEPS.IDLE : current));
      return undefined;
    }
    let cancelled = false;
    setQuote(null);
    setQuoteError('');
    setStep(current => (
      current === STEPS.PLACING || current === STEPS.SUCCESS ? current : STEPS.QUOTING
    ));
    const handle = setTimeout(() => {
      postJson('/api/protocol/quote-buy', {
        marketId,
        outcomeIndex,
        collateral: numAmount,
      }).then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setQuote(null);
          setQuoteError(data?.error || 'quote_failed');
        } else {
          setQuote(data);
          setQuoteError('');
        }
        setStep(current => (current === STEPS.QUOTING ? STEPS.IDLE : current));
      }).catch((e) => {
        if (cancelled) return;
        setQuote(null);
        setQuoteError(e?.message || 'quote_failed');
        setStep(current => (current === STEPS.QUOTING ? STEPS.IDLE : current));
      });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, marketId, outcomeIndex, numAmount]);

  if (!open) return null;

  // Derived display fields — prefer the live quote, fall back to naive math.
  const feePct      = quote?.feePct ?? 2;
  const fee         = quote?.fee ?? (numAmount * feePct / 100);
  const naivePayout = outcomePct > 0 && numAmount > 0
    ? (numAmount - fee) / (outcomePct / 100)
    : null;
  const payout      = quote?.payout ?? quote?.sharesOut ?? (naivePayout !== null ? naivePayout : '—');
  const profit      = quote?.profit ?? (typeof payout === 'number' ? payout - numAmount : '—');
  const impliedPct = quote?.currentPrice !== undefined ? Math.round(quote.currentPrice * 100) : outcomePct;
  const postPct    = quote?.postTradePrice !== undefined && quote?.postTradePrice !== null
    ? Math.round(quote.postTradePrice * 100)
    : null;
  const slippagePts = quote?.priceImpactPts ?? 0;
  const highSlippage = Math.abs(slippagePts) >= 5;

  async function handleBet() {
    if (!authenticated) {
      onOpenLogin?.();
      return;
    }
    if (numAmount <= 0) {
      setStep(STEPS.ERROR);
      setStatusMsg(t('bet.invalidAmount'));
      return;
    }
    if (balance !== null && balance < numAmount && !isOnchain) {
      setStep(STEPS.ERROR);
      setStatusMsg(t('bet.insufficient', { bal: balance.toFixed(2) }));
      return;
    }
    if (!quote) {
      setStep(STEPS.ERROR);
      setStatusMsg(t('bet.previewUnavailable') || 'No se pudo cotizar el mercado. Intenta otra vez.');
      return;
    }

    // Compute slippage bounds from the most recent quote. If no quote was
    // fetched (preview unavailable), skip the guard — the server will still
    // accept the trade but we can't protect the user from drift.
    const minShares = quote?.sharesOut ? Number(quote.sharesOut) * 0.98 : null;
    const maxPrice  = quote?.avgPrice ? Number(quote.avgPrice) * 1.02 : null;

    setStep(STEPS.PLACING);
    setStatusMsg(t('bet.placingProtocol') || t('bet.placing'));
    setTxHash(null);

    try {
      const { ok, data } = await postJson('/api/protocol/buy', {
        marketId,
        outcomeIndex,
        collateral: numAmount,
        ...(minShares !== null ? { minSharesOut: minShares } : {}),
        ...(maxPrice !== null ? { maxAvgPrice: maxPrice } : {}),
      });

      if (!ok) {
        const code = data?.error || 'buy_failed';
        setStep(STEPS.ERROR);
        setStatusMsg(code === 'price_moved'
          ? 'El precio se movió. Refresca la vista previa e intenta otra vez.'
          : `Error: ${code}${data?.detail ? ` · ${data.detail}` : ''}`);
        return;
      }

      // On-chain result carries a txHash; points-mode returns sharesOut only.
      setTxHash(data?.txHash || null);
      setStep(STEPS.SUCCESS);
      setStatusMsg(t('bet.placed', { amt: numAmount, outcome }));
      setAmount('');
      // Refresh the session so the balance in the nav updates.
      refresh?.().catch(() => {});
    } catch (e) {
      setStep(STEPS.ERROR);
      setStatusMsg(e?.message || 'Error al colocar orden.');
    }
  }

  const handleClose = () => {
    setStep(STEPS.IDLE);
    setStatusMsg('');
    setTxHash(null);
    setQuote(null);
    onClose();
  };

  const buttonLabel = () => {
    if (!authenticated)             return t('bet.btn.join');
    if (step === STEPS.QUOTING)     return t('bet.btn.checking');
    if (step === STEPS.PLACING)     return t('bet.btn.placing');
    if (step === STEPS.SUCCESS)     return t('bet.btn.success');
    if (numAmount > 0)              return t('bet.btn.buyAmount', { amt: numAmount });
    return t('bet.btn.buy');
  };

  const overlay = (
    <div
      className="bet-modal-overlay show"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
        e.stopPropagation();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      style={isDrawer ? {
        alignItems: 'stretch',
        justifyContent: 'flex-end',
      } : undefined}
    >
      <div
        className="bet-modal-box"
        style={isDrawer ? {
          width: 'min(440px, 92vw)',
          maxWidth: 'min(440px, 92vw)',
          height: '100vh',
          overflowY: 'auto',
          borderRadius: 0,
          animation: 'mvp-drawer-slide-in 0.22s ease-out',
        } : undefined}
      >
        <div className="bet-modal-header">
          <span className="bet-modal-title">{t('bet.title')}</span>
          <button className="bet-modal-close" onClick={handleClose}>✕</button>
        </div>

        {/* Outcome tag */}
        <div className="bet-outcome-tag">
          <span className="bet-outcome-label">{outcome}</span>
          <span className="bet-outcome-pct">{impliedPct}%</span>
        </div>

        {marketTitle && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            {marketTitle}
          </p>
        )}

        {/* Mode chip */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderRadius: 999,
          background: isOnchain ? 'rgba(59,130,246,0.12)' : 'rgba(0,232,122,0.10)',
          border: `1px solid ${isOnchain ? 'rgba(59,130,246,0.35)' : 'rgba(0,232,122,0.35)'}`,
          color: isOnchain ? '#60a5fa' : 'var(--green)',
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 14,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isOnchain ? '#60a5fa' : 'var(--green)',
          }} />
          {isOnchain ? 'On-chain · Turnkey' : 'Off-chain · MXNP'}
        </div>

        {/* Balance */}
        {authenticated && balance !== null && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', borderRadius: 8, background: 'var(--surface2)',
            marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('bet.balance')}</span>
            <span style={{ color: balance > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              ${balance.toFixed(2)} {isOnchain ? 'MXNB' : 'MXNP'}
            </span>
          </div>
        )}

        {/* Amount input */}
        <div className="bet-amount-wrap">
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
            {t('bet.amount')}
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>$</span>
            <input
              type="number" min="1" step="1"
              value={amount}
              onChange={e => { setAmount(e.target.value); if (step === STEPS.ERROR) setStep(STEPS.IDLE); }}
              placeholder="0"
              className="bet-amount-input"
              style={{ width: '100%', paddingLeft: 28 }}
              disabled={isLoading || step === STEPS.SUCCESS}
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
              disabled={isLoading || step === STEPS.SUCCESS}
            >
              ${a}
            </button>
          ))}
        </div>

        {/* Payout info */}
        {numAmount > 0 && (
          <div className="bet-payout-info">
            <div className="bet-payout-row">
              <span>{t('bet.fee', { pct: Number(feePct).toFixed(2) })}</span>
              <span style={{ opacity: 0.6 }}>-${Number(fee).toFixed(2)}</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.estimatedPayout')}</span>
              <span className="green">${typeof payout === 'number' ? payout.toFixed(2) : payout}</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.profit')}</span>
              <span className="green">+${typeof profit === 'number' ? profit.toFixed(2) : profit}</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.implied')}</span>
              <span>{impliedPct}%</span>
            </div>
            {postPct !== null && (
              <div className="bet-payout-row">
                <span>{t('bet.priceAfter')}</span>
                <span style={{ color: highSlippage ? 'var(--red)' : 'var(--text-secondary)' }}>
                  {impliedPct}% → {postPct}%
                </span>
              </div>
            )}
            {quote && (
              <div className="bet-payout-row">
                <span>{t('bet.slippage')}</span>
                <span style={{
                  color: highSlippage ? 'var(--red)' : 'var(--text-secondary)',
                  fontWeight: highSlippage ? 700 : 400,
                }}>
                  {slippagePts >= 0 ? '+' : ''}{Number(slippagePts).toFixed(1)} pts
                </span>
              </div>
            )}
            {quoteError && (
              <div className="bet-payout-row">
                <span>{t('bet.slippage')}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {t('bet.previewUnavailable')}
                </span>
              </div>
            )}
          </div>
        )}

        {numAmount > 0 && highSlippage && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: 'rgba(255,69,69,0.08)',
            border: '1px solid rgba(255,69,69,0.3)',
            color: 'var(--red)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            {t('bet.warn.lowVolume', { start: impliedPct, end: postPct, pts: Math.abs(slippagePts).toFixed(1) })}
          </div>
        )}

        {/* Step progress */}
        {(isLoading || step === STEPS.SUCCESS || step === STEPS.ERROR) && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: step === STEPS.SUCCESS ? 'rgba(0,232,122,0.08)'
                      : step === STEPS.ERROR   ? 'rgba(255,69,69,0.08)'
                      : 'rgba(255,255,255,0.04)',
            border: `1px solid ${
              step === STEPS.SUCCESS ? 'rgba(0,232,122,0.25)'
            : step === STEPS.ERROR   ? 'rgba(255,69,69,0.25)'
            : 'var(--border)'}`,
            color: step === STEPS.SUCCESS ? 'var(--green)'
                 : step === STEPS.ERROR   ? 'var(--red)'
                 : 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}>
            {isLoading && <span style={{ marginRight: 8 }}>⏳</span>}
            {step === STEPS.SUCCESS && <span style={{ marginRight: 8 }}>✅</span>}
            {step === STEPS.ERROR   && <span style={{ marginRight: 8 }}>❌</span>}
            {statusMsg}
            {txHash && (
              <div style={{ marginTop: 4, opacity: 0.6, fontSize: 10, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                tx: {txHash.slice(0, 18)}…{txHash.slice(-8)}
              </div>
            )}
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: '100%', opacity: step === STEPS.SUCCESS ? 0.7 : 1 }}
          onClick={step === STEPS.SUCCESS ? handleClose : handleBet}
          disabled={isLoading || isQuoting}
        >
          {buttonLabel()}
        </button>

        {authenticated && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
            {isOnchain
              ? 'Firmado por Turnkey bajo tu política delegada.'
              : 'Trade off-chain con MXNP.'}
          </p>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(overlay, document.body)
    : overlay;
}
