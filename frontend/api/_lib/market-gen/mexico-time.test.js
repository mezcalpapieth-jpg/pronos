import test from 'node:test';
import assert from 'node:assert/strict';

import {
  endOfMexicoMonthClose,
  formatMexicoDateEs,
  formatMexicoDateYmd,
  mexicoIsoWeekKey,
  mexicoMonthKey,
  mexicoMonthNameEs,
  nextMexicoFridayClose,
} from './mexico-time.js';

function mexicoClock(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

test('nextMexicoFridayClose resolves to Friday 23:59 in Mexico City', () => {
  const close = nextMexicoFridayClose(new Date('2026-08-06T10:00:00.000Z'));

  assert.equal(mexicoClock(close), '2026-08-07 23:59:00');
  assert.equal(formatMexicoDateYmd(close), '2026-08-07');
  assert.equal(formatMexicoDateEs(close), '07/08/2026');
  assert.equal(mexicoIsoWeekKey(close), '2026-W32');
});

test('nextMexicoFridayClose skips same-day Friday to keep a full week open', () => {
  const close = nextMexicoFridayClose(new Date('2026-08-07T14:00:00.000Z'));

  assert.equal(mexicoClock(close), '2026-08-14 23:59:00');
  assert.equal(formatMexicoDateYmd(close), '2026-08-14');
  assert.equal(mexicoIsoWeekKey(close), '2026-W33');
});

test('endOfMexicoMonthClose resolves to the last day at 23:59 Mexico City', () => {
  const close = endOfMexicoMonthClose(new Date('2026-08-07T12:00:00.000Z'));

  assert.equal(mexicoClock(close), '2026-08-31 23:59:00');
  assert.equal(mexicoMonthKey(close), '2026-08');
  assert.equal(mexicoMonthNameEs(close), 'agosto');
});
