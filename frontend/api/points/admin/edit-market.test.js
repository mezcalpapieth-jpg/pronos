import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./edit-market.js', import.meta.url), 'utf8');

test('active market edit syncs mañanera resolver phrase from quoted question', () => {
  assert.match(source, /syncMananeraPhraseFromQuestion/);
  assert.match(source, /question:\s*nextQuestion \?\? existing\.question/);
  assert.match(source, /resolverConfigChanged = syncedMananera\.changed === true/);
  assert.match(source, /&& !resolverConfigChanged/);
  assert.match(source, /resolver_config = \$\{nextResolverConfig \? JSON\.stringify\(nextResolverConfig\) : null\}::jsonb/);
});
