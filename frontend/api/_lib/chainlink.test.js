import test from 'node:test';
import assert from 'node:assert/strict';

import { findChainlinkRoundAtOrBefore } from './chainlink.js';

test('findChainlinkRoundAtOrBefore returns the latest round at or before the target timestamp', async () => {
  const phase = 4n;
  const base = phase << 64n;
  const rounds = new Map([
    [base + 1n, { roundId: base + 1n, updatedAt: 100, price: 90_000 }],
    [base + 2n, { roundId: base + 2n, updatedAt: 200, price: 91_000 }],
    [base + 3n, { roundId: base + 3n, updatedAt: 300, price: 92_000 }],
  ]);

  const found = await findChainlinkRoundAtOrBefore({
    latestRound: rounds.get(base + 3n),
    targetTimestamp: 250,
    readRound: async (roundId) => {
      const round = rounds.get(roundId);
      if (!round) throw new Error('No data present');
      return round;
    },
  });

  assert.equal(found.roundId, base + 2n);
  assert.equal(found.price, 91_000);
});

test('findChainlinkRoundAtOrBefore surfaces when the target predates available rounds', async () => {
  const phase = 1n;
  const base = phase << 64n;
  const latestRound = { roundId: base + 2n, updatedAt: 200, price: 100 };

  await assert.rejects(
    () => findChainlinkRoundAtOrBefore({
      latestRound,
      targetTimestamp: 50,
      readRound: async (roundId) => {
        if (roundId === base + 1n) return { roundId, updatedAt: 100, price: 90 };
        if (roundId === base + 2n) return latestRound;
        throw new Error('No data present');
      },
    }),
    /no round at or before timestamp/,
  );
});
