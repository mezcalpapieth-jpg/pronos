import assert from 'node:assert/strict';
import test from 'node:test';

import {
  enforceProtocolBuySlippage,
  enforceProtocolSellSlippage,
  formatProtocolBuyQuote,
  formatProtocolSellQuote,
  optionalFiniteNumber,
} from './protocol-trade-guards.js';

test('formatProtocolBuyQuote exposes on-chain quote fields used by the MVP modal', () => {
  const quote = formatProtocolBuyQuote({
    collateral: 100,
    fee: 2,
    sharesOut: 150,
    priceBefore: 0.5,
    priceAfter: null,
  });

  assert.equal(quote.collateral, 100);
  assert.equal(quote.fee, 2);
  assert.equal(quote.feePct, 2);
  assert.equal(quote.sharesOut, 150);
  assert.equal(quote.payout, 150);
  assert.equal(quote.profit, 50);
  assert.equal(quote.avgPrice, 98 / 150);
  assert.equal(quote.currentPrice, 0.5);
  assert.equal(quote.postTradePrice, null);
});

test('formatProtocolSellQuote exposes min-out compatible sell quote fields', () => {
  const quote = formatProtocolSellQuote({
    shares: 50,
    gross: 50,
    fee: 1,
    collateralOut: 49,
    priceBefore: 0.52,
    priceAfter: null,
  });

  assert.equal(quote.shares, 50);
  assert.equal(quote.gross, 50);
  assert.equal(quote.fee, 1);
  assert.equal(quote.feePct, 2);
  assert.equal(quote.collateralOut, 49);
  assert.equal(quote.currentPrice, 0.52);
  assert.equal(quote.postTradePrice, null);
});

test('enforceProtocolBuySlippage rejects stale min shares and max average price', () => {
  assert.throws(
    () => enforceProtocolBuySlippage({
      quote: { sharesOut: 9.9, avgPrice: 1.01 },
      minSharesOut: 10,
    }),
    err => err?.message === 'price_moved' && err?.status === 409,
  );

  assert.throws(
    () => enforceProtocolBuySlippage({
      quote: { sharesOut: 10, avgPrice: 1.05 },
      maxAvgPrice: 1.04,
    }),
    err => err?.message === 'price_moved' && err?.status === 409,
  );
});

test('enforceProtocolSellSlippage rejects stale sell min-out quotes', () => {
  assert.throws(
    () => enforceProtocolSellSlippage({
      quote: { collateralOut: 19.9 },
      minCollateralOut: 20,
    }),
    err => err?.message === 'price_moved' && err?.status === 409,
  );
});

test('optional slippage numbers treat omitted guards as absent', () => {
  assert.equal(optionalFiniteNumber(null), null);
  assert.equal(optionalFiniteNumber(undefined), null);
  assert.equal(optionalFiniteNumber(''), null);
  assert.equal(optionalFiniteNumber('0'), 0);
  assert.equal(optionalFiniteNumber(0.52), 0.52);
});
