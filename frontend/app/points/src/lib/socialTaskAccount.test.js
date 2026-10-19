import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSocialTaskAccount, socialTaskProvider, notifySocialLinksChanged, SOCIAL_LINKS_CHANGED_EVENT } from './socialTaskAccount.js';

test('submission gate handles missing accounts and the Twitter/X provider alias', () => {
  for (const value of [undefined, null, '', ' ', '@', 123]) assert.equal(hasSocialTaskAccount({ socialAccount: value }), false);
  assert.equal(hasSocialTaskAccount({ socialAccount: 'alice' }), true);
  assert.equal(hasSocialTaskAccount({ social_account: '@alice' }), true);
  assert.equal(socialTaskProvider({ network: 'twitter' }), 'x');
  assert.equal(socialTaskProvider({ platform: 'INSTAGRAM' }), 'instagram');
});

test('successful saves can refresh profile cards and task catalogs together', () => {
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  let changes = 0;
  globalThis.window.addEventListener(SOCIAL_LINKS_CHANGED_EVENT, () => changes++);
  try {
    notifySocialLinksChanged();
    assert.equal(changes, 1);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
