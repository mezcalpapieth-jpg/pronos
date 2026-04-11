import React, { useState, useEffect } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import {
  getUsdcBalance,
  getUsdcAllowance,
  approveUsdc,
  deriveClobApiKey,
  placeClobOrder,
  fetchOrderBook,
  simulateMarketBuy,
  CTF_EXCHANGE,
  NEG_RISK_ADAPTER,
  POLYGON_CHAIN_ID,
} from '../lib/clob.js';
import { isProtocolMarket, getRequiredChainId, CHAIN_IDS } from '../lib/protocol.js';

const QUICK_AMOUNTS = [5, 10, 25, 50];

// Steps shown in the UI during the betting flow
const STEPS = {
  IDLE:     'idle',
  CHECKING: 'checking',   // checking balance + allowance
  APPROVING:'approving',  // waiting for approval tx
  SIGNING:  'signing',    // signing CLOB auth message
  PLACING:  'placing',    // submitting order
  SUCCESS:  'success',
  ERROR:    'error',
};

export default function BetModal({ open, onClose, outcome, outcomePct, marketId, marketTitle, clobTokenId, isNegRisk = false, market = null }) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [amount, setAmount]   = useState('');
  const [step, setStep]       = useState(STEPS.IDLE);
  const [statusMsg, setStatusMsg] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [book, setBook]       = useState(null);

  const numAmount  = parseFloat(amount) || 0;
  // Dynamic fee: fee% = 5 × (1 - P) where P is probability as decimal
  const feePct     = outcomePct > 0 ? 5 * (1 - outcomePct / 100) : 0;
  const fee        = numAmount * feePct / 100;
  const afterFee   = numAmount - fee;
  const payout     = outcomePct > 0 && numAmount > 0 ? (afterFee / (outcomePct / 100)).toFixed(2) : '—';
  const profit     = outcomePct > 0 && numAmount > 0 ? (afterFee / (outcomePct / 100) - numAmount).toFixed(2) : '—';
  const isLoading  = [STEPS.CHECKING, STEPS.APPROVING, STEPS.SIGNING, STEPS.PLACING].includes(step);

  // Slippage simulation: walk the ask ladder with the user's post-fee MXNB.
  // `slippagePoints` is expressed in percentage points of implied probability
  // (e.g. market moved from 54% to 56% = "+2 pts"). We use the same unit in
  // the row, the warning and the threshold so nothing contradicts anything.
  const sim = (book && afterFee > 0) ? simulateMarketBuy(book, afterFee) : null;
  const slippagePts    = sim ? sim.slippagePoints : 0;
  const startPct       = sim ? Math.round(sim.startPrice * 100) : null;
  const postTradePct   = sim ? Math.round(sim.lastFillPrice * 100) : null;
  const highSlippage   = slippagePts >= 5;
  const partialFill    = sim && sim.remaining > 0.01;
  // Slippage preview is only meaningful when we have a live book. Local/demo
  // markets without a `clobTokenId` can't be simulated — show a hint instead
  // of silently hiding the section so the user knows why numbers are missing.
  const noLiveBook     = !clobTokenId;

  // Load MXNB balance when modal opens
  useEffect(() => {
    if (!open || !authenticated) return;
    const wallet = wallets?.[0];
    if (!wallet) return;
    wallet.getEthereumProvider().then(async (prov) => {
      try {
        const provider = new ethers.providers.Web3Provider(prov);
        const addr = await provider.getSigner().getAddress();
        const bal  = await getUsdcBalance(provider, addr);
        setBalance(bal);
      } catch (_) {}
    }).catch(() => {});
  }, [open, authenticated, wallets]);

  // Fetch order book when modal opens so we can preview slippage in real time.
  // Refresh every 15s while the modal stays open to keep the simulation close
  // to live market depth without hammering the CLOB.
  useEffect(() => {
    if (!open || !clobTokenId) { setBook(null); return; }
    let alive = true;
    const load = async () => {
      const b = await fetchOrderBook(clobTokenId);
      if (alive) setBook(b);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, [open, clobTokenId]);

  if (!open) return null;

  // ── Main bet handler ────────────────────────────────────────────────────────
  const handleBet = async () => {
    if (!authenticated) { window.open('/#waitlist', '_blank'); return; }
    if (numAmount <= 0) {
      setStep(STEPS.ERROR);
      setStatusMsg('Ingresa un monto válido.');
      return;
    }

    const wallet = wallets?.[0];
    if (!wallet) {
      setStep(STEPS.ERROR);
      setStatusMsg('No se encontró wallet. Reconecta tu cuenta.');
      return;
    }

    try {
      // ── 1. Get provider + signer ──────────────────────────────────────────
      setStep(STEPS.CHECKING);
      setStatusMsg('Verificando balance y permisos…');
      const ethProvider = await wallet.getEthereumProvider();
      let provider      = new ethers.providers.Web3Provider(ethProvider);
      let signer        = provider.getSigner();
      const address     = await signer.getAddress();

      // ── 1b. Check chain + auto-switch ──────────────────────────────────
      const requiredChainId = isProtocolMarket(market) ? getRequiredChainId() : POLYGON_CHAIN_ID;
      const network = await provider.getNetwork();
      if (network.chainId !== requiredChainId) {
        setStatusMsg('Cambiando de red…');
        try {
          await wallet.switchChain(requiredChainId);
          // Re-create provider after chain switch
          const newProv = await wallet.getEthereumProvider();
          provider = new ethers.providers.Web3Provider(newProv);
          signer = provider.getSigner();
        } catch (switchErr) {
          const chainName = requiredChainId === POLYGON_CHAIN_ID ? 'Polygon'
            : requiredChainId === CHAIN_IDS.arbitrum ? 'Arbitrum'
            : 'Arbitrum Sepolia';
          setStep(STEPS.ERROR);
          setStatusMsg(`Cambia a ${chainName} para continuar.`);
          return;
        }
      }

      // ── 2. Check balance ─────────────────────────────────────────────────
      const bal = await getUsdcBalance(provider, address);
      setBalance(bal);
      if (bal < numAmount) {
        setStep(STEPS.ERROR);
        setStatusMsg(`Balance insuficiente. Tienes $${bal.toFixed(2)} MXNB.`);
        return;
      }

      // ── 3. Check + request MXNB approvals ────────────────────────────────
      const allowance1 = await getUsdcAllowance(provider, address, CTF_EXCHANGE);
      const allowance2 = await getUsdcAllowance(provider, address, NEG_RISK_ADAPTER);
      const needsApproval = allowance1 < numAmount || allowance2 < numAmount;

      if (needsApproval) {
        setStep(STEPS.APPROVING);
        setStatusMsg('Aprobando MXNB… (confirma en tu wallet)');
        await approveUsdc(signer);
        setStatusMsg('MXNB aprobado ✓');
      }

      // ── 4. Derive CLOB API key ────────────────────────────────────────────
      setStep(STEPS.SIGNING);
      setStatusMsg('Firmando autenticación… (1 firma)');
      const creds = await deriveClobApiKey(signer, address);

      // ── 5. Place order ────────────────────────────────────────────────────
      setStep(STEPS.PLACING);
      setStatusMsg('Enviando orden a Polymarket…');
      const price  = outcomePct / 100;
      const token  = clobTokenId || marketId;
      const result = await placeClobOrder({
        signer,
        address,
        creds,
        tokenId:   token,
        price,
        side:      'BUY',
        size:      numAmount,
        isNegRisk,
      });

      setOrderId(result.orderID || result.id || 'OK');
      setStep(STEPS.SUCCESS);
      setStatusMsg(`¡Apuesta colocada! $${numAmount} MXNB en "${outcome}"`);
      setAmount('');

    } catch (e) {
      setStep(STEPS.ERROR);
      setStatusMsg(e.message || 'Error al colocar apuesta.');
    }
  };

  const handleClose = () => {
    setStep(STEPS.IDLE);
    setStatusMsg('');
    setOrderId(null);
    onClose();
  };

  // ── Step label shown in button ──────────────────────────────────────────────
  const buttonLabel = () => {
    if (!authenticated)             return 'ÚNETE A LA LISTA';
    if (step === STEPS.CHECKING)    return 'Verificando…';
    if (step === STEPS.APPROVING)   return 'Aprobando MXNB…';
    if (step === STEPS.SIGNING)     return 'Firmando…';
    if (step === STEPS.PLACING)     return 'Enviando orden…';
    if (step === STEPS.SUCCESS)     return '✓ COMPRA REALIZADA';
    if (numAmount > 0)              return `COMPRAR $${numAmount} MXNB`;
    return 'COMPRAR';
  };

  return (
    <div className="bet-modal-overlay show" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="bet-modal-box">
        <div className="bet-modal-header">
          <span className="bet-modal-title">COLOCAR APUESTA</span>
          <button className="bet-modal-close" onClick={handleClose}>✕</button>
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

        {/* MXNB Balance */}
        {authenticated && balance !== null && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', borderRadius: 8, background: 'var(--surface2)',
            marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>Balance USDC</span>
            <span style={{ color: balance > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              ${balance.toFixed(2)}
            </span>
          </div>
        )}

        {/* Amount input */}
        <div className="bet-amount-wrap">
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
            MONTO (MXNB)
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
              <span>Comisión ({feePct.toFixed(2)}%)</span>
              <span style={{ opacity: 0.6 }}>-${fee.toFixed(2)} MXNB</span>
            </div>
            <div className="bet-payout-row">
              <span>Pago estimado</span>
              <span className="green">${payout} MXNB</span>
            </div>
            <div className="bet-payout-row">
              <span>Ganancia potencial</span>
              <span className="green">+${profit} MXNB</span>
            </div>
            <div className="bet-payout-row">
              <span>Probabilidad implícita</span>
              <span>{outcomePct}%</span>
            </div>
            {sim && postTradePct !== null && (
              <div className="bet-payout-row">
                <span>Precio tras tu compra</span>
                <span style={{ color: highSlippage ? 'var(--red)' : 'var(--text-secondary)' }}>
                  {startPct}% → {postTradePct}%
                </span>
              </div>
            )}
            {sim && (
              <div className="bet-payout-row">
                <span>Slippage</span>
                <span style={{
                  color: highSlippage ? 'var(--red)' : 'var(--text-secondary)',
                  fontWeight: highSlippage ? 700 : 400,
                }}>
                  +{slippagePts.toFixed(1)} pts
                </span>
              </div>
            )}
            {noLiveBook && (
              <div className="bet-payout-row">
                <span>Slippage</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  Vista previa no disponible
                </span>
              </div>
            )}
          </div>
        )}

        {/* High slippage warning — book is thin, price drifts ≥5 points */}
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
            ⚠️ <strong>Volumen bajo:</strong> tu compra mueve el precio de {startPct}% a {postTradePct}%
            (+{slippagePts.toFixed(1)} pts). Considera reducir el monto.
          </div>
        )}

        {/* Partial fill warning — book doesn't have enough depth */}
        {numAmount > 0 && partialFill && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: 'rgba(255,165,0,0.08)',
            border: '1px solid rgba(255,165,0,0.3)',
            color: 'var(--gold)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            ⚠️ <strong>Liquidez insuficiente:</strong> solo ${sim.filled.toFixed(2)} MXNB pueden
            ejecutarse al precio actual. La orden podría fallar.
          </div>
        )}

        {/* Demo market — no live order book to simulate against */}
        {numAmount > 0 && noLiveBook && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: 'rgba(148,163,184,0.06)',
            border: '1px solid rgba(148,163,184,0.2)',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            📊 <strong>Mercado demo:</strong> sin libro de órdenes en vivo, no podemos
            previsualizar slippage para este mercado.
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
          onClick={step === STEPS.SUCCESS ? handleClose : handleBet}
          disabled={isLoading}
        >
          {buttonLabel()}
        </button>

        {authenticated && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
            {isProtocolMarket(market) ? 'Pronos Protocol · Arbitrum' : 'Polymarket · Polygon'}
          </p>
        )}
      </div>
    </div>
  );
}
