import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./PointsUserProfile.jsx', import.meta.url), 'utf8');
const APP_SOURCE = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const ADMIN_SOURCE = readFileSync(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');

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
  assert.match(SOURCE, /usernameFromProfileLocation\(paramUsername, location\.pathname, location\.search\)/);
  assert.match(SOURCE, /match\(\s*\/\(\?:\^\|\\\/\)u\\\/\(\[\^\/\?#\]\+\)\/\s*\)/);
  assert.match(SOURCE, /new URLSearchParams/);
  assert.match(SOURCE, /params\.get\('username'\)/);
  assert.match(SOURCE, /params\.get\('path'\)/);
});

test('public profile fetch bypasses stale not-found responses before giving up', () => {
  assert.match(SOURCE, /cache: 'no-store'/);
  assert.match(SOURCE, /'Cache-Control': 'no-cache'/);
  assert.match(SOURCE, /Date\.now\(\)/);
  assert.match(SOURCE, /r\.status === 404 && i === 0\) continue/);
  assert.match(SOURCE, /credentials: 'omit'/);
  assert.match(SOURCE, /No pudimos cargar el perfil/);
});

test('public profile history displays the selected outcome for support review', () => {
  assert.match(SOURCE, /function pickedOutcomeLabelFromTransactions\(transactions = \[\]\)/);
  assert.match(SOURCE, /m\.pickedOutcomeLabel \|\| pickedOutcomeLabelFromTransactions\(m\.transactions\)/);
  assert.match(SOURCE, /Eligió \$\{pickedLabel\}/);
});

test('public profile history labels canceled markets as annulled', () => {
  assert.match(SOURCE, /canceled:\s*\{\s*label: 'Anulado'/);
});

test('public profile shows current-cycle account numbers and cycle graph toggles', () => {
  assert.match(SOURCE, /const \[pnlCycleScope, setPnlCycleScope\] = useState\('current'\)/);
  assert.match(SOURCE, /const \[currentCyclePnl, setCurrentCyclePnl\] = useState\(null\)/);
  assert.match(SOURCE, /fetchPnlHistory\(\{ username, days: pnlRange, cycle: pnlCycleScope \}\)/);
  assert.match(SOURCE, /fetchPnlHistory\(\{ username, days: 0, cycle: 'current' \}\)/);
  assert.match(SOURCE, /Balance actual/);
  assert.match(SOURCE, /PnL ciclo actual/);
  assert.match(SOURCE, /cycleScope=\{pnlCycleScope\}/);
  assert.match(SOURCE, /onCycleScopeChange=\{setPnlCycleScope\}/);
});

test('points router handles Vercel profile rewrite fallbacks', () => {
  assert.match(APP_SOURCE, /function PointsHomeEntry/);
  assert.match(APP_SOURCE, /routeLooksLikeProfile/);
  assert.match(APP_SOURCE, /params\.get\('username'\)/);
  assert.match(APP_SOURCE, /params\.get\('path'\)/);
  assert.match(APP_SOURCE, /<Route path="\/" element=\{<PointsHomeEntry/);
  assert.match(APP_SOURCE, /<Route path="\/points\/u\/:username" element=\{<PointsUserProfile \/>/);
});

test('admin hard links point at canonical points profile URLs', () => {
  assert.match(ADMIN_SOURCE, /href=\{`\/points\/u\/\$\{encodeURIComponent\(row\.username\)\}`\}/);
  assert.match(ADMIN_SOURCE, /href=\{`\/points\/u\/\$\{encodeURIComponent\(userRow\.username\)\}`\}/);
});
