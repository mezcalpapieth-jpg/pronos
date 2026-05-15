import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdminProfileSocials } from './points-profile-socials.js';

test('buildAdminProfileSocials returns admin-only social proof rows with catalog labels', () => {
  const socials = buildAdminProfileSocials([
    {
      id: 12,
      task_key: 'twitter_follow',
      status: 'approved',
      reward: '25',
      proof_url: 'https://x.com/some_user',
      reviewer: 'mezcal',
      reviewed_at: '2026-05-01T00:00:00.000Z',
      rejection_note: null,
      created_at: '2026-04-30T00:00:00.000Z',
    },
    {
      id: 13,
      task_key: 'custom_social',
      status: 'pending',
      reward: '10',
      proof_url: '',
      reviewer: null,
      reviewed_at: null,
      rejection_note: null,
      created_at: '2026-05-02T00:00:00.000Z',
    },
  ]);

  assert.deepEqual(socials, [
    {
      id: 12,
      taskKey: 'twitter_follow',
      label: 'Seguir @pronos_io en X (Twitter)',
      network: 'twitter',
      status: 'approved',
      reward: 25,
      proofUrl: 'https://x.com/some_user',
      reviewer: 'mezcal',
      reviewedAt: '2026-05-01T00:00:00.000Z',
      rejectionNote: null,
      createdAt: '2026-04-30T00:00:00.000Z',
    },
    {
      id: 13,
      taskKey: 'custom_social',
      label: 'custom_social',
      network: 'social',
      status: 'pending',
      reward: 10,
      proofUrl: null,
      reviewer: null,
      reviewedAt: null,
      rejectionNote: null,
      createdAt: '2026-05-02T00:00:00.000Z',
    },
  ]);
});
