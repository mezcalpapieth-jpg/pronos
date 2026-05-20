import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./toggle-featured.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../../_lib/protocol-schema.js', import.meta.url), 'utf8');
const marketsSource = await readFile(new URL('../markets.js', import.meta.url), 'utf8');

test('protocol featured toggle updates protocol_markets and returns the new flag', () => {
  assert.match(source, /POST \/api\/protocol\/admin\/toggle-featured/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /featured_must_be_boolean/);
  assert.match(source, /UPDATE protocol_markets/);
  assert.match(source, /SET featured = \$\{featured\}/);
  assert.match(source, /RETURNING id, featured/);
});

test('protocol schema and public list expose featured markets', () => {
  assert.match(schemaSource, /ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false/);
  assert.match(schemaSource, /idx_protocol_markets_featured_status/);
  assert.match(marketsSource, /m\.featured/);
});
