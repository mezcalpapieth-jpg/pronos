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
  assert.match(termsSource, /August 25, 2026/);
  assert.match(termsSource, /public display name, profile picture, social handle/);
  assert.match(termsSource, /nudity, explicit sexual material, racism, xenophobia/);
  assert.match(termsSource, /API keys, or automation/);
  assert.match(termsSource, /create, control, or coordinate multiple accounts/);
  assert.match(termsSource, /limit or withhold winnings/);
  assert.match(termsSource, /Exploit points, tournaments, rewards, referrals, or social tasks/);
  assert.match(termsSource, /leaderboards,\s+tournaments, prizes, bonuses, and other rewards/);
  assert.match(termsSource, /foto de perfil/);
  assert.match(termsSource, /xenofobia/);
  assert.match(termsSource, /API keys o automatización/);
  assert.match(termsSource, /crear, controlar o coordinar múltiples cuentas/);
  assert.match(termsSource, /limitar o retener tus ganancias/);
  assert.match(termsSource, /Explotar puntos, torneos, recompensas, referidos o tareas sociales/);
  assert.match(termsSource, /leaderboards,\s+torneos, premios, bonos y otras recompensas/);
  assert.match(termsSource, /aunque\s+su balance de puntos siga visible en la app/);
});
