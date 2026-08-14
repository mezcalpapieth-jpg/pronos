import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaSource = await readFile(new URL('./deck-schema.js', import.meta.url), 'utf8');
const sessionSource = await readFile(new URL('./deck-session.js', import.meta.url), 'utf8');
const authSource = await readFile(new URL('../deck/auth.js', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../deck/admin/dashboard.js', import.meta.url), 'utf8');

test('deck schema stores hashed invite access and DocSend-style analytics tables', () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS deck_invites/);
  assert.match(schemaSource, /code_hash TEXT UNIQUE NOT NULL/);
  assert.match(schemaSource, /code_ciphertext TEXT/);
  assert.match(schemaSource, /ALTER TABLE deck_invites ADD COLUMN IF NOT EXISTS code_ciphertext TEXT/);
  assert.doesNotMatch(schemaSource, /code TEXT/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS deck_sessions/);
  assert.match(schemaSource, /deck_language TEXT NOT NULL DEFAULT 'en'/);
  assert.match(schemaSource, /ALTER TABLE deck_sessions ALTER COLUMN deck_language SET DEFAULT 'en'/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS deck_slide_events/);
  assert.match(schemaSource, /duration_ms INTEGER NOT NULL DEFAULT 0/);
  assert.match(schemaSource, /ALTER TABLE deck_slide_events ALTER COLUMN deck_language SET DEFAULT 'en'/);
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS deck_questions/);
  assert.match(schemaSource, /ALTER TABLE deck_questions ALTER COLUMN deck_language SET DEFAULT 'en'/);
});

test('deck session helper uses a separate invite cookie and HMAC access-code hashes', () => {
  assert.match(sessionSource, /pronos_deck_session/);
  assert.match(sessionSource, /hashDeckCode/);
  assert.match(sessionSource, /createHmac\('sha256'/);
  assert.match(sessionSource, /encryptDeckCodeForAdmin/);
  assert.match(sessionSource, /decryptDeckCodeForAdmin/);
  assert.match(sessionSource, /createCipheriv\('aes-256-gcm'/);
  assert.match(sessionSource, /createDecipheriv\('aes-256-gcm'/);
  assert.match(sessionSource, /DECK_ACCESS_SECRET/);
  assert.match(sessionSource, /language:\s*row\.deck_language \|\| 'en'/);
});

test('deck auth creates sessions from active invite codes only', () => {
  assert.match(authSource, /deck_invites/);
  assert.match(authSource, /active = true/);
  assert.match(authSource, /revoked_at IS NULL/);
  assert.match(authSource, /setDeckSessionCookie/);
});

test('deck admin dashboard aggregates slide time and questions behind points admin auth', () => {
  assert.match(dashboardSource, /requirePointsAdmin/);
  assert.match(dashboardSource, /deck_slide_events/);
  assert.match(dashboardSource, /SUM\(duration_ms\)/);
  assert.match(dashboardSource, /recent_sessions/);
  assert.match(dashboardSource, /sessionSlideRows/);
  assert.match(dashboardSource, /slideBreakdown/);
  assert.match(dashboardSource, /deck_questions/);
  assert.match(dashboardSource, /decryptDeckCodeForAdmin/);
});
