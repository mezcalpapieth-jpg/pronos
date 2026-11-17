import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketCloseCalendar, marketCryptoPriceCsv, marketProbabilityCsv } from './marketExports.js';

test('calendar closes at the same instant across time zones and escapes multiline UTF-8 titles', () => {
  const title = '¿Sí, no; quizá? \\ notas\n' + '🎯'.repeat(25);
  const output = marketCloseCalendar({
    marketId: 18,
    title,
    endTime: '2026-11-17T21:05:00-06:00',
    now: '2026-11-17T01:02:03.000Z',
    origin: 'https://pronos.io',
  });
  assert.match(output, /DTSTART:20261118T030500Z\r\n/);
  assert.match(output, /DTSTAMP:20261117T010203Z\r\n/);
  assert.match(output, /UID:pronos-market-18@pronos\.io/);
  assert.match(output, /URL:https:\/\/pronos\.io\/market\?id=18/);
  const summary = output.replaceAll('\r\n ', '').split('\r\n').find(line => line.startsWith('SUMMARY:'));
  assert.equal(summary, 'SUMMARY:¿Sí\\, no\\; quizá? \\\\ notas\\n' + '🎯'.repeat(25));
  assert.ok(output.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  assert.equal(marketCloseCalendar({ endTime: null }), null);
});

test('market CSV exports actual visible samples and neutralizes formulas in outcome names', () => {
  const start = 1_763_000_000;
  const output = marketProbabilityCsv([
    { label: 'Sí, "ahora"', data: [{ t: start, p: 69.41 }, { t: start + 1, p: 71 }, { t: start + 1, p: 72 }, { t: start + 20, p: 70 }] },
    { label: '  =SUM(1,2)', data: [{ t: start + 1, p: 28 }] },
    { label: 'Empty', data: [{ t: start, p: null }] },
  ], { start, end: start + 1 });
  assert.deepEqual(output.trim().split('\r\n'), [
    'timestamp_utc,outcome,probability_percent',
    `${new Date(start * 1000).toISOString()},"Sí, ""ahora""",69.41`,
    `${new Date((start + 1) * 1000).toISOString()},"Sí, ""ahora""",72`,
    `${new Date((start + 1) * 1000).toISOString()},"'  =SUM(1,2)",28`,
  ]);
  assert.equal(marketProbabilityCsv([{ label: 'No', data: [] }]), null);
});

test('crypto CSV preserves milliseconds and asset price rather than market probability', () => {
  const time = 1_763_000_000_123;
  assert.equal(marketCryptoPriceCsv([{ t: time, price: 87345.12 }]), [
    'timestamp_utc,price_usd',
    `${new Date(time).toISOString()},87345.12`,
    '',
  ].join('\r\n'));
});
