import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdminFundingMonitorPayload,
  buildDepositMethods,
  buildFundingHistory,
  buildFundingStatusPayload,
  normalizeJunoTransactionEvent,
} from './juno-funding.js';

test('buildFundingStatusPayload exposes deposit always and withdraw only when wallet has MXNB', () => {
  const payload = buildFundingStatusPayload({
    user: {
      turnkeySubOrgId: 'suborg-1',
      walletAddress: '0x1111111111111111111111111111111111111111',
    },
    fundingAccount: {
      clabe: '710969000000329002',
      blockchainAccountRegistered: true,
      kycStatus: 'approved',
    },
    balance: { balance: 250.5, symbol: 'MXNB', chainId: 42161 },
    junoConfigured: true,
  });

  assert.equal(payload.deposit.label, 'Depositar');
  assert.equal(payload.deposit.enabled, true);
  assert.equal(payload.withdraw.label, 'Retirar');
  assert.equal(payload.withdraw.enabled, true);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.walletAddress, '0x1111111111111111111111111111111111111111');
  assert.equal(payload.clabe, '710969000000329002');
});

test('buildFundingStatusPayload keeps shell safe when Juno env vars are missing', () => {
  const payload = buildFundingStatusPayload({
    user: { turnkeySubOrgId: 'suborg-1', walletAddress: '0x2222222222222222222222222222222222222222' },
    fundingAccount: null,
    balance: { balance: 0, symbol: 'MXNB', chainId: 42161 },
    junoConfigured: false,
  });

  assert.equal(payload.status, 'juno_not_configured');
  assert.equal(payload.deposit.label, 'Depositar');
  assert.equal(payload.deposit.enabled, false);
  assert.equal(payload.withdraw.enabled, false);
  assert.equal(payload.walletAddress, '0x2222222222222222222222222222222222222222');
});

test('normalizeJunoTransactionEvent extracts issuance and wallet delivery fields', () => {
  const event = normalizeJunoTransactionEvent({
    event: 'TRANSACTION',
    payload: {
      type: 'ISSUANCE',
      id: 'd441f9db-e2df-4ca5-9dab-7526efdcea86',
      status: 'COMPLETE',
      external_ref: 'user-ref-12345',
      created_at: '2025-08-04T15:19:22Z',
      updated_at: '2025-08-04T15:20:14Z',
      issuance: {
        network: 'ARBITRUM',
        amount: '100',
        method: 'SPEI',
        asset: 'MXN',
        deposit_receiver_clabe: '710969000000431628',
        crypto_destination_address: '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E',
        crypto_tx_hash: '0xfb98c58faf63d17ce0fd5d41e82c3ae2f9b3721f2c1e369c17b379b4b59fe062',
        external_fiat_id: 'TESTSPEI671271752263456670',
      },
    },
  });

  assert.equal(event.type, 'issuance');
  assert.equal(event.status, 'complete');
  assert.equal(event.amount, '100');
  assert.equal(event.asset, 'MXN');
  assert.equal(event.network, 'ARBITRUM');
  assert.equal(event.receiverClabe, '710969000000431628');
  assert.equal(event.destinationAddress, '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E');
  assert.equal(event.txHash, '0xfb98c58faf63d17ce0fd5d41e82c3ae2f9b3721f2c1e369c17b379b4b59fe062');
});

test('buildDepositMethods keeps SPEI active and cards gated behind provider config', () => {
  const shellMethods = buildDepositMethods({});
  assert.deepEqual(shellMethods.map(m => m.id), ['spei', 'card', 'apple_pay']);
  assert.equal(shellMethods[0].enabled, true);
  assert.equal(shellMethods[0].label, 'SPEI');
  assert.equal(shellMethods[1].enabled, false);
  assert.equal(shellMethods[1].comingSoon, true);
  assert.equal(shellMethods[2].enabled, false);

  const liveMethods = buildDepositMethods({
    JUNO_CARD_CHECKOUT_ENABLED: 'true',
    JUNO_APPLE_PAY_ENABLED: 'true',
  });
  assert.equal(liveMethods[1].enabled, true);
  assert.equal(liveMethods[2].enabled, true);
});

test('buildFundingHistory normalizes deposits and withdrawal requests newest first', () => {
  const history = buildFundingHistory({
    transactionEvents: [
      {
        id: 8,
        transaction_type: 'issuance',
        transaction_status: 'complete',
        amount: '250.50',
        asset: 'MXN',
        tx_hash: '0xabc',
        created_at: '2026-05-18T19:00:00Z',
      },
    ],
    withdrawalRequests: [
      {
        id: 3,
        status: 'pending',
        amount: '100',
        asset: 'MXNB',
        destination_clabe: '012345678901234567',
        requested_at: '2026-05-18T20:00:00Z',
      },
    ],
  });

  assert.equal(history.length, 2);
  assert.equal(history[0].kind, 'withdrawal');
  assert.equal(history[0].label, 'Retiro solicitado');
  assert.equal(history[1].kind, 'deposit');
  assert.equal(history[1].label, 'Depósito recibido');
});

test('buildAdminFundingMonitorPayload summarizes funding issues for admin badges', () => {
  const payload = buildAdminFundingMonitorPayload({
    accounts: [
      { id: 1, wallet_address: '0x111', clabe: null, blockchain_account_registered: false },
      { id: 2, wallet_address: '0x222', clabe: '710969000000329002', blockchain_account_registered: true },
    ],
    withdrawals: [
      { id: 9, amount: '75', status: 'pending' },
    ],
    events: [
      { id: 4, transaction_type: 'issuance', transaction_status: 'pending' },
      { id: 5, transaction_type: 'issuance', transaction_status: 'failed' },
    ],
  });

  assert.equal(payload.counts.missingClabe, 1);
  assert.equal(payload.counts.pendingWalletRegistration, 1);
  assert.equal(payload.counts.pendingWithdrawals, 1);
  assert.equal(payload.counts.stuckDeposits, 1);
  assert.equal(payload.counts.failedEvents, 1);
  assert.equal(payload.counts.total, 5);
});
