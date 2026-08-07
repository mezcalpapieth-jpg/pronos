import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PnlChart.jsx', import.meta.url), 'utf8');

// Regression: the chart rendered at its fallback width forever.
// The empty state used to be an early `return` that skipped ref={plotRef}.
// Real pages mount with an empty series while the fetch is in flight, so the
// ref never attached, the ResizeObserver was never created, and the chart
// stayed pinned at the fallback width inside a full-width card.

test('the measured wrapper renders in every state, including empty', () => {
  assert.doesNotMatch(
    source,
    /if \(points\.length === 0\) \{[\s\S]{0,80}return \(/,
    'empty state must not early-return past the ref={plotRef} wrapper',
  );
  assert.match(source, /<div ref=\{plotRef\}[\s\S]*points\.length === 0 \?/);
});

test('there is exactly one measured wrapper to observe', () => {
  assert.equal((source.match(/ref=\{plotRef\}/g) || []).length, 1);
});

test('the viewBox is driven by the measured width so it stays 1:1 with pixels', () => {
  assert.match(source, /const chartWidth = measuredWidth > 0 \? measuredWidth : \d+/);
  assert.match(source, /viewBox=\{`0 0 \$\{chartWidth\} \$\{height\}`\}/);
});

test('the domain maths is imported, not inlined, so it stays testable', () => {
  assert.match(source, /import \{ pnlDomain \} from '\.\.\/lib\/pnlDomain\.js'/);
});

test('gain and loss use the semantic tokens, never the brand accent', () => {
  assert.match(source, /const GAIN = 'var\(--success\)'/);
  assert.match(source, /const LOSS = 'var\(--danger\)'/);
  assert.doesNotMatch(source, /var\(--green\)/);
});
