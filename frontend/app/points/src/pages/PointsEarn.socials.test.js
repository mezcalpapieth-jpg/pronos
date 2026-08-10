/**
 * Static checks for social connection availability on the points earn page.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsEarn.socials.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsEarn.jsx', import.meta.url), 'utf8');

test('TikTok and Instagram OAuth connection cards stay in proximamente until provider approval', () => {
  assert.match(source, /key:\s*'instagram'[\s\S]*?available:\s*false[\s\S]*?Esperando aprobación de Meta/);
  assert.match(source, /key:\s*'tiktok'[\s\S]*?available:\s*false[\s\S]*?Esperando aprobación de TikTok/);
  assert.match(source, /locked &&/);
  assert.match(source, /lang === 'en' \? 'Soon' : 'Próximamente'/);
});

test('X follow social task verifies automatically after OAuth connection', () => {
  assert.match(source, /const isAutoVerify = !!task\.autoVerify/);
  assert.match(source, /isAutoVerify \? 'Verificar' : 'Enviar revisión'/);
  assert.match(source, /x_account_required/);
  assert.match(source, /socialLinkStartUrl\('x', '\/earn'\)/);
  assert.match(source, /Follow de X verificado automáticamente/);
});
