import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cryptoSource = await readFile(new URL('./Crypto5MinDetail.jsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');

test('crypto 5-minute markets show and refresh the current user position after buying', () => {
  assert.match(cryptoSource, /onTradeSuccess/);
  assert.match(cryptoSource, /gridTemplateColumns:\s*isMobile \|\| selectedPositions\.length === 0/);
  assert.match(cryptoSource, /selectedPositions\.map/);
  assert.match(cryptoSource, /await onTradeSuccess\?\.\(\)/);
  assert.match(cryptoSource, /redeemWinnings/);
  assert.match(cryptoSource, /isResolved && p\.canRedeem/);
  assert.match(cryptoSource, /points\.detail\.claim/);
  assert.match(cryptoSource, /const canTrade = marketStillOpen/);
  assert.doesNotMatch(cryptoSource, /settlementLocked/);
  assert.doesNotMatch(cryptoSource, /CRYPTO_TRADE_LOCK_MS/);
  assert.match(cryptoSource, /selectedEndMs > nowMs/);
  assert.match(cryptoSource, /setSelectedMarketId\(nextMarket\.id\)/);

  assert.match(detailSource, /positionRefreshNonce/);
  assert.match(detailSource, /async function handleTradeSuccess\(\)/);
  assert.match(detailSource, /onTradeSuccess=\{handleTradeSuccess\}/);
  assert.match(detailSource, /setPositionRefreshNonce\(v => v \+ 1\)/);
  assert.match(detailSource, /const pollMs = isCryptoMarket \? 5_000 : 15_000/);
});
