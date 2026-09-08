import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferBeforeMonthDeadline,
  validateBeforeMonthDeadline,
} from './manual-deadline-sanity.js';

test('infers before-month deadline year from launch date', () => {
  const deadline = inferBeforeMonthDeadline('¿Habrá algo antes de Septiembre?', {
    anchorDate: new Date('2026-08-11T16:00:00.000Z'),
  });

  assert.deepEqual(deadline, {
    month: 9,
    year: 2026,
    label: 'septiembre 2026',
  });
});

test('flags question and resolution criteria deadline mismatch', () => {
  const check = validateBeforeMonthDeadline({
    question: '¿Habrá un nuevo bombardeo dentro de Irán antes de Septiembre?',
    endTime: '2027-09-01T04:59:00.000Z',
    resolverConfig: {
      launchDate: '2026-08-11',
      criteria: 'después del 11 de agosto de 2026 y antes del 1 de enero de 2027',
    },
  });

  assert.equal(check.error, 'deadline_question_mismatch');
  assert.match(check.detail, /septiembre 2026/);
  assert.match(check.detail, /enero 2027/);
});

test('flags question and stored end_time mismatch', () => {
  const check = validateBeforeMonthDeadline({
    question: '¿Habrá un nuevo bombardeo dentro de Irán antes de Septiembre?',
    endTime: '2027-09-01T04:59:00.000Z',
    resolverConfig: {
      launchDate: '2026-08-11',
      criteria: 'resolver con fuentes oficiales',
    },
  });

  assert.equal(check.error, 'deadline_question_mismatch');
  assert.match(check.detail, /end_time is 2027-09-01T04:59:00.000Z/);
});

test('allows a matching September close with timezone drift', () => {
  const check = validateBeforeMonthDeadline({
    question: '¿Habrá un nuevo bombardeo dentro de Irán antes de Septiembre?',
    endTime: '2026-09-01T05:59:00.000Z',
    resolverConfig: {
      launchDate: '2026-08-11',
      criteria: 'resolver con fuentes oficiales antes de septiembre',
    },
  });

  assert.equal(check, null);
});
