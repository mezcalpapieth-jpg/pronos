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
