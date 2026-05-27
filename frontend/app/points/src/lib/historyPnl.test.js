import test from 'node:test';
import assert from 'node:assert/strict';

import { historyPnlValue } from './historyPnl.js';

test('lost history PnL shows the invested loss instead of the final market value', () => {
  const pnl = historyPnlValue({
    outcomeStatus: 'lost',
    netPnl: -37,
    markToMarket: 63,
    totalInvested: 100,
    totalReceived: 0,
  });

  assert.equal(pnl, -100);
});

test('lost public profile PnL uses buy collateral when total invested is not present', () => {
  const pnl = historyPnlValue({
    outcomeStatus: 'lost',
    netPnl: -12,
    markToMarket: 188,
    buyCollateral: 200,
    sellProceeds: 0,
  });

  assert.equal(pnl, -200);
});

test('lost history PnL subtracts early sale proceeds from invested amount', () => {
  const pnl = historyPnlValue({
    outcomeStatus: 'lost',
    netPnl: -20,
    totalInvested: 100,
    totalReceived: 35,
  });

  assert.equal(pnl, -65);
});

test('non-lost history PnL keeps the backend net PnL', () => {
  const pnl = historyPnlValue({
    outcomeStatus: 'won',
    netPnl: 48.5,
    totalInvested: 100,
    totalReceived: 148.5,
  });

  assert.equal(pnl, 48.5);
});
