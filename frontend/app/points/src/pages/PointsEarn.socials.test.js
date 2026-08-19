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

test('social connection reward cards show 100 MXNP', () => {
  assert.match(source, /key:\s*'x'[\s\S]*?reward:\s*100/);
  assert.match(source, /key:\s*'instagram'[\s\S]*?reward:\s*100/);
  assert.match(source, /key:\s*'tiktok'[\s\S]*?reward:\s*100/);
  assert.doesNotMatch(source, /key:\s*'x'[\s\S]*?reward:\s*300/);
  assert.doesNotMatch(source, /key:\s*'instagram'[\s\S]*?reward:\s*300/);
  assert.doesNotMatch(source, /key:\s*'tiktok'[\s\S]*?reward:\s*300/);
});

test('X follow social task stays manual while OAuth verification is paused', () => {
  assert.match(source, /const isAutoVerify = !!task\.autoVerify/);
  assert.match(source, /isAutoVerify \? 'Verificar' : 'Enviar revisión'/);
  assert.match(source, /x_account_required/);
  assert.match(source, /x_reconnect_required/);
  assert.match(source, /socialLinkStartUrl\('x', '\/earn'\)/);
  assert.match(source, /X, Instagram, TikTok y campañas temporales siguen en revisión manual/);
  assert.match(source, /guarda arriba tus usuarios de cada red antes de enviar revisión/);
  assert.doesNotMatch(source, /X se verifica automáticamente con tu cuenta conectada/);
});

test('public social tasks show the saved account used for manual review', () => {
  assert.match(source, /function socialTaskNetworkLabel\(task\)/);
  assert.match(source, /function socialTaskAccountText\(task\)/);
  assert.match(source, /Cuenta \{socialTaskNetworkLabel\(task\)\} guardada: \{socialTaskAccountText\(task\)\}/);
});

test('public social tasks card shows all catalog tasks without network filter tabs', () => {
  const socialTasksSource = source.slice(source.indexOf('function SocialTasksCard'));
  assert.doesNotMatch(socialTasksSource, /const SOCIAL_TASK_FILTERS = \[/);
  assert.doesNotMatch(socialTasksSource, /normalizeSocialTaskNetwork/);
  assert.doesNotMatch(socialTasksSource, /const \[networkFilter,\s*setNetworkFilter\]/);
  assert.doesNotMatch(socialTasksSource, /aria-label="Filtrar tareas sociales"/);
  assert.match(socialTasksSource, /tasks\.map\(t =>/);
  assert.match(socialTasksSource, /No hay tareas sociales disponibles/);
});
