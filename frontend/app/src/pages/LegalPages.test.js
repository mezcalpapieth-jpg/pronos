import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const privacySource = readFileSync(new URL('./PrivacyPolicy.jsx', import.meta.url), 'utf8');
const termsSource = readFileSync(new URL('./TermsOfService.jsx', import.meta.url), 'utf8');

test('legal pages use translated Pronos titles and update browser title', () => {
  assert.match(privacySource, /const title = t\('legal\.privacy\.title'\)/);
  assert.match(termsSource, /const title = t\('legal\.terms\.title'\)/);
  assert.match(privacySource, /document\.title = title/);
  assert.match(termsSource, /document\.title = title/);
  assert.doesNotMatch(privacySource, /<H1>Privacy Policy<\/H1>/);
  assert.doesNotMatch(termsSource, /<H1>Terms of Service<\/H1>/);
});

test('legal pages expose an in-page Spanish and English language switch', () => {
  assert.match(privacySource, /<LegalLanguageSwitch currentLang=\{lang\} \/>/);
  assert.match(termsSource, /<LegalLanguageSwitch currentLang=\{lang\} \/>/);
});

test('terms prohibit points tournament and rewards exploits', () => {
  assert.match(termsSource, /Exploit points, tournaments, rewards, referrals, or social tasks/);
  assert.match(termsSource, /leaderboards, tournaments, prizes, bonuses, and other rewards/);
  assert.match(termsSource, /Explotar puntos, torneos, recompensas, referidos o tareas sociales/);
  assert.match(termsSource, /leaderboards, torneos, premios, bonos y otras recompensas/);
  assert.match(termsSource, /aunque\s+su balance de puntos siga visible en la app/);
});
