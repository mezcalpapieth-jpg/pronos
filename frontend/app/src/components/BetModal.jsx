/**
 * MVP BetModal — Turnkey delegated signing.
 *
 * The UI posts {marketId, outcomeIndex, collateral, minSharesOut, maxAvgPrice}
 * to /api/points/buy. When the market's `mode === 'onchain'`, the backend
 * routes through Turnkey-signed tx via _lib/onchain-trader.js; when mode is
 * `points`, it goes through the DB-locked AMM path. The client doesn't care
 * which — response shape is identical.
 *
 * Slippage guards: the client sends a preview snapshot (minSharesOut,
 * maxAvgPrice) based on the last quote so the server can short-circuit with
 * `price_moved` if the market drifted. Preview comes from /api/points/quote-buy
 * which walks the same AMM math the server uses.
 */
import React, { useEffect, useState } from 'react';
import { usePointsAuth } from '../lib/pointsAuth.js';
import { useT } from '../lib/i18n.js';

const QUICK_AMOUNTS = [5, 10, 25, 50];

const STEPS = {
  IDLE:     'idle',
  QUOTING:  'quoting',    // fetching live quote for slippage preview
  PLACING:  'placing',    // POST /api/points/buy
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

async function postJsonWithQuery(url, body) {
  return postJson(url, body);
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
  const isLoading = step === STEPS.QUOTING || step === STEPS.PLACING;

  const balance = typeof user?.balance === 'number' ? user.balance : null;
  const chainMode = market?.mode === 'onchain' ? 'onchain' : 'points';
  const isOnchain = chainMode === 'onchain';

  // Fetch a live slippage quote when the amount changes. Debounced lightly
  // so typing doesn't fire a quote per keystroke. Gives us priceBefore,
  // priceAfter, feePct, sharesOut — surfaced in the preview box below.
  useEffect(() => {
    if (!open || !marketId || numAmount <= 0) {
      setQuote(null);
      setQuoteError('');
      return;
    }
    let alive = true;
    const id = setTimeout(async () => {
      setStep(STEPS.QUOTING);
      setQuoteError('');
      try {
        const { ok, data } = await postJsonWithQuery('/api/points/quote-buy', {
          marketId,
          outcomeIndex,
          collateral: numAmount,
        });
        if (!alive) return;
        if (!ok) {
          setQuote(null);
          setQuoteError(data?.error || 'preview_unavailable');
        } else {
          setQuote(data);
        }
      } catch (e) {
        if (!alive) return;
        setQuote(null);
        setQuoteError(e?.message || 'preview_unavailable');
      } finally {
        if (alive) setStep(STEPS.IDLE);
      }
    }, 220);
    return () => { alive = false; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, marketId, outcomeIndex, numAmount]);

  if (!open) return null;

  // Derived display fields — prefer the live quote, fall back to naive math.
  const feePct     = quote?.feePct ?? 2;
  const fee        = quote?.fee ?? (numAmount * feePct / 100);
  const payout     = quote?.payout ?? (outcomePct > 0 && numAmount > 0
    ? ((numAmount - fee) / (outcomePct / 100)).toFixed(2)
    : '—');
  const profit     = quote?.profit ?? (typeof payout === 'number' ? (payout - numAmount).toFixed(2) : '—');
  const impliedPct = quote?.currentPrice !== undefined ? Math.round(quote.currentPrice * 100) : outcomePct;
  const postPct    = quote?.postTradePrice !== undefined ? Math.round(quote.postTradePrice * 100) : null;
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

    // Compute slippage bounds from the most recent quote. If no quote was
    // fetched (preview unavailable), skip the guard — the server will still
    // accept the trade but we can't protect the user from drift.
    const minShares = quote?.sharesOut ? Number(quote.sharesOut) * 0.98 : null;
    const maxPrice  = quote?.avgPrice ? Number(quote.avgPrice) * 1.02 : null;

    setStep(STEPS.PLACING);
    setStatusMsg(isOnchain ? t('bet.placingProtocol') : t('bet.placing'));
    setTxHash(null);

    try {
      const { ok, data } = await postJson('/api/points/buy', {
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

  return (
    <div className="bet-modal-overlay show" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bet-modal-box">
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
          disabled={isLoading}
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
}
