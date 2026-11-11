import { strict as assert } from 'node:assert';
import test from 'node:test';
import { createMxnFundingQuoteService } from './mxn-funding-quote.js';

const NOW = Date.parse('2026-11-11T03:45:00Z');
const USDC = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const PUSD = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const circleFees = [
  { finalityThreshold: 1000, minimumFee: 1, forwardFee: { med: 240_000 } },
  { finalityThreshold: 2000, minimumFee: 7.5, forwardFee: { med: 240_000 } },
];
const hexUint = value => `0x${value.toString(16).padStart(64, '0')}`;
const rpc = { jsonrpc: '2.0', id: 1, result: hexUint(200_000) };
const assets = { supportedAssets: [USDC, PUSD].map(address => ({
  chainId: '137', token: { address, decimals: 6 }, minCheckoutUsd: 2,
})) };

function setup({ fx, now, replies = {} } = {}) {
  const calls = [];
  const service = createMxnFundingQuoteService({
    fx: fx ?? (async () => ({ bid: '19', ask: '20', timeMs: NOW })), now: now ?? (() => NOW),
    async fetchImpl(url, options) {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, body, options });
      if (Object.hasOwn(replies, url)) {
        return typeof replies[url] === 'function' ? replies[url](body) : Response.json(replies[url]);
      }
      if (url === 'https://iris-api.circle.com/v2/burn/USDC/fees/7/19?forward=true&hyperCoreDeposit=true') return Response.json(circleFees);
      if (url === 'https://rpc.hyperliquid.xyz/evm') return Response.json(rpc);
      if (url === 'https://bridge.polymarket.com/supported-assets') return Response.json(assets);
      if (url === 'https://bridge.polymarket.com/quote') {
        const input = BigInt(body.fromAmountBaseUnit);
        return Response.json({
          estInputUsd: Number(input) / 1_000_000, estToTokenBaseUnit: (input - 25_000n).toString(),
          estCheckoutTimeMs: 26_500, estFeeBreakdown: { gasUsd: 0.012345, minReceived: 1 },
          quoteId: 'a-fixture-id-for-the-example-address',
        });
      }
      throw new Error('Unexpected network request');
    },
  });
  return { service, calls };
}

test('quotes deposits and withdrawals for all three MXN amounts and both venues with customer-paid costs', async () => {
  const { service, calls } = setup();
  for (const [ticketMxn, source, hipDeposit, hipOut, hipFirst, polyDeposit, polyOut] of [
    [100, '5.263157', '4.75625', '96.19', '77.19', '4.975', '99.52'],
    [300, '15.789473', '14.74875', '296.19', '277.19', '14.975', '299.52'],
    [1000, '52.631578', '49.7225', '996.19', '977.19', '49.975', '999.52'],
  ]) {
    for (const [venue, asset, depositReceive, cashOut] of [
      ['hip4', 'USDC', hipDeposit, hipOut], ['polymarket', 'pUSD', polyDeposit, polyOut],
    ]) {
      const deposit = await service.quote({ venue, direction: 'deposit', ticketMxn });
      const withdrawal = await service.quote({ venue, direction: 'withdrawal', ticketMxn });
      assert.deepEqual(deposit.debit, { asset: 'MXN', amount: String(ticketMxn) });
      assert.deepEqual(deposit.estimatedReceive, { asset, amount: depositReceive });
      assert.deepEqual(withdrawal.debit, { asset, amount: source });
      assert.deepEqual(withdrawal.estimatedReceive, { asset: 'MXN', amount: cashOut });
      assert.deepEqual(withdrawal.estimatedFirstWithdrawalReceive, venue === 'hip4' ? { asset: 'MXN', amount: hipFirst } : null);
      assert.equal(deposit.fxRate, '20');
      assert.equal(withdrawal.fxRate, '19');
      assert.deepEqual(deposit.route, withdrawal.route.toReversed());
      for (const quote of [deposit, withdrawal]) {
        assert.equal(quote.status, 'indicative');
        assert.equal(quote.reason, 'partner_quote_required');
        assert.equal(quote.executable, false);
        assert.equal(quote.minimumReceive, null);
        assert.equal(quote.pronosFeeMxn, '0');
        assert.equal(quote.pronosSubsidyMxn, '0');
        assert.equal(quote.costPayer, 'customer');
        assert.equal(quote.expiresAt, '2026-11-11T03:45:30.000Z');
        assert.equal(quote.estimatedSeconds, venue === 'hip4' ? null : 27);
        assert.equal(quote.estimatedSecondsScope, venue === 'hip4' ? null : 'provider_leg');
        assert.ok(quote.fees.some(fee => fee.type === 'bitso_conversion' && fee.amount === null && !fee.includedInEstimate));
        assert.ok(!Object.hasOwn(quote, 'quoteId'));
      }
      if (venue === 'hip4') {
        assert.ok(withdrawal.fees.some(fee => fee.type === 'hypercore_activation' && fee.amount === '1' && !fee.includedInEstimate));
        assert.deepEqual(withdrawal.providerMinimum, { asset: 'USDC', amount: '0.2', comparison: 'greater_than' });
      } else {
        assert.ok(deposit.fees.some(fee => fee.type === 'polymarket_bridge_gas' && fee.amount === '0.012345' && !fee.includedInEstimate));
        assert.deepEqual(deposit.providerMinimum, { asset: 'USD', amount: '2', comparison: 'at_least' });
      }
    }
  }
  assert.equal(calls.length, 18);
  assert.ok(calls.every(({ options }) => options.credentials === 'omit' && options.redirect === 'error'));
  const providerCalls = calls.filter(({ url }) => url === 'https://bridge.polymarket.com/quote');
  assert.deepEqual(providerCalls.slice(0, 2).map(({ body }) => [body.fromAmountBaseUnit, body.fromTokenAddress, body.toTokenAddress]), [
    ['5000000', USDC, PUSD], ['5263157', PUSD, USDC],
  ]);
  assert.ok(calls.filter(({ url }) => url === 'https://rpc.hyperliquid.xyz/evm').every(({ body }) => body.method === 'eth_call'));
});

test('rejects inputs below the live Polymarket minimum and HIP-4 amounts that cannot cover the CCTP fee', async () => {
  const poly = setup({ fx: async () => ({ bid: '59', ask: '60', timeMs: NOW }) });
  const quote = await poly.service.quote({ venue: 'polymarket', direction: 'deposit', ticketMxn: 100 });
  assert.equal(quote.status, 'below_minimum');
  assert.equal(quote.reason, 'below_provider_minimum');
  assert.deepEqual(quote.providerMinimum, { asset: 'USD', amount: '2', comparison: 'at_least' });
  assert.equal(quote.estimatedReceive, null);
  assert.equal(quote.expiresAt, null);
  assert.equal(poly.calls.length, 1);

  const hip = setup({ replies: { 'https://rpc.hyperliquid.xyz/evm': { ...rpc, result: hexUint(6_000_000) } } });
  const blocked = await hip.service.quote({ venue: 'hip4', direction: 'withdrawal', ticketMxn: 100 });
  assert.equal(blocked.status, 'below_minimum');
  assert.deepEqual(blocked.providerMinimum, { asset: 'USDC', amount: '6', comparison: 'greater_than' });
  assert.equal(blocked.estimatedReceive, null);
});

test('fails closed on stale FX, malformed provider data and quote expiry during the request', async () => {
  const stale = setup({ fx: async () => ({ bid: '19', ask: '20', timeMs: NOW - 120_000 }) });
  const input = { venue: 'hip4', direction: 'deposit', ticketMxn: 100 };
  const missingFx = await stale.service.quote(input);
  assert.equal(missingFx.reason, 'fx_unavailable');
  assert.equal(stale.calls.length, 0);

  const bad = setup({ replies: { 'https://iris-api.circle.com/v2/burn/USDC/fees/7/19?forward=true&hyperCoreDeposit=true': [{}] } });
  const noLeg = await bad.service.quote(input);
  assert.equal(noLeg.reason, 'provider_quote_unavailable');
  assert.equal(noLeg.estimatedReceive, null);
  assert.equal(noLeg.pronosSubsidyMxn, '0');

  let now = NOW;
  const expires = setup({
    fx: async () => ({ bid: '19', ask: '20', timeMs: NOW - 119_000 }), now: () => now,
    replies: { 'https://iris-api.circle.com/v2/burn/USDC/fees/7/19?forward=true&hyperCoreDeposit=true': () => {
      now += 1_000;
      return Response.json(circleFees);
    } },
  });
  const expired = await expires.service.quote(input);
  assert.equal(expired.reason, 'fx_unavailable');
  assert.equal(expired.executable, false);
  assert.equal(expired.estimatedReceive, null);
});
