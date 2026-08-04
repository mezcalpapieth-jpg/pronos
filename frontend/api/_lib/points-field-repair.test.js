import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildTournamentFieldRepairPlan,
  normalizeFieldLabel,
} from './points-field-repair.js';

test('normalizeFieldLabel compares accents, casing, and punctuation safely', () => {
  assert.equal(normalizeFieldLabel('Joaquín Niemann'), 'joaquin niemann');
  assert.equal(normalizeFieldLabel('  OTRÓ!! '), 'otro');
});

test('buildTournamentFieldRepairPlan keeps confirmed legs, adds missing entrants, and refunds invalid active legs', () => {
  const plan = buildTournamentFieldRepairPlan({
    parent: { id: 10, question: '¿Quién gana el National Bank Open?', source: 'espn-atp-tournament' },
    children: [
      { id: 11, leg_label: 'Carlos Alcaraz', status: 'active' },
      { id: 12, leg_label: 'Jannik Sinner', status: 'active' },
      { id: 13, leg_label: 'Alexander Zverev', status: 'active' },
      { id: 14, leg_label: 'Otro', status: 'active' },
      { id: 15, leg_label: 'Novak Djokovic', status: 'canceled' },
    ],
    confirmed: {
      ok: true,
      source: 'espn-atp-tournament',
      eventId: '401',
      entries: [
        { label: 'Alexander Zverev', driverId: '2375' },
        { label: 'Taylor Fritz', driverId: '2946' },
        { label: 'Otro', driverId: null },
      ],
    },
    refundRows: [
      { market_id: 11, username: 'frmm', amount: '125.50' },
      { market_id: 12, username: 'mezcal', amount: '80' },
    ],
  });

  assert.deepEqual(plan.keptEntries.map(e => e.label), ['Alexander Zverev', 'Otro']);
  assert.deepEqual(plan.addedEntries.map(e => e.label), ['Taylor Fritz']);
  assert.deepEqual(plan.invalidChildren.map(row => row.leg_label), ['Carlos Alcaraz', 'Jannik Sinner']);
  assert.deepEqual(plan.blockedEntries, []);
  assert.equal(plan.refundCount, 2);
  assert.equal(plan.totalRefunded, 205.5);
});

test('repair implementation writes invalid-field refund audit rows', () => {
  const source = fs.readFileSync(new URL('./points-field-repair.js', import.meta.url), 'utf8');
  assert.match(source, /invalid_field_refund/);
  assert.match(source, /Participante fuera del draw\/campo confirmado/);
});
