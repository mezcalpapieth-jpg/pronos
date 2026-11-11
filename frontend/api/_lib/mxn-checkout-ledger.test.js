import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  createMxnCheckoutLedger, MXN_CHECKOUT_LEDGER_SCHEMA, normalizeMxnCheckoutLedgerEvent,
} from './mxn-checkout-ledger.js';

const user = { environment: 'testnet', venue: 'hip4', accountId: 'user-1' };
const builder = { ...user, accountType: 'builder' };
const later = '2026-11-11T02:00:00.005Z';

function event(overrides = {}) {
  return {
    ...user, source: 'bitso', kind: 'deposit', reference: 'payment-100',
    eventId: 'payment-100-pending', occurredAt: '2026-11-11T01:00:00Z',
    status: 'pending', asset: 'USDC', mxnAmount: '100.00', quoteId: 'quote-100',
    ...overrides,
  };
}

function fill(overrides = {}) {
  return event({
    source: 'hyperliquid', kind: 'fill', reference: 'fill-1', eventId: 'fill-1',
    status: 'confirmed', amount: '4.000000000000000001', mxnAmount: null, quoteId: null,
    marketId: '#102', orderId: 'order-1', side: 'buy', shares: '8',
    venueFeeAmount: '0.004', builderFeeAmount: '0.01', ...overrides,
  });
}

test('normalization accepts exact decimal strings and rejects malformed or mismatched evidence', () => {
  const normalized = normalizeMxnCheckoutLedgerEvent(event({ amount: '5.1000' }));
  assert.equal(normalized.amount, '5.1');
  assert.equal(normalized.mxnAmount, '100');
  assert.equal(normalized.occurredAt, '2026-11-11T01:00:00.000Z');

  for (const input of [
    event({ amount: 5 }), event({ amount: '1e-4' }), event({ amount: '1\n' }), event({ amount: '1.0000000000000000001' }),
    event({ occurredAt: '2026-11-31T01:00:00Z' }), event({ eventId: 'event\n' }),
    event({ source: 'bitso\n' }), event({ venue: 'polymarket' }), event({ mxnAmount: '100.001' }),
    event({ status: 'confirmed' }), event({ estimatedFee: '0.50' }),
    fill({ status: 'pending' }), fill({ orderId: undefined }), fill({ venueFeeAmount: '-0.01' }),
  ]) assert.throws(() => normalizeMxnCheckoutLedgerEvent(input), /^Error: invalid_ledger_/);
});

test('Postgres ledger reconciles confirmed transfers, actual fill fees, and credited builder payouts', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const ddl of MXN_CHECKOUT_LEDGER_SCHEMA) await db.exec(ddl);
  const makeLedger = () => createMxnCheckoutLedger({ withTransaction: fn => db.transaction(fn) });
  const ledger = makeLedger();

  for (const [venue, asset] of [['hip4', 'USDC'], ['polymarket', 'pUSD']]) {
    for (const amountMxn of ['100', '300', '1000']) {
      const reference = `${venue}-payment-${amountMxn}`;
      const pending = event({ venue, asset, reference, eventId: `${reference}-pending`,
        mxnAmount: amountMxn, quoteId: `quote-${amountMxn}` });
      const confirmed = { ...pending, eventId: `${reference}-confirmed`, occurredAt: later,
        status: 'confirmed', amount: '1.123456789123456789' };
      assert.equal((await ledger.record(confirmed)).recorded, true);
      assert.equal((await ledger.record(pending)).recorded, true);
      assert.equal((await makeLedger().record(confirmed)).recorded, false);

      const cashout = `${venue}-cashout-${amountMxn}`;
      const withdrawal = event({ venue, asset, kind: 'withdrawal', reference: cashout,
        eventId: `${cashout}-pending`, mxnAmount: amountMxn, quoteId: null });
      assert.equal((await ledger.record(withdrawal)).recorded, true);
      assert.equal((await ledger.record({ ...withdrawal, eventId: `${cashout}-confirmed`,
        occurredAt: later, status: 'confirmed', amount: '1.2' })).recorded, true);
    }
  }
  await ledger.record(event({ reference: 'failed', eventId: 'failed-1', status: 'failed', amount: '1' }));
  await ledger.record(event({ reference: 'pending', eventId: 'pending-1', amount: '2' }));

  const actualFill = fill();
  await ledger.record(actualFill);
  await ledger.record(fill({ reference: 'fill-2', eventId: 'fill-2', side: 'sell',
    amount: '2', builderFeeAmount: null, venueFeeAmount: '0.000' }));

  const payout = event({
    source: 'hyperliquid', kind: 'builder_payout', reference: 'payout-1', eventId: 'payout-1',
    mxnAmount: null, quoteId: null, status: 'confirmed', amount: '0.009',
  });
  await ledger.record(payout);
  assert.equal((await ledger.record(payout)).recorded, false);

  await ledger.record(event({ accountId: 'user-2', reference: 'other-account', eventId: 'other-account',
    amount: '30', status: 'confirmed' }));
  await ledger.record(event({ venue: 'polymarket', asset: 'pUSD', reference: 'other-venue', eventId: 'other-venue',
    amount: '40', mxnAmount: null, status: 'confirmed' }));
  await ledger.record(event({ venue: 'polymarket', asset: 'pUSD', kind: 'withdrawal',
    reference: 'unknown-cashout', eventId: 'unknown-cashout', amount: '2', mxnAmount: null,
    status: 'confirmed' }));
  await ledger.record(event({ environment: 'mainnet', status: 'confirmed', amount: '50' }));
  assert.deepEqual(await ledger.totals(user), [{
    venue: 'hip4', asset: 'USDC', deposits: '3.370370367370370367', withdrawals: '3.6',
    mxnDeposits: '1400', mxnWithdrawals: '1400', depositsWithUnknownMxn: '0', withdrawalsWithUnknownMxn: '0',
    fillNotional: '6.000000000000000001',
    venueFeesReported: '0.004', builderFeesReported: '0.01', builderPayoutsCredited: '0',
    fillsWithUnknownVenueFee: '0', fillsWithUnknownBuilderFee: '1',
  }]);
  const [builderTotals] = await ledger.totals(builder);
  assert.equal(builderTotals.builderPayoutsCredited, '0.009');
  assert.equal(builderTotals.builderFeesReported, '0');
  const [polyTotals] = await ledger.totals({ ...user, venue: 'polymarket' });
  assert.equal(polyTotals.asset, 'pUSD');
  assert.equal(polyTotals.deposits, '43.370370367370370367');
  assert.equal(polyTotals.withdrawals, '5.6');
  assert.equal(polyTotals.mxnDeposits, '1400');
  assert.equal(polyTotals.mxnWithdrawals, '1400');
  assert.equal(polyTotals.depositsWithUnknownMxn, '1');
  assert.equal(polyTotals.withdrawalsWithUnknownMxn, '1');
  assert.equal((await ledger.totals({ ...user, environment: 'mainnet' }))[0].deposits, '50');
  assert.equal((await ledger.totals({ ...user, accountId: 'absent' })).length, 0);

  const history = await ledger.list(user);
  assert.equal(history.length, 16);
  assert(history.every(row => row.venue === 'hip4' && row.accountId === user.accountId && row.kind !== 'builder_payout'));
  assert.equal(history.find(row => row.eventId === 'fill-1').amount, '4.000000000000000001');
  assert.equal((await ledger.list({ ...user, limit: 2 })).length, 2);
  assert.deepEqual(await ledger.list(builder), [normalizeMxnCheckoutLedgerEvent(payout)]);
});

test('Postgres ledger deduplicates concurrent writes and rejects conflicting identity or state', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const ddl of MXN_CHECKOUT_LEDGER_SCHEMA) await db.exec(ddl);
  const ledger = createMxnCheckoutLedger({ withTransaction: fn => db.transaction(fn) });
  const pending = event();
  const replay = await Promise.all([ledger.record(pending), ledger.record(pending)]);
  assert.equal(replay.filter(result => result.recorded).length, 1);
  await assert.rejects(ledger.record(event({ amount: '1' })), { code: 'ledger_event_conflict' });
  await assert.rejects(ledger.record(event({ reference: 'other' })), { code: 'ledger_event_conflict' });
  await assert.rejects(ledger.record(event({ accountId: 'user-2' })), { code: 'ledger_entry_conflict' });
  await assert.rejects(ledger.record(event({ venue: 'polymarket', asset: 'pUSD' })), { code: 'ledger_entry_conflict' });
  await assert.rejects(ledger.record(event({ eventId: 'different-pending' })), { code: 'ledger_status_conflict' });

  const receipt = event({ eventId: 'payment-100-confirmed', occurredAt: later, status: 'confirmed', amount: '1' });
  await assert.rejects(ledger.record({ ...receipt, quoteId: 'different-quote' }), { code: 'ledger_entry_conflict' });
  await assert.rejects(ledger.record({ ...receipt, occurredAt: '2026-11-11T00:00:00Z' }), { code: 'ledger_event_out_of_order' });
  assert.equal((await ledger.record(receipt)).recorded, true);
  await assert.rejects(ledger.record(event({ eventId: 'payment-100-failed', occurredAt: later, status: 'failed' })),
    { code: 'ledger_status_conflict' });
  assert.equal((await ledger.list(user)).length, 2);
  const { rows } = await db.query('SELECT COUNT(*)::integer AS count FROM mxn_checkout_ledger_entries');
  assert.equal(rows[0].count, 1);
});


test('an on-disk Postgres ledger reopens and accepts receipt replay without a duplicate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pronos-mxn-ledger-'));
  const dataDir = join(directory, 'db');
  const receipt = event({ eventId: 'receipt', status: 'confirmed', amount: '5.55' });
  let db = new PGlite(dataDir);
  try {
    for (const ddl of MXN_CHECKOUT_LEDGER_SCHEMA) await db.exec(ddl);
    const ledger = createMxnCheckoutLedger({ withTransaction: fn => db.transaction(fn) });
    await ledger.record(receipt);
    await db.close();

    db = new PGlite(dataDir);
    const reopened = createMxnCheckoutLedger({ withTransaction: fn => db.transaction(fn) });
    assert.equal((await reopened.record(receipt)).recorded, false);
    assert.deepEqual(await reopened.list(user), [normalizeMxnCheckoutLedgerEvent(receipt)]);
    assert.equal((await reopened.totals(user))[0].deposits, '5.55');
  } finally {
    await db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
