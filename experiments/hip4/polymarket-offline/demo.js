import assert from 'node:assert/strict';
import { assetId, createMockVenue, fixtureUtcDay, owner, suborgId } from './mock-venue.js';
import { createOfflineWorkflow } from './workflow.js';
import { utils } from 'ethers';

export const buyIntent = { intentId: 'test-buy', assetId, side: 'buy', amount: '10', limitPrice: '0.50' };
export const sellIntent = { intentId: 'test-sell', assetId, side: 'sell', amount: '10', limitPrice: '0.45' };

export async function setup(options) {
  const mock = createMockVenue(options);
  const pilot = await createOfflineWorkflow({
    owner, suborgId, signTypedData: mock.signTypedData, transport: mock.transport,
  });
  mock.transport.fund(pilot.wallet, '30');
  return { mock, pilot };
}

export async function runDemo() {
  const { mock, pilot } = await setup();
  const approvals = await pilot.approveTrading('20');
  const initialBuyStatus = await pilot.order(buyIntent);
  const buy = await pilot.order(buyIntent);
  const sell = await pilot.order(sellIntent);
  const withdrawal = await pilot.withdraw({ intentId: 'test-withdrawal', amount: '10' });
  assert.deepEqual(mock.failures, []);
  const builderFeeAudit = pilot.auditBuilderFees(fixtureUtcDay);
  return {
    mode: 'offline fixture', owner: pilot.owner, depositWallet: pilot.wallet, approvals: approvals.approved,
    initialBuyStatus: initialBuyStatus.status, buy, sell, orderAttempts: mock.orderAttempts, withdrawal,
    builderFeeAudit,
    endingDepositWalletCash: utils.formatUnits(mock.transport.readWallet(pilot.wallet).cash.toString(), 6),
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  console.log(JSON.stringify(await runDemo(), null, 2));
}
