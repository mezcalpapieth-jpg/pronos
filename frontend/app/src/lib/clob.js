import { ethers } from 'ethers';

// ─── POLYGON MAINNET CONSTANTS ────────────────────────────────────────────────
export const POLYGON_CHAIN_ID = 137;
export const MXNB_ADDRESS     = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // native MXNB
export const CTF_EXCHANGE     = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

const MXNB_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// EIP-712 Order types for CTF Exchange
const CTF_DOMAIN = (verifyingContract) => ({
  name: 'CTFExchange',
  version: '1',
  chainId: POLYGON_CHAIN_ID,
  verifyingContract,
});

const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function usdcToRaw(amount) {
  return BigInt(Math.round(amount * 1e6));
}

export function rawToUsdc(raw) {
  return Number(raw) / 1e6;
}

// ─── MXNB BALANCE ─────────────────────────────────────────────────────────────

export async function getUsdcBalance(provider, address) {
  const usdc = new ethers.Contract(MXNB_ADDRESS, MXNB_ABI, provider);
  const raw = await usdc.balanceOf(address);
  return rawToUsdc(raw.toBigInt());
}

// ─── MXNB ALLOWANCE ───────────────────────────────────────────────────────────

export async function getUsdcAllowance(provider, owner, spender) {
  const usdc = new ethers.Contract(MXNB_ADDRESS, MXNB_ABI, provider);
  const raw = await usdc.allowance(owner, spender);
  return rawToUsdc(raw.toBigInt());
}

// ─── APPROVE MXNB ─────────────────────────────────────────────────────────────
// Approves CTF Exchange + NegRisk Adapter to spend MXNB.
// Returns tx hashes.

export async function approveUsdc(signer, amount = ethers.constants.MaxUint256) {
  const usdc = new ethers.Contract(MXNB_ADDRESS, MXNB_ABI, signer);
  const txs = [];

  const tx1 = await usdc.approve(CTF_EXCHANGE, amount);
  await tx1.wait();
  txs.push(tx1.hash);

  const tx2 = await usdc.approve(NEG_RISK_ADAPTER, amount);
  await tx2.wait();
  txs.push(tx2.hash);

  return txs;
}

// ─── DERIVE CLOB API KEY ──────────────────────────────────────────────────────
// Signs an L1 message with the user's wallet and exchanges it for API credentials.

export async function deriveClobApiKey(signer, address) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = 0;

  // Sign the auth message (EIP-191 personal sign)
  const message = `This message attests that I control the given wallet`;
  const signature = await signer.signMessage(message);

  const res = await fetch(`/api/clob?action=derive-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature, timestamp, nonce }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to derive API key');
  }

  return res.json(); // { apiKey, secret, passphrase }
}

// ─── PLACE ORDER ─────────────────────────────────────────────────────────────
// Builds + signs an EIP-712 order and submits it to the CLOB.
// side: 'BUY' | 'SELL'
// price: 0.0–1.0 (e.g. 0.54 = 54% probability = $0.54 per share)
// size: amount in MXNB

export async function placeClobOrder({ signer, address, creds, tokenId, price, side, size, isNegRisk = true }) {
  const exchange = isNegRisk ? NEG_RISK_EXCHANGE : CTF_EXCHANGE;

  const sideNum    = side === 'BUY' ? 0 : 1;
  const makerAmt   = usdcToRaw(side === 'BUY' ? size : size / price);       // MXNB in (buying)
  const takerAmt   = usdcToRaw(side === 'BUY' ? size / price : size);       // shares out
  const salt       = BigInt(Math.floor(Math.random() * 1e15));

  const order = {
    salt:          salt.toString(),
    maker:         address,
    signer:        address,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       tokenId,
    makerAmount:   makerAmt.toString(),
    takerAmount:   takerAmt.toString(),
    expiration:    '0',
    nonce:         '0',
    feeRateBps:    '0',
    side:          sideNum,
    signatureType: 0,  // EOA
  };

  // Sign EIP-712
  const domain  = CTF_DOMAIN(exchange);
  const typedOrder = {
    ...order,
    salt:        BigInt(order.salt),
    makerAmount: BigInt(order.makerAmount),
    takerAmount: BigInt(order.takerAmount),
    tokenId:     BigInt(order.tokenId),
    expiration:  BigInt(order.expiration),
    nonce:       BigInt(order.nonce),
    feeRateBps:  BigInt(order.feeRateBps),
  };

  const signature = await signer._signTypedData(domain, ORDER_TYPES, typedOrder);
  const signedOrder = { ...order, signature };

  const res = await fetch(`/api/clob?action=place-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      order:      signedOrder,
      owner:      address,
      orderType:  'FOK',          // Fill-Or-Kill for market orders
      apiKey:     creds.apiKey,
      secret:     creds.secret,
      passphrase: creds.passphrase,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || JSON.stringify(err));
  }

  return res.json(); // { orderID, status, ... }
}

// ─── GET POSITIONS ────────────────────────────────────────────────────────────

export async function getClobPositions(address) {
  const res = await fetch(`/api/clob?action=positions&address=${address}`);
  if (!res.ok) throw new Error('Failed to fetch positions');
  return res.json();
}

// ─── ORDER BOOK + SLIPPAGE SIMULATION ─────────────────────────────────────────
// Used by BetModal to preview the post-trade price so users know how much the
// price will drift before they submit a market order.

/**
 * Fetch the raw CLOB order book for a token.
 * Returns `{ asks: [{price, size}], bids: [{price, size}] }` with numeric
 * prices and sizes, sorted so position 0 is always the BEST level (lowest
 * ask, highest bid) — Polymarket's raw payload sorts descending, so we
 * normalize here.
 */
export async function fetchOrderBook(tokenId) {
  if (!tokenId) return null;
  const res = await fetch(`/api/clob?action=book&token_id=${encodeURIComponent(tokenId)}`);
  if (!res.ok) return null;
  const data = await res.json();
  const parseLevels = (arr) => (Array.isArray(arr) ? arr : [])
    .map(l => ({ price: parseFloat(l.price), size: parseFloat(l.size) }))
    .filter(l => Number.isFinite(l.price) && Number.isFinite(l.size) && l.size > 0);
  const asks = parseLevels(data.asks).sort((a, b) => a.price - b.price); // best (lowest) first
  const bids = parseLevels(data.bids).sort((a, b) => b.price - a.price); // best (highest) first
  return { asks, bids };
}

/**
 * Simulate a market BUY against an order book.
 *
 * Walks the ask ladder from best to worst, consuming depth with the user's
 * `usdcAmount`. Returns:
 *   - shares:        total outcome tokens received
 *   - avgPrice:      volume-weighted average execution price (0-1)
 *   - lastFillPrice: price of the last consumed level — the new post-trade
 *                    best ask, i.e. what the market moves to
 *   - startPrice:    best ask before the trade (0-1)
 *   - filled:        usdc actually used (may be < amount if book is too thin)
 *   - remaining:     usdc left unfilled (0 when book has enough depth)
 *   - slippagePct:   (lastFillPrice - startPrice) / startPrice × 100
 *
 * Returns null when the book is empty.
 */
export function simulateMarketBuy(book, usdcAmount) {
  if (!book || !Array.isArray(book.asks) || book.asks.length === 0) return null;
  const asks = book.asks;
  const startPrice = asks[0].price;
  let remaining = usdcAmount;
  let shares = 0;
  let spent = 0;
  let lastFillPrice = startPrice;

  for (const level of asks) {
    if (remaining <= 0) break;
    const levelCost = level.price * level.size; // USDC needed to clear this level
    if (remaining >= levelCost) {
      shares += level.size;
      spent += levelCost;
      remaining -= levelCost;
      lastFillPrice = level.price;
    } else {
      const partialShares = remaining / level.price;
      shares += partialShares;
      spent += remaining;
      lastFillPrice = level.price;
      remaining = 0;
      break;
    }
  }

  const avgPrice = shares > 0 ? spent / shares : startPrice;
  const slippagePct = startPrice > 0
    ? ((lastFillPrice - startPrice) / startPrice) * 100
    : 0;

  return {
    shares,
    avgPrice,
    lastFillPrice,
    startPrice,
    filled: spent,
    remaining,
    slippagePct,
  };
}
