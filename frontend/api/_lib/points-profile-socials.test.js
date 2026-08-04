import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAdminProfileSocialLinks,
  buildAdminProfileSocials,
} from './points-profile-socials.js';

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
      targetUrl: null,
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
      targetUrl: null,
      reviewer: null,
      reviewedAt: null,
      rejectionNote: null,
      createdAt: '2026-05-02T00:00:00.000Z',
    },
  ]);
});

test('buildAdminProfileSocials includes hidden campaign post targets', () => {
  const socials = buildAdminProfileSocials([
    {
      id: 14,
      task_key: 'x_post_abc123',
      task_label: 'Like al post de lanzamiento',
      platform: 'x',
      target_url: 'https://x.com/pronos_io/status/123',
      status: 'pending',
      reward: '15',
      proof_url: 'https://x.com/pronos_io/status/123',
      reviewer: null,
      reviewed_at: null,
      rejection_note: null,
      created_at: '2026-08-04T00:00:00.000Z',
    },
  ]);

  assert.deepEqual(socials, [
    {
      id: 14,
      taskKey: 'x_post_abc123',
      label: 'Like al post de lanzamiento',
      network: 'x',
      status: 'pending',
      reward: 15,
      proofUrl: 'https://x.com/pronos_io/status/123',
      targetUrl: 'https://x.com/pronos_io/status/123',
      reviewer: null,
      reviewedAt: null,
      rejectionNote: null,
      createdAt: '2026-08-04T00:00:00.000Z',
    },
  ]);
});

test('buildAdminProfileSocialLinks returns connected handles for admin profile views', () => {
  const links = buildAdminProfileSocialLinks([
    {
      provider: 'tiktok',
      provider_user_id: 'tk_123',
      handle: '@frmm',
      profile_url: 'https://www.tiktok.com/@frmm',
      reward_credited: true,
      linked_at: '2026-05-20T12:00:00.000Z',
    },
  ]);

  assert.deepEqual(links, [
    {
      provider: 'tiktok',
      label: 'TikTok',
      network: 'tiktok',
      providerUserId: 'tk_123',
      handle: 'frmm',
      profileUrl: 'https://www.tiktok.com/@frmm',
      rewardCredited: true,
      linkedAt: '2026-05-20T12:00:00.000Z',
    },
  ]);
});
