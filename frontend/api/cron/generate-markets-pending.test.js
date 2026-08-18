/**
 * Static behavior checks for the daily pending-market generator cron.
 *
 * Run with:
 *   node --test frontend/api/cron/generate-markets-pending.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./generate-markets-pending.js', import.meta.url), 'utf8');
const vercelConfig = await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8');

test('daily pending generator is the 9am Mexico City trophy approval job', () => {
  assert.match(source, /approveTournamentPendingMarkets/);
  assert.match(source, /export function shouldAutoApproveTournamentPendingMarkets/);
  assert.match(source, /timeZone:\s*TROPHY_AUTO_APPROVAL_TIMEZONE/);
  assert.match(source, /return hour === 9/);
  assert.match(source, /shouldAutoApproveTournamentPendingMarkets\(\)\s*\?\s*await approveTournamentPendingMarkets\(\)/);
  assert.match(source, /outside_09_mexico_city_hour/);
  assert.match(source, /trophyAutoApproval/);
  assert.match(source, /15:00 UTC, which is 09:00 in Mexico City/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/generate-markets-pending"[\s\S]*"schedule": "0 15 \* \* \*"/);
});
