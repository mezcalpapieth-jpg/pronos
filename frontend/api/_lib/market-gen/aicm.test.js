import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAicmMarkets, AICM_DAILY_THRESHOLD_MIN } from './aicm.js';

test('AICM generator creates one pending daily 30+ minute delay bucket market for the next full Mexico day', async () => {
  const specs = await generateAicmMarkets({ now: new Date('2026-08-19T18:00:00.000Z') });
  assert.equal(specs.length, 1);

  const spec = specs[0];
  // Kept stable so reruns refresh existing bad pending rows instead of making
  // a duplicate; the resolver itself uses Aviation Edge below.
  assert.equal(spec.source, 'aicm-official-flight-board');
  assert.equal(spec.source_event_id, 'aicm:MEX:departure:day:2026-08-20');
  assert.equal(spec.category, 'infraestructura');
  assert.equal(spec.amm_mode, 'parallel');
  assert.equal(spec.resolver_type, 'aicm_delay_minutes_live');
  assert.match(spec.question, /más de 30 minutos/);
  assert.deepEqual(spec.outcomes, ['0-99', '100-115', '116-130', '131+']);
  assert.equal(spec.resolver_config.fromDateYmd, '2026-08-20');
  assert.equal(spec.resolver_config.toDateYmd, '2026-08-20');
  assert.equal(spec.resolver_config.source, 'aviation-edge-timetable');
  assert.equal(spec.resolver_config.thresholdMinutes, AICM_DAILY_THRESHOLD_MIN);
  assert.equal(spec.resolver_config.minOperatorFlights, 250);
  assert.equal(spec.resolver_config.minOkPolls, 6);
  assert.equal(spec.resolver_config.resolveAfterUtc, '2026-08-21T10:00:00.000Z');
  assert.equal(spec.source_data.tags.categoryTags.includes('infraestructura'), true);
  assert.equal(spec.source_data.tags.geoTags.includes('mexico'), true);
  assert.match(spec.source_data.resolutionCriteria, /Aviation Edge/);
  assert.match(spec.source_data.resolutionCriteria, /más de 30 minutos/);
});
