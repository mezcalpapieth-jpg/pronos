import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const deckSource = await readFile(new URL('./InvestorDeck.jsx', import.meta.url), 'utf8');
const manifestSource = await readFile(new URL('../lib/investorDeckManifest.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const adminPanelSource = await readFile(new URL('../components/DeckAdminPanel.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const viteSource = await readFile(new URL('../../../vite.config.js', import.meta.url), 'utf8');
const authSource = await readFile(new URL('../../../../api/deck/auth.js', import.meta.url), 'utf8');

test('points app exposes the private investor deck route', () => {
  assert.match(appSource, /InvestorDeck/);
  assert.match(appSource, /path="\/deck"/);
  assert.match(appSource, /window\.location\.pathname\.startsWith\('\/points'\)/);
  assert.match(appSource, /<BrowserRouter basename=\{basename\}>/);
});

test('investor deck viewer gates access, toggles languages, watermarks slides, and tracks analytics', () => {
  assert.match(deckSource, /deckLogin/);
  assert.match(deckSource, /DEFAULT_DECK_LANGUAGE\s*=\s*'en'/);
  assert.match(deckSource, /setLanguage\(DEFAULT_DECK_LANGUAGE\)/);
  assert.match(deckSource, /LanguageToggle/);
  assert.match(deckSource, /\['en', 'EN'\][\s\S]*\['es', 'ES'\]/);
  assert.match(deckSource, /Watermark/);
  assert.match(deckSource, /trackDeckEvent/);
  assert.match(deckSource, /submitDeckQuestion/);
  assert.match(deckSource, /preloadDeckImages/);
  assert.match(deckSource, /preloadedDeckImages/);
  assert.match(deckSource, /loading="eager"/);
  assert.match(deckSource, /fetchPriority="high"/);
  assert.match(deckSource, /withTimeout\(fetchDeckSession\(\),\s*2500,\s*'deck_session_timeout'\)/);
  assert.match(deckSource, /safeSlideIndex/);
  assert.match(deckSource, /slideKey/);
  assert.match(deckSource, /key=\{slideKey\}/);
  assert.match(deckSource, /No se pudo enviar/);
  assert.doesNotMatch(deckSource, /detect(ar|a).*screenshot/i);
});

test('investor deck manifest contains Spanish and English decks', () => {
  assert.match(manifestSource, /es:/);
  assert.match(manifestSource, /en:/);
  assert.match(manifestSource, /languageLabel:\s*'Español'/);
  assert.match(manifestSource, /languageLabel:\s*'English'/);
  assert.match(manifestSource, /sourcePdf:\s*asset\('decks\/pronos-es\/pronos-deck-es\.pdf'\)/);
  assert.match(manifestSource, /sourcePdf:\s*asset\('decks\/pronos-en\/pronos-deck-en\.pdf'\)/);
  assert.match(manifestSource, /decks\/pronos-es\/slide-13\.png/);
  assert.match(manifestSource, /slide-13\.png/);
  assert.match(manifestSource, /return investorDeckManifest\[language\] \|\| investorDeckManifest\.en/);
});

test('points admin exposes deck analytics and invite management', () => {
  assert.match(adminSource, /DeckAdminPanel/);
  assert.match(adminSource, /id:\s*'deck'/);
  assert.match(adminPanelSource, /adminDeckDashboard/);
  assert.match(adminPanelSource, /adminCreateDeckInvite/);
  assert.match(adminPanelSource, /adminRevokeDeckInvite/);
  assert.match(adminPanelSource, /Crear nombre y contraseña/);
  assert.match(adminPanelSource, /Contraseña\/código/);
});

test('points API client exposes deck viewer and admin endpoints', () => {
  assert.match(apiSource, /\/api\/deck\/auth/);
  assert.match(apiSource, /\/api\/deck\/events/);
  assert.match(apiSource, /\/api\/deck\/questions/);
  assert.match(apiSource, /\/api\/deck\/admin\/dashboard/);
  assert.match(apiSource, /\/api\/deck\/admin\/invites/);
  assert.match(apiSource, /language = 'en'/);
  assert.match(authSource, /value === 'es' \? 'es' : 'en'/);
});

test('vite dev server has a local deck API fallback for localhost review', () => {
  assert.match(viteSource, /pointsRootDeckDevMiddleware/);
  assert.match(viteSource, /pathname === '\/deck'/);
  assert.match(viteSource, /deckDevApiMiddleware/);
  assert.match(viteSource, /Francisco M\./);
  assert.match(viteSource, /Chiavari/);
  assert.match(viteSource, /\/api\/deck\/session/);
});
