import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./events.js', import.meta.url), 'utf8');

test('investor page events are protected by the deck session', () => {
  assert.match(source, /ensureDeckSchema/);
  assert.match(source, /readDeckSession/);
  assert.match(source, /investor_session_required/);
  assert.match(source, /methods:\s*'POST, OPTIONS'/);
  assert.match(source, /method_not_allowed/);
});

test('investor page events store bounded dashboard analytics only', () => {
  assert.match(source, /deck_page_events/);
  assert.match(source, /investor_dashboard/);
  assert.match(source, /page_view/);
  assert.match(source, /heartbeat/);
  assert.match(source, /hidden/);
  assert.match(source, /exit/);
  assert.match(source, /30 \* 60_000/);
  assert.match(source, /UPDATE deck_sessions/);
  assert.match(source, /last_seen_at = NOW\(\)/);
  assert.match(source, /viewer_email/);
  assert.doesNotMatch(source, /phoneNumber/);
  assert.doesNotMatch(source, /phone_number/);
});
