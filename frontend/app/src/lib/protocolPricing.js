import { ethers } from 'ethers';
import { AMM_ABI, AMM_MULTI_ABI } from './contracts.js';

const USDC_DECIMALS = 6;
const PRICE_SCALE = 1_000_000n;
const V2_INVERSE_SCALE = 1_000_000_000_000_000_000_000_000_000_000_000_000n;

function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (value && typeof value.toString === 'function') return BigInt(value.toString());
  return BigInt(value);
}

function parseUsdc(value) {
  return toBigInt(ethers.utils.parseUnits(String(value), USDC_DECIMALS));
}

function formatUsdcRaw(value) {
  return Number(ethers.utils.formatUnits(value.toString(), USDC_DECIMALS));
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function sqrt(value) {
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function toProbability(rawPrice) {
  return Number(rawPrice) / 1e6;
}

function toPoints(rawDiff) {
  return Number(rawDiff) / 10000;
}

function computeBinaryPrices(reserveYes, reserveNo) {
  const total = reserveYes + reserveNo;
  if (total === 0n) {
    return { yes: 500_000n, no: 500_000n };
  }
  return {
    yes: (reserveNo * PRICE_SCALE) / total,
    no: (reserveYes * PRICE_SCALE) / total,
  };
}

function computeMultiPrice(reserves, outcomeIndex) {
  if (!reserves.length || !reserves[outcomeIndex]) return 0n;

  let denominator = 0n;
  let selected = 0n;
  for (let i = 0; i < reserves.length; i += 1) {
    const inverse = V2_INVERSE_SCALE / reserves[i];
    denominator += inverse;
    if (i === outcomeIndex) selected = inverse;
  }
  if (denominator === 0n) return 0n;
  return (selected * PRICE_SCALE) / denominator;
}

function estimateBinarySellGross(reserveYes, reserveNo, sellYes, sharesAmount) {
  const k = reserveYes * reserveNo;
  const a = sellYes ? reserveYes + sharesAmount : reserveNo + sharesAmount;
  const b = sellYes ? reserveNo : reserveYes;
  const diff = a > b ? a - b : b - a;
  const discriminant = diff * diff + 4n * k;
  return (a + b - sqrt(discriminant)) / 2n;
}

function buildBuyQuote({ amountRaw, feeRaw, sharesOutRaw, currentPriceRaw, postTradePriceRaw }) {
  const amount = formatUsdcRaw(amountRaw);
  const payout = formatUsdcRaw(sharesOutRaw);
  return {
    amount: roundMoney(amount),
    fee: roundMoney(formatUsdcRaw(feeRaw)),
    feePct: amount > 0 ? roundMoney((formatUsdcRaw(feeRaw) / amount) * 100) : 0,
    sharesOut: roundMoney(payout),
    payout: roundMoney(payout),
    profit: roundMoney(payout - amount),
    currentPrice: toProbability(currentPriceRaw),
    postTradePrice: toProbability(postTradePriceRaw),
    priceImpactPts: toPoints(postTradePriceRaw - currentPriceRaw),
  };
}

function buildSellQuote({ sharesRaw, feeRaw, collateralOutRaw, currentPriceRaw, postTradePriceRaw }) {
  const spotValueRaw = (sharesRaw * currentPriceRaw) / PRICE_SCALE;
  const spotValue = formatUsdcRaw(spotValueRaw);
  const collateralOut = formatUsdcRaw(collateralOutRaw);
  return {
    shares: roundMoney(formatUsdcRaw(sharesRaw)),
    fee: roundMoney(formatUsdcRaw(feeRaw)),
    feePct: spotValue > 0 ? roundMoney((formatUsdcRaw(feeRaw) / spotValue) * 100) : 0,
    spotValue: roundMoney(spotValue),
    collateralOut: roundMoney(collateralOut),
    slippageAmount: roundMoney(Math.max(0, spotValue - collateralOut)),
    currentPrice: toProbability(currentPriceRaw),
    postTradePrice: toProbability(postTradePriceRaw),
    priceImpactPts: toPoints(postTradePriceRaw - currentPriceRaw),
  };
}

export async function getProtocolBuyQuote(provider, poolAddress, outcome, amount, opts = {}) {
  if (!provider || !poolAddress) return null;
  const raw = parseUsdc(amount);
  if (raw <= 0n) return null;

  const protocolVersion = opts.protocolVersion || 'v1';
  if (protocolVersion === 'v2') {
    const outcomeIndex = Number(outcome);
    const amm = new ethers.Contract(poolAddress, AMM_MULTI_ABI, provider);
    const [sharesOutRaw, feeRaw, reservesRaw] = await Promise.all([
      amm.estimateBuy(outcomeIndex, raw.toString()),
      amm.calculateFee(raw.toString(), outcomeIndex),
      amm.getReserves(),
    ]);

    const sharesOut = toBigInt(sharesOutRaw);
    const fee = toBigInt(feeRaw);
    const netAmount = raw - fee;
    const reserves = reservesRaw.map(toBigInt);
    const currentPriceRaw = computeMultiPrice(reserves, outcomeIndex);
    const postReserves = reserves.map((reserve, index) => (
      index === outcomeIndex
        ? reserve + netAmount - sharesOut
        : reserve + netAmount
    ));
    const postTradePriceRaw = computeMultiPrice(postReserves, outcomeIndex);

    return buildBuyQuote({
      amountRaw: raw,
      feeRaw: fee,
      sharesOutRaw: sharesOut,
      currentPriceRaw,
      postTradePriceRaw,
    });
  }

  const buyYes = Boolean(outcome);
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const [sharesOutRaw, feeRaw, reserveYesRaw, reserveNoRaw] = await Promise.all([
    amm.estimateBuy(buyYes, raw.toString()),
    amm.calculateFee(raw.toString(), buyYes),
    amm.reserveYes(),
    amm.reserveNo(),
  ]);

  const sharesOut = toBigInt(sharesOutRaw);
  const fee = toBigInt(feeRaw);
  const netAmount = raw - fee;
  const reserveYes = toBigInt(reserveYesRaw);
  const reserveNo = toBigInt(reserveNoRaw);
  const currentPrices = computeBinaryPrices(reserveYes, reserveNo);

  const postReserveYes = buyYes
    ? reserveYes + netAmount - sharesOut
    : reserveYes + netAmount;
  const postReserveNo = buyYes
    ? reserveNo + netAmount
    : reserveNo + netAmount - sharesOut;
  const postPrices = computeBinaryPrices(postReserveYes, postReserveNo);

  return buildBuyQuote({
    amountRaw: raw,
    feeRaw: fee,
    sharesOutRaw: sharesOut,
    currentPriceRaw: buyYes ? currentPrices.yes : currentPrices.no,
    postTradePriceRaw: buyYes ? postPrices.yes : postPrices.no,
  });
}

export async function getProtocolSellQuote(provider, poolAddress, outcome, sharesAmount, opts = {}) {
  if (!provider || !poolAddress) return null;
  const raw = parseUsdc(sharesAmount);
  if (raw <= 0n) return null;

  const protocolVersion = opts.protocolVersion || 'v1';
  if (protocolVersion === 'v2') {
    const outcomeIndex = Number(outcome);
    const amm = new ethers.Contract(poolAddress, AMM_MULTI_ABI, provider);
    const [collateralOutRaw, reservesRaw] = await Promise.all([
      amm.estimateSell(outcomeIndex, raw.toString()),
      amm.getReserves(),
    ]);

    const collateralOut = toBigInt(collateralOutRaw);
    const reserves = reservesRaw.map(toBigInt);
    const currentPriceRaw = computeMultiPrice(reserves, outcomeIndex);
    const postReserves = reserves.map((reserve, index) => (
      index === outcomeIndex
        ? reserve + raw - collateralOut
        : reserve - collateralOut
    ));
    const postTradePriceRaw = computeMultiPrice(postReserves, outcomeIndex);

    return buildSellQuote({
      sharesRaw: raw,
      feeRaw: 0n,
      collateralOutRaw: collateralOut,
      currentPriceRaw,
      postTradePriceRaw,
    });
  }

  const sellYes = Boolean(outcome);
  const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
  const [reserveYesRaw, reserveNoRaw] = await Promise.all([
    amm.reserveYes(),
    amm.reserveNo(),
  ]);

  const reserveYes = toBigInt(reserveYesRaw);
  const reserveNo = toBigInt(reserveNoRaw);
  const grossOut = estimateBinarySellGross(reserveYes, reserveNo, sellYes, raw);
  const [collateralOutRaw, feeRaw] = await Promise.all([
    amm.estimateSell(sellYes, raw.toString()),
    amm.calculateFee(grossOut.toString(), !sellYes),
  ]);

  const collateralOut = toBigInt(collateralOutRaw);
  const fee = toBigInt(feeRaw);
  const currentPrices = computeBinaryPrices(reserveYes, reserveNo);
  const postReserveYes = sellYes ? reserveYes + raw - grossOut : reserveYes - grossOut;
  const postReserveNo = sellYes ? reserveNo - grossOut : reserveNo + raw - grossOut;
  const postPrices = computeBinaryPrices(postReserveYes, postReserveNo);

  return buildSellQuote({
    sharesRaw: raw,
    feeRaw: fee,
    collateralOutRaw: collateralOut,
    currentPriceRaw: sellYes ? currentPrices.yes : currentPrices.no,
    postTradePriceRaw: sellYes ? postPrices.yes : postPrices.no,
  });
}
