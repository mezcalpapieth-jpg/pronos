import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsResolverReadiness } from './points-resolver-readiness.js';

test('manual leaderboard markets explicitly require cutoff evidence, never a later ranking', () => {
  const result = pointsResolverReadiness({ resolver_type: 'manual_review', resolver_config: { source: 'ai-lab-top-model' } });
  assert.equal(result.mode, 'manual');
  assert.equal(result.requiresCutoffSnapshot, true);
  assert.match(result.requirement, /No usar rankings posteriores/);
});

test('readiness distinguishes missing, unknown, human evidence and automatic resolvers', () => {
  assert.equal(pointsResolverReadiness({}).mode, 'missing');
  assert.equal(pointsResolverReadiness({ resolver_type: 'new_unsupported_type' }).mode, 'manual');
  assert.equal(pointsResolverReadiness({ resolver_type: 'sports_api' }).mode, 'automatic');
  assert.match(pointsResolverReadiness({ source: 'manual-international-politics', resolver_type: 'manual_review', resolver_config: { source: 'manual_review' } }).requirement, /acto oficial/);
  assert.match(pointsResolverReadiness({ resolver_type: 'manual_review', resolver_config: { manualReviewKind: 'inegi_inflation_bucket' } }).requirement, /primer comunicado/);
  assert.match(pointsResolverReadiness({ source: 'popular', resolver_type: 'manual_review', resolver_config: { source: 'manual-review' } }).requirement, /aplazamiento/);
});

test('disabled airport sources are flagged before approval rather than advertised as automatic', () => {
  const saved = process.env.POINTS_AVIATION_EDGE_ENABLED;
  delete process.env.POINTS_AVIATION_EDGE_ENABLED;
  try {
    assert.equal(pointsResolverReadiness({ resolver_type: 'aicm_delay_minutes_live' }).mode, 'blocked');
  } finally {
    if (saved === undefined) delete process.env.POINTS_AVIATION_EDGE_ENABLED; else process.env.POINTS_AVIATION_EDGE_ENABLED = saved;
  }
});
