import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAicmMarkets } from './aicm.js';

test('AICM generator creates one pending daily delay bucket market for the next full Mexico day', async () => {
  const specs = await generateAicmMarkets({ now: new Date('2026-08-19T18:00:00.000Z') });
  assert.equal(specs.length, 1);

  const spec = specs[0];
  assert.equal(spec.source, 'aicm-official-flight-board');
  assert.equal(spec.source_event_id, 'aicm:MEX:departure:day:2026-08-20');
  assert.equal(spec.category, 'infraestructura');
  assert.equal(spec.amm_mode, 'parallel');
  assert.equal(spec.resolver_type, 'aicm_delay_count');
  assert.deepEqual(spec.outcomes, ['0-5', '6-15', '16-30', '31+']);
  assert.equal(spec.resolver_config.fromDateYmd, '2026-08-20');
  assert.equal(spec.resolver_config.toDateYmd, '2026-08-20');
  assert.equal(spec.resolver_config.minObservedPolls, 36);
  assert.equal(spec.source_data.tags.categoryTags.includes('infraestructura'), true);
  assert.equal(spec.source_data.tags.geoTags.includes('mexico'), true);
  assert.match(spec.source_data.resolutionCriteria, /estatus DEMORADO/);
});
