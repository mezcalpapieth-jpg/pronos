import assert from 'node:assert/strict';
import test from 'node:test';
import { createSandboxWorkflow } from './etherfuse-sandbox.mjs';

const org = 'aaaaaaaa-0000-0000-0000-000000000001';
const bank = 'bbbbbbbb-0000-0000-0000-000000000001';
const walletId = 'cccccccc-0000-0000-0000-000000000001';
const walletAddress = '0x0000000000000000000000000000000000000011';
const token = '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const otherUsdc = { chain: 'monad', asset: '0x0000000000000000000000000000000000000022', symbol: 'USDC', currency: 'USD' };
const fundingAddress = '0x0000000000000000000000000000000000000033';
const now = Date.parse('2026-11-18T18:00:00Z');
const future = new Date(now + 120_000).toISOString();

function rehearsal({ inputAddress = walletAddress, registrationAddress = walletAddress } = {}) {
  const accounts = new Map();
  const quotes = new Map();
  const orders = new Map();
  const deposits = [];
  const api = {
    async org() { return { id: org }; },
    async registerAccount(orgId, request) {
      assert.equal(orgId, org);
      const isBank = request.kind === 'bank';
      const id = isBank ? bank : walletId;
      const rail = isBank ? 'spei' : 'monad';
      assert.deepEqual(request.accountDetails, isBank ? { kind: 'clabe', clabe: '012180000000000002' }
        : { kind: 'address', address: registrationAddress, chain: rail });
      const ready = { status: 'ready' };
      accounts.set(id, { id, kind: request.kind, rails: { [rail]: { source: ready, destination: ready } } });
      return { id };
    },
    async account(_orgId, id) { return accounts.get(id); },
    async assets(orgId, accountId) {
      assert.equal(orgId, org);
      assert.equal(accountId, walletId);
      return { tokens: [otherUsdc, { chain: 'monad', asset: token, symbol: 'USDC', currency: 'USD' }] };
    },
    async quote(_orgId, request) {
      const deposit = request.sourceRail === 'spei';
      assert.equal(request.partnerFeeBpsOverride, 0);
      assert.equal(deposit ? request.destinationAsset : request.sourceAsset, token);
      if (deposit && Number(request.sourceAmount) > 500) {
        throw Object.assign(new Error('sandbox-limit-exceeded'), { code: 'sandbox-limit-exceeded' });
      }
      const quoteId = `abababab-0000-0000-0000-${String(quotes.size + 1).padStart(12, '0')}`;
      const sourceAmount = Number(request.sourceAmount);
      const quote = {
        quoteId, sourceRail: request.sourceRail, destinationRail: request.destinationRail, sourceAsset: request.sourceAsset,
        destinationAsset: request.destinationAsset, sourceAmount: request.sourceAmount,
        destinationAmount: (deposit ? sourceAmount * 0.998 / 20 : sourceAmount * 0.998 * 20).toFixed(6),
        fees: [{ type: 'transactionFee', asset: request.sourceAsset, amount: (sourceAmount * 0.002).toFixed(6), bps: 20 }],
        expiresAt: future,
      };
      quotes.set(quoteId, { quote, request });
      return structuredClone(quote);
    },
    async createOrder(_orgId, id) {
      const { quote, request } = quotes.get(id);
      const deposit = request.sourceRail === 'spei';
      if (!orders.has(id)) {
        orders.set(id, {
          id, organizationId: org, status: 'created', fees: quote.fees,
          source: { asset: quote.sourceAsset, rail: quote.sourceRail, amount: quote.sourceAmount, paymentAccountId: request.source.id },
          destination: { asset: quote.destinationAsset, rail: quote.destinationRail,
            amount: quote.destinationAmount, paymentAccountId: request.destination.id },
          fundingInstructions: { rail: quote.sourceRail, fundingDeadline: future, destination: deposit
            ? { clabe: '646180000000000009' } : { address: fundingAddress, expiresAt: null } },
        });
      }
      return orders.get(id);
    },
    async order(_orgId, id) { return orders.get(id); },
    async simulateDeposit(_orgId, id, debit) {
      deposits.push(debit);
      orders.get(id).status = 'funded';
    },
  };
  const pause = async () => { for (const row of orders.values()) if (row.status === 'funded') row.status = 'completed'; };
  const flow = createSandboxWorkflow({ api, walletAddress: inputAddress, now: () => now, pause,
    fx: async () => ({ bid: '20', timeMs: now }) });
  return { api, flow, orders, quotes, deposits };
}

for (const ticket of [100, 300]) {
  test(`MXN ${ticket} deposit registers the Turnkey address, simulates exact SPEI once and reconciles`, async () => {
    const { flow, deposits } = rehearsal();
    const accounts = await flow.setup();
    const quote = await flow.quote(accounts, 'deposit', ticket);
    const first = await flow.open(quote);
    assert.equal(first.id, quote.quote.quoteId);
    assert.equal((await flow.open(quote)).id, first.id);
    await flow.simulateDeposit(quote, send => send());
    await flow.simulateDeposit(quote, send => send());
    assert.deepEqual(deposits, [String(ticket)]);
    assert.equal((await flow.settle(quote)).status, 'completed');
    assert.equal(quote.quote.destinationAmount, ticket === 100 ? '4.990000' : '14.970000');
  });

  test(`MXN ${ticket} equivalent cash-out reconciles only after a wallet-funded mock confirmation`, async () => {
    const { flow, orders, deposits } = rehearsal();
    const accounts = await flow.setup();
    const quote = await flow.quote(accounts, 'withdrawal', ticket);
    const order = await flow.open(quote);
    assert.equal(order.status, 'created');
    assert.equal(Number(order.destination.amount), ticket * 0.998);
    assert.deepEqual(await flow.cashOutTransfer(quote), {
      tokenAddress: token, destinationAddress: fundingAddress, amountUnits: String(ticket * 50_000),
    });
    await assert.rejects(flow.simulateDeposit(quote, send => send()), { code: 'not_a_deposit' });
    assert.deepEqual(deposits, []);
    orders.get(order.id).status = 'funded';
    assert.equal(await flow.cashOutTransfer(quote), null);
    assert.equal((await flow.settle(quote)).status, 'completed');
  });
}

test('MXN 1,000 test passes the provider deposit cap error through and allows a cash-out quote only', async () => {
  const { flow, orders } = rehearsal();
  const accounts = await flow.setup();
  await assert.rejects(flow.quote(accounts, 'deposit', 1000), { code: 'sandbox-limit-exceeded' });
  const quote = await flow.quote(accounts, 'withdrawal', 1000);
  assert.equal(quote.quote.sourceAmount, '50');
  assert.equal(quote.quote.destinationAmount, '998.000000');
  await assert.rejects(flow.open(quote), { code: 'quote_only_ticket' });
  assert.equal(orders.size, 0);
});

test('no mismatched provider route, expired funding, or sponsored/marked-up quote can be funded', async () => {
  const { api, flow, orders } = rehearsal();
  const accounts = await flow.setup();
  const position = await flow.quote(accounts, 'withdrawal', 100);
  const { id } = await flow.open(position);
  const order = orders.get(id);
  order.source.amount = '5.01';
  await assert.rejects(flow.cashOutTransfer(position), { code: 'order_does_not_match_quote' });
  order.source.amount = '5';
  order.fundingInstructions.fundingDeadline = new Date(now).toISOString();
  await assert.rejects(flow.cashOutTransfer(position), { code: 'order_not_open_for_funding' });
  const getQuote = api.quote;
  for (const fee of [{ type: 'partnerFee', amount: '0.01' }, { type: 'walletSponsor', amount: '0' }]) {
    api.quote = async (...args) => {
      const quote = await getQuote(...args);
      quote.fees.push(fee);
      return quote;
    };
    await assert.rejects(flow.quote(accounts, 'deposit', 100), { code: 'unexpected_fee_or_sponsorship' });
  }
});

test('fills only missing sandbox registration fields and reconnects to a same-quote order conflict', async () => {
  const { api, flow } = rehearsal();
  const register = api.registerAccount;
  let requests = 0;
  api.registerAccount = (id, request) => {
    if (request.kind === 'bank') {
      if (requests++ === 0) {
        assert.equal(request.registrationInfo, undefined);
        throw Object.assign(new Error('registration-info-required'), {
          code: 'registration-info-required', missing: ['#/registrationInfo/accountHolderName'],
        });
      }
      assert.deepEqual(request.registrationInfo, { accountHolderName: 'Ejemplo Comercial SA de CV' });
    }
    return register(id, request);
  };
  const accounts = await flow.setup();
  const position = await flow.quote(accounts, 'deposit', 100);
  await flow.open(position);
  api.createOrder = () => { throw Object.assign(new Error('conflict'), { code: 'conflict' }); };
  assert.equal((await flow.open(position)).id, position.quote.quoteId);
});

test('registers the wallet with its EIP-55 checksum and reuses a ready SPEI bank without a bank POST', async () => {
  const checksum = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  const normalized = checksum.toLowerCase();
  const { api, flow } = rehearsal({ inputAddress: normalized, registrationAddress: checksum });
  const account = api.account;
  api.account = async (orgId, id) => {
    assert.equal(orgId, org);
    if (id !== bank) return account(orgId, id);
    return { id, kind: 'bank', status: 'ready', currency: 'MXN',
      rails: { spei: { source: { status: 'ready' }, destination: { status: 'ready' } } } };
  };
  const register = api.registerAccount;
  api.registerAccount = (orgId, request) => {
    assert.equal(request.kind, 'wallet');
    return register(orgId, request);
  };

  const binding = await flow.setup(org, bank);
  assert.deepEqual(binding, { orgId: org, bankId: bank, walletId, wallet: normalized });
  assert.equal((await flow.quote(binding, 'deposit', 100)).request.source.id, bank);
});

test('rejects an incompatible existing bank before registering a wallet', async () => {
  const { api, flow } = rehearsal();
  api.account = async () => ({ id: bank, kind: 'bank', status: 'ready',
    rails: { spei: { currency: 'MXN', source: { status: 'ready' }, destination: { status: 'pending' } } } });
  api.registerAccount = () => assert.fail('registration should be skipped');

  await assert.rejects(flow.setup(org, bank), { code: 'invalid_existing_spei_account' });
  await assert.rejects(flow.setup(org, 'not-a-bank-id'), { code: 'invalid_existing_spei_account' });
});

test('requires Etherfuse to support the Circle Monad testnet USDC contract for the wallet', async () => {
  const { api, flow } = rehearsal();
  const binding = await flow.setup();
  api.assets = async () => ({ tokens: [otherUsdc] });
  api.quote = () => assert.fail('quote should be skipped');
  await assert.rejects(flow.quote(binding, 'deposit', 100), { code: 'monad_testnet_usdc_unavailable' });
});

test('rejects an invalid mixed-case wallet checksum before using the provider', () => {
  assert.throws(() => createSandboxWorkflow({
    api: {}, walletAddress: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  }), { code: 'invalid_turnkey_test_wallet_address' });
});
