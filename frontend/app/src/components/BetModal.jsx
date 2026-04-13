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
import { buyShares } from '../lib/contracts.js';
import { isProtocolMarket, getUsdcAddress, CHAIN_IDS, getChainDisplayName, switchWalletChain } from '../lib/protocol.js';
import { useT } from '../lib/i18n.js';

const QUICK_AMOUNTS = [5, 10, 25, 50];
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

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
  const t = useT();
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [amount, setAmount]   = useState('');
  const [step, setStep]       = useState(STEPS.IDLE);
  const [statusMsg, setStatusMsg] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [balance, setBalance] = useState(null);
  const [book, setBook]       = useState(null);

  const numAmount  = parseFloat(amount) || 0;
  const protocolMarket = isProtocolMarket(market);
  const protocolChainId = Number(market?.chainId || CHAIN_IDS.arbitrumSepolia);
  // Dynamic fee: fee% = 5 * (1 - P), where P is probability of the side being bought.
  // At 50/50: 2.5%, at 90/10: 0.5%, at 99/1: 0.05%. Applies to all markets.
  const feePct     = 5 * (1 - (outcomePct || 50) / 100);
  const fee        = numAmount * feePct / 100;
  const afterFee   = numAmount - fee;
  const payout     = outcomePct > 0 && numAmount > 0 ? (afterFee / (outcomePct / 100)).toFixed(2) : '—';
  const profit     = outcomePct > 0 && numAmount > 0 ? (afterFee / (outcomePct / 100) - numAmount).toFixed(2) : '—';
  const isLoading  = [STEPS.CHECKING, STEPS.APPROVING, STEPS.SIGNING, STEPS.PLACING].includes(step);

  // Slippage simulation: walk the ask ladder with the user's post-fee USDC.
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
  const noLiveBook     = !clobTokenId && !protocolMarket;
  const liveTradingUnavailable = protocolMarket ? !market?.poolAddress : !clobTokenId;

  async function getWalletUsdcBalance(provider, address, chainId) {
    if (!protocolMarket) return getUsdcBalance(provider, address);
    const usdcAddress = getUsdcAddress(chainId);
    if (!usdcAddress) throw new Error('USDC is not configured for this chain');
    const usdc = new ethers.Contract(usdcAddress, ERC20_BALANCE_ABI, provider);
    const raw = await usdc.balanceOf(address);
    return Number(ethers.utils.formatUnits(raw, 6));
  }

  // Load USDC balance when modal opens
  useEffect(() => {
    if (!open || !authenticated) return;
    const wallet = wallets?.[0];
    if (!wallet) return;
    wallet.getEthereumProvider().then(async (prov) => {
      try {
        const provider = new ethers.providers.Web3Provider(prov);
        const addr = await provider.getSigner().getAddress();
        const network = await provider.getNetwork();
        const bal  = await getWalletUsdcBalance(provider, addr, network.chainId);
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
    if (liveTradingUnavailable) {
      setStep(STEPS.ERROR);
      setStatusMsg(isProtocolMarket(market) ? t('bet.protocolUnavailable') : t('bet.noLiveTrading'));
      return;
    }
    if (numAmount <= 0) {
      setStep(STEPS.ERROR);
      setStatusMsg(t('bet.invalidAmount'));
      return;
    }

    const wallet = wallets?.[0];
    if (!wallet) {
      setStep(STEPS.ERROR);
      setStatusMsg(t('bet.noWallet'));
      return;
    }

    try {
      // ── 1. Get provider + signer ──────────────────────────────────────────
      setStep(STEPS.CHECKING);
      setStatusMsg(t('bet.checking'));
      const ethProvider = await wallet.getEthereumProvider();
      let provider      = new ethers.providers.Web3Provider(ethProvider);
      let signer        = provider.getSigner();
      const address     = await signer.getAddress();

      // ── 1b. Check chain + auto-switch ──────────────────────────────────
      const requiredChainId = protocolMarket ? protocolChainId : POLYGON_CHAIN_ID;
      const network = await provider.getNetwork();
      if (network.chainId !== requiredChainId) {
        setStatusMsg(t('bet.switchingChain'));
        try {
          await switchWalletChain(wallet, requiredChainId);
          // Re-create provider after chain switch
          const newProv = await wallet.getEthereumProvider();
          provider = new ethers.providers.Web3Provider(newProv);
          signer = provider.getSigner();
        } catch (switchErr) {
          setStep(STEPS.ERROR);
          setStatusMsg(t('bet.switchChain', { chain: getChainDisplayName(requiredChainId) }));
          return;
        }
      }

      // ── 2. Check balance ─────────────────────────────────────────────────
      const bal = await getWalletUsdcBalance(provider, address, requiredChainId);
      setBalance(bal);
      if (bal < numAmount) {
        setStep(STEPS.ERROR);
        setStatusMsg(t('bet.insufficient', { bal: bal.toFixed(2) }));
        return;
      }

      if (protocolMarket) {
        const usdcAddress = getUsdcAddress(requiredChainId);
        if (!usdcAddress || !market?.poolAddress) {
          setStep(STEPS.ERROR);
          setStatusMsg(t('bet.protocolUnavailable'));
          return;
        }
        setStep(STEPS.APPROVING);
        setStatusMsg(t('bet.approving'));
        const buyYes = outcome === market.options?.[0]?.label;
        setStep(STEPS.PLACING);
        setStatusMsg(t('bet.placingProtocol'));
        const receipt = await buyShares(signer, market.poolAddress, usdcAddress, buyYes, amount);
        setOrderId(receipt.transactionHash || receipt.hash || 'OK');
        setStep(STEPS.SUCCESS);
        setStatusMsg(t('bet.placed', { amt: numAmount, outcome }));
        setAmount('');
        return;
      }

      // ── 3. Check + request USDC approvals ────────────────────────────────
      const allowance1 = await getUsdcAllowance(provider, address, CTF_EXCHANGE);
      const allowance2 = await getUsdcAllowance(provider, address, NEG_RISK_ADAPTER);
      const needsApproval = allowance1 < numAmount || allowance2 < numAmount;

      if (needsApproval) {
        setStep(STEPS.APPROVING);
        setStatusMsg(t('bet.approving'));
        await approveUsdc(signer);
        setStatusMsg(t('bet.approved'));
      }

      // ── 4. Derive CLOB API key ────────────────────────────────────────────
      setStep(STEPS.SIGNING);
      setStatusMsg(t('bet.signing'));
      const creds = await deriveClobApiKey(signer, address);

      // ── 5. Place order ────────────────────────────────────────────────────
      setStep(STEPS.PLACING);
      setStatusMsg(t('bet.placing'));
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
      setStatusMsg(t('bet.placed', { amt: numAmount, outcome }));
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
    if (!authenticated)             return t('bet.btn.join');
    if (liveTradingUnavailable)     return t('bet.btn.unavailable');
    if (step === STEPS.CHECKING)    return t('bet.btn.checking');
    if (step === STEPS.APPROVING)   return t('bet.btn.approving');
    if (step === STEPS.SIGNING)     return t('bet.btn.signing');
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
          <span className="bet-outcome-pct">{outcomePct}%</span>
        </div>

        {marketTitle && (
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
            {marketTitle}
          </p>
        )}

        {/* USDC Balance */}
        {authenticated && balance !== null && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '8px 12px', borderRadius: 8, background: 'var(--surface2)',
            marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('bet.balance')}</span>
            <span style={{ color: balance > 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              ${balance.toFixed(2)}
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
              <span>{t('bet.fee', { pct: feePct.toFixed(2) })}</span>
              <span style={{ opacity: 0.6 }}>-${fee.toFixed(2)} USDC</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.estimatedPayout')}</span>
              <span className="green">${payout} USDC</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.profit')}</span>
              <span className="green">+${profit} USDC</span>
            </div>
            <div className="bet-payout-row">
              <span>{t('bet.implied')}</span>
              <span>{outcomePct}%</span>
            </div>
            {sim && postTradePct !== null && (
              <div className="bet-payout-row">
                <span>{t('bet.priceAfter')}</span>
                <span style={{ color: highSlippage ? 'var(--red)' : 'var(--text-secondary)' }}>
                  {startPct}% → {postTradePct}%
                </span>
              </div>
            )}
            {sim && (
              <div className="bet-payout-row">
                <span>{t('bet.slippage')}</span>
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
                <span>{t('bet.slippage')}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {t('bet.previewUnavailable')}
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
            {t('bet.warn.lowVolume', { start: startPct, end: postTradePct, pts: slippagePts.toFixed(1) })}
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
            {t('bet.warn.lowLiquidity', { filled: sim.filled.toFixed(2) })}
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
            {t('bet.warn.demoMarket')}
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
          style={{ width: '100%', opacity: step === STEPS.SUCCESS || (authenticated && liveTradingUnavailable) ? 0.7 : 1 }}
          onClick={step === STEPS.SUCCESS ? handleClose : handleBet}
          disabled={isLoading || (authenticated && liveTradingUnavailable)}
        >
          {buttonLabel()}
        </button>

        {authenticated && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 12, fontFamily: 'var(--font-mono)' }}>
            {isProtocolMarket(market) ? t('bet.protocol.own') : t('bet.protocol.poly')}
          </p>
        )}
      </div>
    </div>
  );
}
