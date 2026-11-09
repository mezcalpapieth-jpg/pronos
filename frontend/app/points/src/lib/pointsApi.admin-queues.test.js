import test from 'node:test';
import assert from 'node:assert/strict';
import { adminListTaskCounts } from './pointsApi.js';

function mockQueues(t, responses) {
  t.mock.method(globalThis, 'fetch', async url => {
    const name = new URL(url, 'https://fixture.test').pathname.split('/').pop();
    const data = responses[name];
    return Response.json(data ?? {}, { status: data == null ? 503 : 200 });
  });
}

test('admin work counts include closed markets with no candidate', async t => {
  mockQueues(t, {
    'pending-markets': { pending: [] },
    'markets': { markets: [{ id: 3 }] },
    'resolution-candidates': { count: 0 },
    'social-tasks': { tasks: [] },
    'support-tickets': { tickets: [] },
  });
  const counts = await adminListTaskCounts();
  assert.equal(counts.markets, 1);
  assert.equal(counts.resolutionReady, null);
  assert.deepEqual(counts.marketPreview, [{ id: 3 }]);
});

test('admin work counts report missing data and avoid double-counting closed candidates', async t => {
  mockQueues(t, {
    'pending-markets': { pending: [] },
    'markets': { markets: [{ id: 3 }, { id: 4 }] },
    'resolution-candidates': { count: 2, pendingCount: 1, overdueCount: 2 },
    'social-tasks': { tasks: [] },
  });
  const counts = await adminListTaskCounts();
  assert.equal(counts.markets, 2);
  assert.equal(counts.resolutionReady, 1);
  assert.equal(counts.closedWithoutCandidate, 1);
  assert.equal(counts.pending, 0);
  assert.equal(counts.support, null);
  assert.equal(counts.partial, true);
});
