import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addParlayLeg,
  parlayPayloadLegs,
  sanitizeParlaySlip,
} from './combinadaSlip.js';

test('combinada slip replaces another leg from the same exposure group', () => {
  const current = [{
    marketId: 101,
    outcomeIndex: 0,
    groupId: 10,
    question: 'Final',
    outcomeLabel: 'Equipo A - Si',
    price: 0.4,
  }];

  const next = {
    marketId: 102,
    outcomeIndex: 1,
    groupId: 10,
    question: 'Final',
    outcomeLabel: 'Equipo B - No',
    price: 0.55,
  };

  const slip = addParlayLeg(current, next);
  assert.equal(slip.length, 1);
  assert.equal(slip[0].marketId, 102);
  assert.equal(slip[0].outcomeIndex, 1);
  assert.deepEqual(parlayPayloadLegs(slip), [{ marketId: 102, outcomeIndex: 1 }]);
});

test('combinada slip keeps the last six valid market groups', () => {
  const slip = sanitizeParlaySlip(Array.from({ length: 8 }, (_, index) => ({
    marketId: index + 1,
    outcomeIndex: 0,
    groupId: index + 1,
    question: `Mercado ${index + 1}`,
    outcomeLabel: 'Si',
    price: 0.5,
  })));

  assert.equal(slip.length, 6);
  assert.deepEqual(slip.map(leg => leg.marketId), [3, 4, 5, 6, 7, 8]);
});
