import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('CRE resolve endpoint is guarded by the protocol resolution report boundary', async () => {
  const source = await readFile(new URL('./resolve-market.js', import.meta.url), 'utf8');

  assert.match(source, /assertAuthorizedCreRequest/);
  assert.match(source, /normalizeProtocolResolutionReport/);
  assert.match(source, /validateProtocolResolutionReportForMarket/);
  assert.match(source, /resolveMarketOnChain/);
  assert.match(source, /CRE_RESOLUTION_WEBHOOK_SECRET/);
});
