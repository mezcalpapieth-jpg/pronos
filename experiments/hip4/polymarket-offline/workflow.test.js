import assert from 'node:assert/strict';
import test from 'node:test';
import { Wallet } from 'ethers';
import { POLYMARKET_BUILDER_PROFILE } from '../../../frontend/api/_lib/polymarket-builder.js';
import { buyIntent, runDemo, sellIntent, setup } from './demo.js';
import { createMockVenue, fixtureUtcDay, owner, suborgId } from './mock-venue.js';
import { createOfflineWorkflow, micros } from './workflow.js';

test('rehearses wallet provisioning, both approvals, buy, sell, and reconciled owner withdrawal', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('A real fetch was attempted'); });
  const result = await runDemo();
  assert.equal(result.mode, 'offline fixture');
  assert.notEqual(result.owner, result.depositWallet);
  assert.equal(result.approvals, 2);
  assert.equal(result.initialBuyStatus, 'unknown');
  assert.equal(result.buy.status, 'partial');
  assert.equal(result.buy.signedMakerAmount, '9.7');
  assert.equal(result.buy.signedTakerAmount, '19.4');
  assert.deepEqual(
    [result.buy.shares, result.buy.gross, result.buy.venueFee, result.buy.builderFee, result.buy.net],
    ['10.0', '5.0', '0.125', '0.025', '5.15'],
  );
  assert.equal(result.sell.status, 'filled');
  assert.deepEqual(
    [result.sell.shares, result.sell.gross, result.sell.venueFee, result.sell.builderFee, result.sell.net],
    ['10.0', '4.5', '0.12375', '0.0225', '4.35375'],
  );
  assert.equal(result.orderAttempts, 2);
  assert.equal(result.withdrawal.status, 'confirmed');
  assert.equal(result.withdrawal.debited, '10.0');
  assert.equal(result.withdrawal.credited, '10.0');
  assert.equal(result.endingDepositWalletCash, '19.20375');
  assert.deepEqual(result.builderFeeAudit, {
    status: 'below_minimum', accrued: '0.0475', credited: '0.0', reference: null,
  });
});

test('blocks insufficient allowance and sells without confirmed shares, and skips already granted approvals', async () => {
  const { mock, pilot } = await setup();
  await assert.rejects(pilot.order(buyIntent), /Insufficient balance or approval/);
  assert.equal(mock.orderAttempts, 0);
  assert.equal((await pilot.approveTrading('20')).approved, 2);
  assert.equal((await pilot.approveTrading('20')).approved, 0);
  assert.equal((await pilot.approveTrading('25')).approved, 1);
  await assert.rejects(pilot.order(sellIntent), /Insufficient balance or approval/);
  assert.equal(mock.orderAttempts, 0);
  assert.equal(mock.transport.readWallet(pilot.wallet).allowance, micros('25'));
  assert.deepEqual(mock.signing.map(payload => payload.primaryType), ['ClobAuth', 'Batch', 'Batch']);
  assert.deepEqual(mock.failures, []);
});

test('does not resubmit an ambiguous order or accept different terms for its intent ID', async () => {
  const { mock, pilot } = await setup();
  await pilot.approveTrading('20');
  const initial = await pilot.order(buyIntent);
  assert.equal(initial.status, 'unknown');
  const recovered = await pilot.order(buyIntent);
  assert.equal(recovered.orderHash, initial.orderHash);
  assert.equal(recovered.status, 'partial');
  await assert.rejects(pilot.order({ ...buyIntent, amount: '9' }), /different terms/);
  assert.equal(mock.orderAttempts, 1);
  const [orderSignature] = mock.signing.filter(payload => payload.primaryType === 'TypedDataSign');
  assert.equal(orderSignature.message.contents.builder, POLYMARKET_BUILDER_PROFILE.code);
  assert.equal(orderSignature.message.contents.signatureType, '3');
  assert.equal(orderSignature.message.contents.maker, pilot.wallet);
  assert.equal(orderSignature.message.contents.signer, pilot.wallet);
  assert.deepEqual(mock.failures, []);
});

test('keeps an accepted delayed order pending and a rejected order terminal across retries', async () => {
  for (const [options, expected] of [[{ leaveOrderPending: true }, 'pending'], [{ rejectOrders: true }, 'rejected']]) {
    const { mock, pilot } = await setup(options);
    await pilot.approveTrading('20');
    const first = await pilot.order(buyIntent);
    assert.equal(first.status, expected);
    assert.deepEqual(await pilot.order(buyIntent), first);
    assert.equal(mock.orderAttempts, 1);
    assert.equal(mock.transport.readWallet(pilot.wallet).shares, 0n);
    assert.deepEqual(mock.failures, []);
  }
});

test('blocks a Turnkey signature recovering to another owner before CLOB credential creation', async () => {
  const mock = createMockVenue();
  const wrongOwner = new Wallet('0x' + '02'.padStart(64, '0'));
  await assert.rejects(createOfflineWorkflow({
    owner, suborgId, transport: mock.transport,
    async signTypedData({ payload: { domain, types: { EIP712Domain, ...types }, message } }) {
      return wrongOwner._signTypedData(domain, types, message);
    },
  }), /could not sign|wallet owner/i);
  assert.ok(!mock.requests.some(request => request.endsWith('/auth/api-key')));
  assert.deepEqual(mock.failures, []);
});

test('fails reconciliation on a venue fee or builder attribution mismatch', async () => {
  const { mock, pilot } = await setup();
  await pilot.approveTrading('20');
  await pilot.order(buyIntent);
  const readOrder = mock.transport.readOrder;
  for (const [key, value, expected] of [
    ['venueFee', '0.01', /Venue fee does not reconcile/],
    ['builderFee', '0.01', /Builder fee or attribution/],
    ['builderCode', '0x' + '00'.repeat(32), /Builder fee or attribution/],
  ]) {
    mock.transport.readOrder = hash => {
      const receipt = readOrder(hash);
      receipt.fills[0][key] = value;
      return receipt;
    };
    await assert.rejects(pilot.order(buyIntent), expected);
  }
  assert.equal(mock.orderAttempts, 1);
});

test('reconciles an above-threshold UTC day against a distinct payout credit', async () => {
  const { mock, pilot } = await setup({ loseBuyResponse: false });
  await pilot.approveTrading('30');
  for (let i = 0; i < 4; i++) {
    const result = await pilot.order({ ...buyIntent, intentId: 'buy-' + i });
    assert.equal(result.status, 'partial');
  }
  const pending = pilot.auditBuilderFees(fixtureUtcDay);
  assert.equal(pending.status, 'awaiting_credit');
  assert.equal(pending.accrued, '0.1');
  mock.creditBuilder(fixtureUtcDay, '0.09');
  assert.equal(pilot.auditBuilderFees(fixtureUtcDay).status, 'mismatch');
  mock.creditBuilder(fixtureUtcDay, '0.10');
  assert.equal(pilot.auditBuilderFees(fixtureUtcDay).status, 'credited');
  assert.equal(pilot.auditBuilderFees('2026-11-12').accrued, '0.0');
  assert.deepEqual(mock.failures, []);
});

test('a lost withdrawal acknowledgement leaves the same intent unresolved without a second debit', async () => {
  const { mock, pilot } = await setup({ loseWithdrawalResponse: true });
  const intent = { intentId: 'withdraw', amount: '10' };
  assert.deepEqual(await pilot.withdraw(intent), { status: 'unknown' });
  assert.deepEqual(await pilot.withdraw(intent), { status: 'unknown' });
  await assert.rejects(pilot.withdraw({ ...intent, amount: '5' }), /different amount/);
  assert.equal(mock.relays, 2);
  assert.equal(mock.transport.readWallet(pilot.wallet).cash, micros('20'));
  assert.equal(mock.transport.readCash(pilot.owner), micros('10'));
  assert.deepEqual(mock.failures, []);
});
