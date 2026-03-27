import { ethers } from 'ethers';

// ─── POLYMARKET CONTRACTS ─────────────────────────────────────────────────────
export const POLYGON_CHAIN_ID = 137;
export const USDC_ADDRESS     = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e collateral
export const CTF              = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
export const CTF_EXCHANGE     = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const NEG_RISK_ADAPTER = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296';
export const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const CTF_ABI = [
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
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

function toRawUnits(amount, rounding = 'round') {
  const scaled = Number(amount) * 1e6;
  if (rounding === 'floor') return BigInt(Math.floor(scaled));
  if (rounding === 'ceil') return BigInt(Math.ceil(scaled));
  return BigInt(Math.round(scaled));
}

export function rawToUsdc(raw) {
  return Number(raw) / 1e6;
}

function normalizeBookLevels(levels = [], side) {
  const direction = side === 'BUY' ? 1 : -1;
  return levels
    .map((level) => ({
      price: Number(level.price),
      size: Number(level.size),
    }))
    .filter((level) => level.price > 0 && level.size > 0)
    .sort((a, b) => direction * (a.price - b.price));
}

export function getUsdcSpender() {
  return CTF;
}

export function getOutcomeTokenSpender(isNegRisk = false) {
  return isNegRisk ? NEG_RISK_EXCHANGE : CTF_EXCHANGE;
}

export function buildMarketQuote(book, side, amount) {
  const normalizedAmount = Number(amount) || 0;
  if (normalizedAmount <= 0) {
    return {
      enoughLiquidity: false,
      averagePrice: 0,
      limitPrice: 0,
      proceeds: 0,
      shares: 0,
      spend: 0,
    };
  }

  const levels = normalizeBookLevels(side === 'BUY' ? book?.asks : book?.bids, side);
  let remaining = normalizedAmount;
  let filledShares = 0;
  let filledUsd = 0;
  let limitPrice = 0;

  for (const level of levels) {
    if (remaining <= 0) break;

    if (side === 'BUY') {
      const maxSharesAtLevel = remaining / level.price;
      const shares = Math.min(level.size, maxSharesAtLevel);
      if (shares <= 0) continue;

      const cost = shares * level.price;
      filledShares += shares;
      filledUsd += cost;
      remaining -= cost;
    } else {
      const shares = Math.min(level.size, remaining);
      if (shares <= 0) continue;

      const proceeds = shares * level.price;
      filledShares += shares;
      filledUsd += proceeds;
      remaining -= shares;
    }

    limitPrice = level.price;
  }

  const enoughLiquidity = remaining <= 1e-6 && limitPrice > 0;
  const averagePrice = filledShares > 0 ? filledUsd / filledShares : 0;

  return {
    enoughLiquidity,
    amount: normalizedAmount,
    averagePrice,
    limitPrice,
    proceeds: side === 'SELL' ? filledUsd : 0,
    remaining,
    shares: filledShares,
    spend: side === 'BUY' ? filledUsd : 0,
  };
}

// ─── USDC BALANCE ─────────────────────────────────────────────────────────────

export async function getUsdcBalance(provider, address) {
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const raw = await usdc.balanceOf(address);
  return rawToUsdc(raw.toBigInt());
}

// ─── USDC ALLOWANCE ───────────────────────────────────────────────────────────

export async function getUsdcAllowance(provider, owner, spender) {
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
  const raw = await usdc.allowance(owner, spender);
  return rawToUsdc(raw.toBigInt());
}

// ─── APPROVE USDC ─────────────────────────────────────────────────────────────
// Buying requires the CTF contract to have USDC.e allowance.
export async function approveUsdc(signer, amount = ethers.constants.MaxUint256, spender = CTF) {
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, signer);
  const tx = await usdc.approve(spender, amount);
  await tx.wait();
  return tx.hash;
}

export async function getOutcomeTokenApproval(provider, owner, operator) {
  const ctf = new ethers.Contract(CTF, CTF_ABI, provider);
  return ctf.isApprovedForAll(owner, operator);
}

export async function approveOutcomeTokens(signer, operator) {
  const ctf = new ethers.Contract(CTF, CTF_ABI, signer);
  const tx = await ctf.setApprovalForAll(operator, true);
  await tx.wait();
  return tx.hash;
}

export async function getOrderBook(tokenId) {
  const res = await fetch(`/api/clob?action=book&tokenId=${encodeURIComponent(tokenId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to fetch order book');
  }

  return res.json();
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
// amount:
//   BUY  -> USDC.e to spend
//   SELL -> shares to sell
export async function placeClobOrder({
  signer,
  address,
  creds,
  tokenId,
  price,
  side,
  amount,
  isNegRisk = true,
  orderType = 'FOK',
}) {
  const exchange = isNegRisk ? NEG_RISK_EXCHANGE : CTF_EXCHANGE;
  const normalizedPrice = Number(price);
  const normalizedAmount = Number(amount);

  if (!normalizedPrice || normalizedPrice <= 0) {
    throw new Error('Invalid order price');
  }

  if (!normalizedAmount || normalizedAmount <= 0) {
    throw new Error('Invalid order amount');
  }

  const sideNum    = side === 'BUY' ? 0 : 1;
  const makerAmt   = toRawUnits(normalizedAmount, 'round');
  const takerAmt   = side === 'BUY'
    ? toRawUnits(normalizedAmount / normalizedPrice, 'floor')
    : toRawUnits(normalizedAmount * normalizedPrice, 'floor');
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
      orderType,
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
