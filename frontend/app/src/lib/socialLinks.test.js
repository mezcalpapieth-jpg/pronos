import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  normalizeSocialLinks,
  socialLinkStartUrl,
} from './socialLinks.js';

test('socialLinkStartUrl uses provider-specific OAuth routes', () => {
  assert.equal(
    socialLinkStartUrl('x', '/mvp/portfolio'),
    '/api/social/x/start?returnTo=%2Fmvp%2Fportfolio'
  );
  assert.equal(
    socialLinkStartUrl('instagram', '/mvp/portfolio'),
    '/api/social/instagram/start?returnTo=%2Fmvp%2Fportfolio'
  );
  assert.equal(
    socialLinkStartUrl('tiktok', '/mvp/portfolio'),
    '/api/social/tiktok/start?returnTo=%2Fmvp%2Fportfolio'
  );
});

test('normalizeSocialLinks accepts array payloads and maps by provider', () => {
  const links = normalizeSocialLinks({
    links: [
      { provider: 'x', handle: 'pronos_io', rewardCredited: true },
      { provider: 'tiktok', handle: 'pronos.io', rewardCredited: false },
    ],
  });

  assert.equal(links.x.handle, 'pronos_io');
  assert.equal(links.tiktok.handle, 'pronos.io');
  assert.equal(links.instagram, null);
});

test('normalizeSocialLinks also accepts legacy object payloads', () => {
  const links = normalizeSocialLinks({
    links: {
      twitter: { handle: 'old_x' },
      instagram: { handle: 'ig_user' },
    },
  });

  assert.equal(links.x.handle, 'old_x');
  assert.equal(links.instagram.handle, 'ig_user');
  assert.equal(links.tiktok, null);
});
