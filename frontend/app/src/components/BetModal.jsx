import React, { useEffect, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import {
  approveOutcomeTokens,
  approveUsdc,
  buildMarketQuote,
  deriveClobApiKey,
  getOrderBook,
  getOutcomeTokenApproval,
  getOutcomeTokenSpender,
  getUsdcAllowance,
  getUsdcBalance,
  getUsdcSpender,
  placeClobOrder,
} from '../lib/clob.js';

const BUY_QUICK_AMOUNTS = [5, 10, 25, 50];
const SELL_QUICK_ACTIONS = [
  { label: '25%', fraction: 0.25 },
  { label: '50%', fraction: 0.5 },
  { label: 'MAX', fraction: 1 },
];

const STEPS = {
  IDLE: 'idle',
  CHECKING: 'checking',
  APPROVING: 'approving',
  SIGNING: 'signing',
  PLACING: 'placing',
  SUCCESS: 'success',
  ERROR: 'error',
};

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatInputAmount(value) {
  const normalized = Math.max(Number(value) || 0, 0);
  return normalized % 1 === 0 ? String(normalized) : normalized.toFixed(2);
}

export default function BetModal({
  open,
  onClose,
  onSuccess,
  outcome,
  outcomePct,
  marketId,
  marketTitle,
  clobTokenId,
  isNegRisk = false,
  mode = 'buy',
  positionSize = 0,
}) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState(STEPS.IDLE);
  const [statusMsg, setStatusMsg] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [book, setBook] = useState(null);
  const [bookError, setBookError] = useState('');

  const isSell = mode === 'sell';
  const side = isSell ? 'SELL' : 'BUY';
  const numAmount = parseFloat(amount) || 0;
  const tokenId = clobTokenId || marketId;
  const quote = book ? buildMarketQuote(book, side, numAmount) : null;
  const isLoading = [STEPS.CHECKING, STEPS.APPROVING, STEPS.SIGNING, STEPS.PLACING].includes(step);
  const canTrade = !!tokenId && !!book && !bookError;
  const displayBalance = isSell ? Number(positionSize || 0) : balance;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadModalState() {
      setBook(null);
      setBookError('');

      if (tokenId) {
        try {
          const nextBook = await getOrderBook(tokenId);
          if (!cancelled) setBook(nextBook);
        } catch (error) {
          if (!cancelled) setBookError(error.message || 'No se pudo cargar la liquidez');
        }
      } else {
        setBookError('Este mercado no tiene token activo para trading.');
      }

      if (!authenticated) return;

      const wallet = wallets?.[0];
      if (!wallet) return;

      try {
        const provider = new ethers.providers.Web3Provider(await wallet.getEthereumProvider());
        const address = await provider.getSigner().getAddress();
        if (isSell) {
          if (!cancelled) setBalance(Number(positionSize || 0));
          return;
        }

        const nextBalance = await getUsdcBalance(provider, address);
        if (!cancelled) setBalance(nextBalance);
      } catch (_) {
        if (!cancelled) setBalance(null);
      }
    }

    loadModalState();
    return () => { cancelled = true; };
  }, [authenticated, isSell, open, positionSize, tokenId, wallets]);

  if (!open) return null;

  async function handleTrade() {
    if (!authenticated) {
      login();
      return;
    }

    if (numAmount <= 0) {
      setStep(STEPS.ERROR);
      setStatusMsg(isSell ? 'Ingresa cuántas shares quieres vender.' : 'Ingresa un monto válido.');
      return;
    }

    if (!tokenId) {
      setStep(STEPS.ERROR);
      setStatusMsg('Este mercado todavía no tiene trading habilitado.');
      return;
    }

    if (bookError) {
      setStep(STEPS.ERROR);
      setStatusMsg(bookError);
      return;
    }

    if (!quote?.enoughLiquidity) {
      setStep(STEPS.ERROR);
      setStatusMsg(isSell
        ? 'No hay suficiente liquidez compradora para ese tamaño.'
        : 'No hay suficiente liquidez vendedora para ese monto.');
      return;
    }

    const wallet = wallets?.[0];
    if (!wallet) {
      setStep(STEPS.ERROR);
      setStatusMsg('No se encontró wallet. Reconecta tu cuenta.');
      return;
    }

    try {
      setStep(STEPS.CHECKING);
      setStatusMsg('Verificando balance y permisos…');

      const ethProvider = await wallet.getEthereumProvider();
      const provider = new ethers.providers.Web3Provider(ethProvider);
      const signer = provider.getSigner();
      const address = await signer.getAddress();

      if (isSell) {
        if (numAmount > Number(positionSize || 0)) {
          setStep(STEPS.ERROR);
          setStatusMsg(`Solo tienes ${formatNumber(positionSize || 0)} shares disponibles.`);
          return;
        }
      } else {
        const walletBalance = await getUsdcBalance(provider, address);
        setBalance(walletBalance);
        if (walletBalance < numAmount) {
          setStep(STEPS.ERROR);
          setStatusMsg(`Balance insuficiente. Tienes $${walletBalance.toFixed(2)} USDC.`);
          return;
        }
      }

      if (isSell) {
        const spender = getOutcomeTokenSpender(isNegRisk);
        const approved = await getOutcomeTokenApproval(provider, address, spender);
        if (!approved) {
          setStep(STEPS.APPROVING);
          setStatusMsg('Habilitando shares para trading… (confirma en tu wallet)');
          await approveOutcomeTokens(signer, spender);
        }
      } else {
        const spender = getUsdcSpender();
        const allowance = await getUsdcAllowance(provider, address, spender);
        if (allowance < numAmount) {
          setStep(STEPS.APPROVING);
          setStatusMsg('Aprobando USDC para trading… (confirma en tu wallet)');
          await approveUsdc(signer, ethers.constants.MaxUint256, spender);
        }
      }

      setStep(STEPS.SIGNING);
      setStatusMsg('Firmando autenticación… (1 firma)');
      const creds = await deriveClobApiKey(signer, address);

      setStep(STEPS.PLACING);
      setStatusMsg(isSell ? 'Enviando orden de venta…' : 'Enviando orden de compra…');

      const result = await placeClobOrder({
        signer,
        address,
        creds,
        tokenId,
        price: quote.limitPrice,
        side,
        amount: numAmount,
        isNegRisk,
        orderType: 'FOK',
      });

      setOrderId(result.orderID || result.id || 'OK');
      setStep(STEPS.SUCCESS);
      setStatusMsg(isSell
        ? `¡Venta enviada! ${formatNumber(numAmount)} shares de "${outcome}".`
        : `¡Compra enviada! $${formatNumber(numAmount)} USDC en "${outcome}".`);
      setAmount('');
      onSuccess?.();
    } catch (error) {
      setStep(STEPS.ERROR);
      setStatusMsg(error.message || 'Error al enviar la orden.');
    }
  }

  function handleClose() {
    setStep(STEPS.IDLE);
    setStatusMsg('');
    setOrderId(null);
    onClose();
  }

  function buttonLabel() {
    if (!authenticated) return isSell ? 'CONECTAR PARA VENDER' : 'CONECTAR PARA COMPRAR';
    if (step === STEPS.CHECKING) return 'Verificando…';
    if (step === STEPS.APPROVING) return isSell ? 'Habilitando shares…' : 'Aprobando USDC…';
    if (step === STEPS.SIGNING) return 'Firmando…';
    if (step === STEPS.PLACING) return isSell ? 'Enviando venta…' : 'Enviando compra…';
    if (step === STEPS.SUCCESS) return isSell ? '✓ VENTA ENVIADA' : '✓ COMPRA ENVIADA';
    if (numAmount > 0) {
      return isSell
        ? `VENDER ${formatNumber(numAmount)} SHARES`
        : `COMPRAR $${formatNumber(numAmount)} USDC`;
    }
    return isSell ? 'VENDER' : 'COMPRAR';
  }

  return (
    <div className="bet-modal-overlay show" onClick={(event) => event.target === event.currentTarget && handleClose()}>
      <div className="bet-modal-box">
        <div className="bet-modal-header">
          <span className="bet-modal-title">{isSell ? 'VENDER POSICION' : 'COMPRAR POSICION'}</span>
          <button className="bet-modal-close" onClick={handleClose}>✕</button>
        </div>

        <div className="bet-outcome-tag">
          <span className="bet-outcome-label">{outcome}</span>
          <span className="bet-outcome-pct">{outcomePct}%</span>
        </div>

        {marketTitle && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            {marketTitle}
          </p>
        )}

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'var(--surface2)',
          marginBottom: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isSell ? 'Posicion disponible' : 'Balance USDC'}
          </span>
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            {displayBalance == null
              ? '—'
              : isSell
                ? `${formatNumber(displayBalance)} shares`
                : `$${formatNumber(displayBalance)}`
            }
          </span>
        </div>

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderRadius: 8,
          background: 'var(--surface2)',
          marginBottom: 16,
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            {isSell ? 'Precio comprador' : 'Precio vendedor'}
          </span>
          <span style={{ color: quote?.enoughLiquidity ? 'var(--green)' : 'var(--text-primary)', fontWeight: 600 }}>
            {quote?.limitPrice ? `${(quote.limitPrice * 100).toFixed(1)}¢` : 'Cargando…'}
          </span>
        </div>

        <div className="bet-amount-wrap">
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
            {isSell ? 'SHARES A VENDER' : 'MONTO (USDC)'}
          </label>
          <div style={{ position: 'relative' }}>
            {!isSell && (
              <span style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
              }}>
                $
              </span>
            )}
            <input
              type="number"
              min={isSell ? '0.01' : '1'}
              step="0.01"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                if (step === STEPS.ERROR) setStep(STEPS.IDLE);
              }}
              placeholder="0"
              className="bet-amount-input"
              style={{ width: '100%', paddingLeft: isSell ? 14 : 28 }}
              disabled={isLoading || step === STEPS.SUCCESS}
            />
          </div>
        </div>

        <div className="bet-quick-btns">
          {isSell
            ? SELL_QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                className="bet-quick-btn"
                onClick={() => setAmount(formatInputAmount(Number(positionSize || 0) * action.fraction))}
                disabled={isLoading || step === STEPS.SUCCESS || Number(positionSize || 0) <= 0}
              >
                {action.label}
              </button>
            ))
            : BUY_QUICK_AMOUNTS.map((quickAmount) => (
              <button
                key={quickAmount}
                className={`bet-quick-btn${numAmount === quickAmount ? ' active' : ''}`}
                onClick={() => setAmount(String(quickAmount))}
                disabled={isLoading || step === STEPS.SUCCESS}
              >
                ${quickAmount}
              </button>
            ))}
        </div>

        {numAmount > 0 && (
          <div className="bet-payout-info">
            <div className="bet-payout-row">
              <span>{isSell ? 'Recibirias' : 'Shares estimadas'}</span>
              <span className="green">
                {quote?.enoughLiquidity
                  ? isSell
                    ? `$${formatNumber(quote.proceeds)}`
                    : formatNumber(quote.shares, 3)
                  : 'Liquidez insuficiente'}
              </span>
            </div>
            <div className="bet-payout-row">
              <span>{isSell ? 'Precio promedio' : 'Pago al resolver'}</span>
              <span className="green">
                {quote?.enoughLiquidity
                  ? isSell
                    ? `${(quote.averagePrice * 100).toFixed(1)}¢`
                    : `$${formatNumber(quote.shares)}`
                  : '—'}
              </span>
            </div>
            <div className="bet-payout-row">
              <span>Precio limite</span>
              <span>{quote?.limitPrice ? `${(quote.limitPrice * 100).toFixed(1)}¢` : '—'}</span>
            </div>
          </div>
        )}

        {(bookError || isLoading || step === STEPS.SUCCESS || step === STEPS.ERROR) && (
          <div style={{
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 16,
            background: step === STEPS.SUCCESS ? 'rgba(0,232,122,0.08)'
              : step === STEPS.ERROR || bookError ? 'rgba(255,69,69,0.08)'
              : 'rgba(255,255,255,0.04)',
            border: `1px solid ${
              step === STEPS.SUCCESS ? 'rgba(0,232,122,0.25)'
                : step === STEPS.ERROR || bookError ? 'rgba(255,69,69,0.25)'
                : 'var(--border)'
            }`,
            color: step === STEPS.SUCCESS ? 'var(--green)'
              : step === STEPS.ERROR || bookError ? 'var(--red)'
              : 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
          }}>
            {isLoading && <span style={{ marginRight: 8 }}>⏳</span>}
            {step === STEPS.SUCCESS && <span style={{ marginRight: 8 }}>✅</span>}
            {(step === STEPS.ERROR || bookError) && <span style={{ marginRight: 8 }}>❌</span>}
            {bookError || statusMsg}
            {orderId && (
              <div style={{ marginTop: 4, opacity: 0.6, fontSize: 10 }}>
                Order ID: {orderId}
              </div>
            )}
          </div>
        )}

        <button
          className="btn-primary"
          style={{ width: '100%', opacity: step === STEPS.SUCCESS ? 0.7 : 1 }}
          onClick={step === STEPS.SUCCESS ? handleClose : handleTrade}
          disabled={isLoading || !canTrade}
        >
          {buttonLabel()}
        </button>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
          Powered by Polymarket · Polygon
        </p>
      </div>
    </div>
  );
}
