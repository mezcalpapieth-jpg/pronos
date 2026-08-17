import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cryptoSource = await readFile(new URL('./Crypto5MinDetail.jsx', import.meta.url), 'utf8');
const topHoldersSource = await readFile(new URL('./TopHolders.jsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');

test('crypto 5-minute markets show and refresh the current user position after buying', () => {
  assert.match(cryptoSource, /onTradeSuccess/);
  assert.match(cryptoSource, /gridTemplateColumns:\s*isMobile \|\| selectedPositions\.length === 0/);
  assert.match(cryptoSource, /selectedPositions\.map/);
  assert.match(cryptoSource, /import TopHolders from '\.\/TopHolders\.jsx'/);
  assert.match(cryptoSource, /<TopHolders marketId=\{selectedMarket\.id\} refreshKey=\{sequenceSig\}/);
  assert.match(cryptoSource, /await onTradeSuccess\?\.\(\)/);
  assert.match(cryptoSource, /redeemWinnings/);
  assert.match(cryptoSource, /isResolved && p\.canRedeem/);
  assert.match(cryptoSource, /points\.detail\.claim/);
  assert.match(cryptoSource, /const canTrade = marketStillOpen/);
  assert.doesNotMatch(cryptoSource, /settlementLocked/);
  assert.doesNotMatch(cryptoSource, /CRYPTO_TRADE_LOCK_MS/);
  assert.match(cryptoSource, /selectedEndMs > nowMs/);
  assert.match(cryptoSource, /setSelectedMarketId\(nextMarket\.id\)/);
  assert.match(cryptoSource, /fetchTradeTape\(\[selectedMarket\.id\], \{ hours: 24 \* 7, limit: 40, details: true \}\)/);
  assert.match(cryptoSource, /showTradeDetails/);

  assert.match(detailSource, /positionRefreshNonce/);
  assert.match(detailSource, /async function handleTradeSuccess\(\)/);
  assert.match(detailSource, /onTradeSuccess=\{handleTradeSuccess\}/);
  assert.match(detailSource, /setPositionRefreshNonce\(v => v \+ 1\)/);
  // Production cadence: 5s for crypto ticks, 15s for everything else. The
  // video-recording demo overrides this ahead of the ternary, so assert the
  // real cadence survives as the fallback rather than pinning the whole line.
  assert.match(detailSource, /isCryptoMarket \? 5_000 : 15_000/);
  assert.match(detailSource, /const pollMs = videoDemoPollMs\(\) \?\? \(isCryptoMarket/);
});

test('top holders display frozen invested MXNP and final payout when present', () => {
  assert.match(topHoldersSource, /payoutValue/);
  assert.match(topHoldersSource, /hasPayout/);
  assert.match(topHoldersSource, /const beforeValue = hasPayout && Number\.isFinite\(costBasis\) \? costBasis : value/);
  assert.match(topHoldersSource, /`\$\{beforeLabel\} MXNP -> \$\{payoutLabel\} MXNP`/);
});
