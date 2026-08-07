import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const multi = await readFile(new URL('./MultiSparkline.jsx', import.meta.url), 'utf8');
const single = await readFile(new URL('./Sparkline.jsx', import.meta.url), 'utf8');
const detail = await readFile(
  new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8',
);

test('MultiSparkline accepts an explicit domain, mirroring Sparkline', () => {
  assert.match(multi, /domainMin,\s*domainMax,/);
  assert.match(
    multi,
    /if \(Number\.isFinite\(domainMin\) && Number\.isFinite\(domainMax\) && domainMax > domainMin\)/,
  );
});

test('an explicit domain takes precedence over the auto-fit', () => {
  // The auto-fit must still be the fallback — cards and other callers that
  // pass no domain keep the fitted window.
  assert.match(multi, /return \{ min: domainMin, max: domainMax \};[\s\S]{0,400}priceDomain\(values\)/);
  assert.match(single, /return \{ min: domainMin, max: domainMax \};[\s\S]{0,200}priceDomain\(values\)/);
});

test('the domain memo re-runs when the explicit bounds change', () => {
  assert.match(multi, /\}, \[lines, domainMin, domainMax\]\)/);
});

test('the market detail page pins both charts to a full 0-100% axis', () => {
  // Polymarket-style fixed scale: a 3-point move should read as a small
  // move, not get zoomed until it fills the card.
  const pinned = detail.match(/domainMin=\{0\}\s*\n\s*domainMax=\{100\}/g) || [];
  assert.equal(pinned.length, 2, 'both the binary and multi-outcome charts must be pinned');
});
