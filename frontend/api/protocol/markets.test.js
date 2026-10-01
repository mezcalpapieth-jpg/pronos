import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');

test('protocol market lists sort live first and then upcoming by close date', () => {
  const orderBlocks = source.match(/ORDER BY[\s\S]*?m\.id ASC/g) || [];
  assert.equal(orderBlocks.length, 2);
  for (const block of orderBlocks) {
    assert.match(block, /m\.start_time IS NOT NULL AND m\.start_time <= NOW\(\) AND m\.end_time > NOW\(\) THEN 0/);
    assert.match(block, /WHEN m\.end_time > NOW\(\) THEN 1/);
    assert.match(block, /WHEN m\.end_time IS NOT NULL THEN 2/);
    assert.match(block, /CASE WHEN m\.end_time > NOW\(\) THEN m\.end_time END ASC NULLS LAST/);
    assert.match(block, /CASE WHEN m\.end_time <= NOW\(\) THEN m\.end_time END DESC NULLS LAST/);
    assert.match(block, /m\.created_at DESC/);
  }
});
