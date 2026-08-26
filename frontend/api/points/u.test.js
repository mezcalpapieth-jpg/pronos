import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./u.js', import.meta.url), 'utf8');

test('public profile history includes cancellation refunds', () => {
  assert.match(source, /const refundRows = await sql`/);
  assert.match(source, /d\.kind IN \('market_cancel_refund', 'void_refund', 'invalid_field_refund', 'redemption_reversal'\)/);
  assert.match(source, /'refund' AS side/);
  assert.match(source, /buildPublicProfileHistory\(\[\.\.\.tradeRows, \.\.\.refundRows\]\)/);
});
