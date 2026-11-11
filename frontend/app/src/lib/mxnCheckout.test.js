import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutQuoteExpired, createMxnCheckoutClient } from './mxnCheckout.js';

const market = {
  venue: 'hip4', id: '27986', title: 'Rockets vs Warriors', cancellationPayoutPerShare: '0.50',
  outcomes: [{ index: 0, label: 'Rockets' }, { index: 1, label: 'Warriors' }],
};
const quote = {
  status: 'eligible', eligible: true, executable: false, side: 'buy', feeCapBps: 500, feeBps: 500, ticketMxn: 100,
  expiresAt: '2026-11-12T02:29:00.000Z',
};
const input = { market, outcomeIndex: 0, side: 'buy', amountMxn: 100 };
const respond = body => new Response(JSON.stringify({ ok: true, ...body }));

test('requests only read-only checkout endpoints and accepts a quote at the cap', async () => {
  const requests = [];
  const client = createMxnCheckoutClient({
    fetchImpl: async (url, options) => {
      requests.push([url, options.method, options.body]);
      return requests.length === 1 ? respond({ markets: [market], unavailableVenues: ['polymarket'] })
        : respond({ market, quote });
    },
  });
  assert.deepEqual(await client.getMarkets(), { markets: [market], unavailableVenues: ['polymarket'] });
  assert.deepEqual(await client.getQuote(input), { market, quote });
  assert.deepEqual(requests, [
    ['/api/mxn-checkout?action=markets', 'GET', undefined],
    ['/api/mxn-checkout?action=quote&venue=hip4&marketId=27986&outcomeIndex=0&side=buy&amountMxn=100', 'GET', undefined],
  ]);
});

test('rejects ambiguous market identity and inconsistent eligibility above the fee cap', async () => {
  const wrongVenue = createMxnCheckoutClient({ fetchImpl: async () => respond({
    market: { ...market, venue: 'polymarket' }, quote,
  }) });
  await assert.rejects(wrongVenue.getQuote(input), /mercado o la opción cambiaron/);
  const aboveCap = createMxnCheckoutClient({ fetchImpl: async () => respond({
    market, quote: { ...quote, feeBps: 501 },
  }) });
  await assert.rejects(aboveCap.getQuote(input), /verificar la cotización/);
  const rejectedQuote = { ...quote, status: 'fee_cap_exceeded', feeBps: 501, eligible: false };
  const explicitlyRejected = createMxnCheckoutClient({ fetchImpl: async () => respond({
    market, quote: rejectedQuote,
  }) });
  assert.deepEqual(await explicitlyRejected.getQuote(input), { market, quote: rejectedQuote });
});

test('expires precisely at the quote deadline', () => {
  const expiry = Date.parse(quote.expiresAt);
  assert.equal(checkoutQuoteExpired(quote, expiry - 1), false);
  assert.equal(checkoutQuoteExpired(quote, expiry), true);
  assert.equal(checkoutQuoteExpired({}, expiry), true);
});

function fundingQuote({ venue, direction, amountMxn }) {
  const collateral = venue === 'hip4' ? 'USDC' : 'pUSD';
  const deposit = direction === 'deposit';
  return {
    venue, direction, ticketMxn: amountMxn, status: 'indicative', executable: false, reason: null,
    route: deposit ? ['SPEI', 'Bitso', venue] : [venue, 'Bitso', 'SPEI'],
    debit: deposit ? { asset: 'MXN', amount: String(amountMxn) } : { asset: collateral, amount: String(amountMxn / 20) },
    estimatedReceive: deposit ? { asset: collateral, amount: String(amountMxn / 20 - 0.25) }
      : { asset: 'MXN', amount: String(amountMxn - 5) },
    minimumReceive: null,
    fees: [{ type: 'network', amount: null, asset: 'USDC', status: 'unavailable', includedInEstimate: false }],
    fxRate: '20', expiresAt: quote.expiresAt, estimatedSeconds: null,
    pronosFeeMxn: '0', pronosSubsidyMxn: '0', costPayer: 'customer',
  };
}

test('requests read-only customer-paid funding quotes on both venues for all three tickets', async () => {
  const requests = [];
  const client = createMxnCheckoutClient({ fetchImpl: async (url, options) => {
    const { action, venue, direction, amountMxn } = Object.fromEntries(new URL(url, 'https://pronos.example').searchParams);
    assert.equal(action, 'funding');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    const input = { venue, direction, amountMxn: Number(amountMxn) };
    requests.push(input);
    return respond({ quote: fundingQuote(input) });
  } });
  for (const venue of ['hip4', 'polymarket']) {
    for (const direction of ['deposit', 'withdrawal']) {
      for (const amountMxn of [100, 300, 1000]) {
        const input = { venue, direction, amountMxn };
        assert.deepEqual(await client.getFundingQuote(input), fundingQuote(input));
        assert.deepEqual(requests.at(-1), input);
      }
    }
  }
  assert.equal(requests.length, 12);
});

test('preserves missing funding costs and rejects a quote with an inconsistent subsidy, asset, or ticket', async () => {
  const input = { venue: 'hip4', direction: 'withdrawal', amountMxn: 100 };
  const indicative = fundingQuote(input);
  const unavailable = {
    ...indicative, status: 'unavailable', reason: 'upstream_unavailable', estimatedReceive: null, expiresAt: null,
  };
  const makeClient = quote => createMxnCheckoutClient({ fetchImpl: async () => respond({ quote }) });
  assert.deepEqual(await makeClient(unavailable).getFundingQuote(input), unavailable);
  for (const quote of [
    { ...indicative, pronosSubsidyMxn: '1' },
    { ...indicative, debit: { asset: 'pUSD', amount: '5' } },
    { ...indicative, ticketMxn: 300 },
    { ...indicative, executable: true },
  ]) {
    await assert.rejects(makeClient(quote).getFundingQuote(input), /verificar la cotización de fondeo/);
  }
});
