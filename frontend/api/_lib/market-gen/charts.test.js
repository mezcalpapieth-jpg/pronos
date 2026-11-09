import test from 'node:test';
import assert from 'node:assert/strict';
import { readAppleMxTopArtist } from '../charts.js';
import { generateChartsMarkets } from './charts.js';

const feed = {
  feed: { results: [
    { id: '1', name: 'First song', artistName: 'First artist' },
    { id: '2', name: 'Second song', artistName: 'Second artist' },
  ] },
};

test('chart generation retries a transient Apple 504 with a fresh request deadline', async t => {
  t.mock.method(console, 'warn', () => {});
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signals.push(signal);
    return signals.length === 1 ? new Response(null, { status: 504 }) : Response.json(feed);
  });

  const specs = await generateChartsMarkets();
  assert.equal(specs.length, 1);
  assert.deepEqual(specs[0].outcomes, ['First artist', 'Second artist', 'Otro']);
  assert.equal(signals.length, 2);
  assert.ok(signals.every(signal => signal instanceof AbortSignal));
  assert.notEqual(signals[0], signals[1]);
});

test('chart generation stops after two timeouts and the resolver still reads the current chart', async t => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(AbortSignal, 'timeout', ms => {
    assert.equal(ms, 5000);
    return AbortSignal.abort(new DOMException('expired', 'TimeoutError'));
  });
  const signals = [];
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    signals.push(signal);
    signal?.throwIfAborted();
    return Response.json(feed);
  });

  assert.deepEqual(await generateChartsMarkets(), []);
  assert.equal(signals.length, 2);
  assert.deepEqual(await readAppleMxTopArtist(), {
    artist: 'First artist', trackName: 'First song', trackId: '1',
  });
  assert.deepEqual(signals.slice(2), [undefined]);
});
