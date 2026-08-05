import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./PointsUserProfile.jsx', import.meta.url), 'utf8');

test('admin profile view renders connected social handles as well as social tasks', () => {
  assert.match(SOURCE, /adminSocialLinks/);
  assert.match(SOURCE, /Cuentas conectadas/);
  assert.match(SOURCE, /link\.handle/);
});

test('admin profile view exposes exact campaign post links for social task review', () => {
  assert.match(SOURCE, /row\.targetUrl/);
  assert.match(SOURCE, /targetHref/);
  assert.match(SOURCE, /Ver post/);
  assert.match(SOURCE, /proofHref && proofHref !== targetHref/);
});

test('public profile page can recover the username from the URL path', () => {
  assert.match(SOURCE, /function usernameFromProfileLocation/);
  assert.match(SOURCE, /useLocation\(\)/);
  assert.match(SOURCE, /profileUsername = useMemo/);
  assert.match(SOURCE, /usernameFromProfileLocation\(paramUsername, location\.pathname\)/);
  assert.match(SOURCE, /match\(\s*\/\(\?:\^\|\\\/\)u\\\/\(\[\^\/\?#\]\+\)\/\s*\)/);
});

test('public profile fetch bypasses stale not-found responses before giving up', () => {
  assert.match(SOURCE, /cache: 'no-store'/);
  assert.match(SOURCE, /'Cache-Control': 'no-cache'/);
  assert.match(SOURCE, /Date\.now\(\)/);
  assert.match(SOURCE, /r\.status === 404 && i === 0\) continue/);
});
