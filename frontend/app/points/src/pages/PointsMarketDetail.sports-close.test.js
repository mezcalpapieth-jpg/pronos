import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');

test('a final live score locks the current game and removes stale buy and sell dialogs', () => {
  assert.match(source, /if \(score\?\.completed === true\) setFinishedGameId\(id\)/);
  assert.match(source, /const gameFinished = finishedGameId === id/);
  assert.match(source, /<LiveScorePanel market=\{market\} onScoreUpdate=\{onLiveScoreUpdate\}/);
  assert.match(source, /isCanceled \|\| gameFinished \|\| market\.seriesLocked/);
  assert.match(source, /buyState && !gameFinished &&/);
  assert.match(source, /state=\{gameFinished \? null : sellPreview\}/);
  assert.match(source, /if \(!gameFinished\) return;\s*sellQuoteSeqRef\.current \+= 1/);
});
