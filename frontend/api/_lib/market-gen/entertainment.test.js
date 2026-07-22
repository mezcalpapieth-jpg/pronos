import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './entertainment.js';

test('entertainment award pricing leaves a small Otro reserve', () => {
  assert.deepEqual(
    _internal.awardProbabilities(5).map(v => Math.round(v * 100)),
    [23, 23, 23, 23, 8],
  );
});

test('entertainment binary pricing accepts configured yes probability', () => {
  assert.deepEqual(_internal.binaryProbabilitiesFromYes(65), [0.65, 0.35]);
  assert.deepEqual(_internal.binaryProbabilitiesFromYes(0.4), [0.4, 0.6]);
});

test('entertainment AI pricing stays gated behind env flag and key', () => {
  const oldFlag = process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
  const oldKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(_internal.aiPricingEnabled(), false);
    process.env.ENTERTAINMENT_PRICING_AI_ENABLED = 'true';
    assert.equal(_internal.aiPricingEnabled(), false);
    process.env.ANTHROPIC_API_KEY = 'test';
    assert.equal(_internal.aiPricingEnabled(), true);
  } finally {
    if (oldFlag == null) delete process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
    else process.env.ENTERTAINMENT_PRICING_AI_ENABLED = oldFlag;
    if (oldKey == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});
