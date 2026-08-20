import test from 'node:test';
import assert from 'node:assert/strict';

import { AICM_HUB_PATH, isAicmDelayMarket } from './aicmMarkets.js';

test('AICM delay markets are recognized across official and timetable sources', () => {
  assert.equal(AICM_HUB_PATH, '/c/infraestructura/aicm');
  assert.equal(isAicmDelayMarket({
    source: 'aviation-edge-timetable',
    sourceEventId: 'aicm:MEX:departure:48h:2026-08-20',
    resolverConfig: { shape: 'delay-bucket' },
  }), true);
  assert.equal(isAicmDelayMarket({
    source: 'aicm-official-flight-board',
    sourceEventId: 'aicm:MEX:departure:day:2026-08-20',
    resolverConfig: { shape: 'delay-bucket' },
  }), true);
  assert.equal(isAicmDelayMarket({
    source: 'aviation-edge-timetable',
    sourceEventId: 'aicm:MEX:arrival:48h:2026-08-20',
    resolverConfig: { shape: 'delay-bucket' },
  }), false);
});
