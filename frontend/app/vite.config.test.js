import assert from 'node:assert/strict';
import test from 'node:test';

import viteConfig, { turnkeyBrowserNodecryptoStub } from './vite.config.js';

test('stubs Turnkey node crypto stamper in the browser bundle', async () => {
  assert.equal(typeof turnkeyBrowserNodecryptoStub, 'function');

  const plugin = turnkeyBrowserNodecryptoStub();
  const importer = `/repo/node_modules/@turnkey/api-key-stamper/dist/index.mjs`;
  const resolved = await plugin.resolveId('./nodecrypto.mjs', importer);

  assert.match(resolved, /turnkeyNodecryptoBrowserStub\.js$/);
  assert.ok(viteConfig.plugins.some((entry) => entry?.name === 'turnkey-browser-nodecrypto-stub'));
});

test('aliases HPKE node crypto fallback to the browser crypto module', () => {
  assert.match(viteConfig.resolve.alias.crypto, /browserCryptoModule\.js$/);
});
