/**
 * Unit tests for the OAuth helpers — specifically `safeReturnPath`,
 * which is the open-redirect gate for the social-link OAuth flow. A
 * regression here would let an attacker pivot a successful OAuth
 * round-trip into a phishing redirect.
 *
 * Run with:
 *   node --test frontend/api/_lib/oauth.test.js
 *
 * `safeReturnPath` requires `POINTS_SESSION_SECRET` to be set because
 * `oauth.js` constructs an HMAC verifier at import time. Set a dummy
 * value here so the import succeeds — the function itself doesn't use
 * the secret.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.POINTS_SESSION_SECRET = process.env.POINTS_SESSION_SECRET
  || 'oauth-test-secret-do-not-use-in-prod';

const { safeReturnPath } = await import('./oauth.js');

test('returns fallback for non-strings', () => {
  assert.equal(safeReturnPath(undefined), '/earn');
  assert.equal(safeReturnPath(null), '/earn');
  assert.equal(safeReturnPath(123), '/earn');
  assert.equal(safeReturnPath({}), '/earn');
  assert.equal(safeReturnPath([]), '/earn');
});

test('returns fallback for empty / oversize strings', () => {
  assert.equal(safeReturnPath(''), '/earn');
  assert.equal(safeReturnPath('a'.repeat(2000)), '/earn');
});

test('returns fallback for non-/-prefixed paths', () => {
  assert.equal(safeReturnPath('foo/bar'), '/earn');
  assert.equal(safeReturnPath('http://evil.tld/x'), '/earn');
  assert.equal(safeReturnPath('https://evil.tld/x'), '/earn');
  assert.equal(safeReturnPath(' /foo'), '/earn'); // leading space
});

test('rejects javascript: and data: schemes', () => {
  // These don't start with '/' so the first check rejects them.
  assert.equal(safeReturnPath('javascript:alert(1)'), '/earn');
  assert.equal(safeReturnPath('data:text/html,<script>alert(1)</script>'), '/earn');
});

test('rejects protocol-relative URLs', () => {
  assert.equal(safeReturnPath('//evil.tld'), '/earn');
  assert.equal(safeReturnPath('//evil.tld/path'), '/earn');
  assert.equal(safeReturnPath('//evil.tld/path?q=1'), '/earn');
});

test('rejects backslash-prefixed protocol-relative variants', () => {
  // Some browsers normalize '/\' to '//'.
  assert.equal(safeReturnPath('/\\evil.tld'), '/earn');
  assert.equal(safeReturnPath('/\\evil.tld/path'), '/earn');
});

test('rejects CR/LF (header injection guard)', () => {
  assert.equal(safeReturnPath('/foo\r\nLocation: https://evil.tld'), '/earn');
  assert.equal(safeReturnPath('/foo\nset-cookie: x=y'), '/earn');
  assert.equal(safeReturnPath('/foo\rbar'), '/earn');
});

test('preserves legitimate paths', () => {
  assert.equal(safeReturnPath('/foo'), '/foo');
  assert.equal(safeReturnPath('/foo/bar'), '/foo/bar');
  assert.equal(safeReturnPath('/'), '/');
});

test('preserves query strings and fragments', () => {
  assert.equal(safeReturnPath('/foo?bar=1'), '/foo?bar=1');
  assert.equal(safeReturnPath('/foo?bar=1&baz=2'), '/foo?bar=1&baz=2');
  assert.equal(safeReturnPath('/foo#anchor'), '/foo#anchor');
  assert.equal(safeReturnPath('/foo?bar=1#anchor'), '/foo?bar=1#anchor');
});

test('preserves URL-encoded slashes (browsers stay on origin)', () => {
  // %2f stays encoded inside a same-origin path; browsers don't
  // re-resolve %2f as a path separator before deciding origin.
  assert.equal(safeReturnPath('/%2fok'), '/%2fok');
  assert.equal(safeReturnPath('/foo/%2f%2fbar'), '/foo/%2f%2fbar');
});

test('respects custom fallback', () => {
  assert.equal(safeReturnPath('//evil.tld', '/'), '/');
  assert.equal(safeReturnPath(undefined, '/home'), '/home');
});

test('rejects mixed-case protocol-relative attempts', () => {
  // Edge cases where someone tries to bypass with whitespace or
  // unusual chars before '//'. All must fail the leading-/ check.
  assert.equal(safeReturnPath('\t//evil.tld'), '/earn');
  assert.equal(safeReturnPath('//evil.tld\t'), '/earn'); // still //
});
