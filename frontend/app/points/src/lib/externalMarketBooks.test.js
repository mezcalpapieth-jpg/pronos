import assert from 'node:assert/strict';
import test from 'node:test';
import { getExternalMarkets } from './externalMarkets.js';
import {
  decodeHyperCoreBook,
  externalBookMarketId,
  hyperCoreBookIsFresh,
  readSkewBookFrame,
  watchHyperCoreBook,
  watchSkewBook,
} from './externalMarketBooks.js';

const time = Date.parse('2026-11-18T16:14:55.291Z');
const outcomeCoin = '#372860';
const marketId = '34366';
const skewSequence = (31n << 40n) + 17n;

function nativeFrame() {
  return {
    channel: 'l2Book',
    data: {
      coin: outcomeCoin,
      time,
      levels: [
        [{ px: '0.33765', sz: '103.0', n: 1 }, { px: '0.33764', sz: '149.0', n: 1 }],
        [{ px: '0.3385', sz: '222.0', n: 3 }],
      ],
    },
  };
}

function skewSnapshot(sequence = skewSequence) {
  return {
    market: marketId,
    t: 'snapshot',
    book_seq: String(sequence),
    ts: String(time),
    phase: 'open',
    hl: { bids: [330, 17, 0], asks: [350, 18, 0] },
    pool: { bids: [320, 12] },
    rfq: { stale: false, reason: 'UNAVAILABLE' },
  };
}

function skewDelta(prev = skewSequence, seq = prev + 1n) {
  return {
    market: marketId,
    t: 'delta',
    book_seq: String(seq),
    prev_seq: String(prev),
    ts: String(time + 1_000),
    levels: [
      { layer: 'pool', side: 'bid', px: 320 },
      { layer: 'pool', side: 'ask', px: 352, sz: 9 },
    ],
  };
}

test('only curated Outcome and Skew cards have live book identifiers', () => {
  const enabled = getExternalMarkets().filter(market => externalBookMarketId(market));
  assert.deepEqual(enabled.map(externalBookMarketId), ['37286', '37285', '34366', '34378', '19822']);
  assert.equal(externalBookMarketId({ venue: 'skew', sourceId: 'out:34366 · pregunta 653' }), null);
});

test('HyperCore preserves price precision, one-sided depth, and timestamp freshness', () => {
  const decoded = decodeHyperCoreBook(nativeFrame(), outcomeCoin, time);
  assert.deepEqual(decoded.bids[0], { price: 0.33765, shares: 103 });
  assert.ok(hyperCoreBookIsFresh(decoded, time + 29_999));
  assert.equal(hyperCoreBookIsFresh(decoded, time + 30_000), false);
  const oneSided = nativeFrame();
  oneSided.data.levels[0] = [];
  assert.deepEqual(decodeHyperCoreBook(oneSided, outcomeCoin, time).bids, []);
  assert.equal(decodeHyperCoreBook(nativeFrame(), '#372861', time), null);
  assert.equal(decodeHyperCoreBook(nativeFrame(), outcomeCoin, time - 5_001), null);
  const crossed = nativeFrame();
  crossed.data.levels[1][0].px = '0.32';
  assert.equal(decodeHyperCoreBook(crossed, outcomeCoin, time), null);
});

test('Skew parses packed layers independently and applies replacement deltas', () => {
  const initial = readSkewBookFrame(null, skewSnapshot(), marketId);
  assert.equal(initial.kind, 'book');
  assert.deepEqual(initial.book.layers.hl.asks, [{ price: 0.35, shares: 18 }]);
  assert.deepEqual(initial.book.layers.pool.bids, [{ price: 0.32, shares: 12 }]);
  assert.equal(initial.book.layers.rfq.reason, 'UNAVAILABLE');

  const next = readSkewBookFrame(initial.book, skewDelta(), marketId);
  assert.equal(next.kind, 'book');
  assert.deepEqual(next.book.layers.hl, initial.book.layers.hl);
  assert.deepEqual(next.book.layers.pool.bids, []);
  assert.deepEqual(next.book.layers.pool.asks, [{ price: 0.352, shares: 9 }]);
  assert.deepEqual(initial.book.layers.pool.bids, [{ price: 0.32, shares: 12 }]);
  assert.equal(readSkewBookFrame(next.book, skewDelta(), marketId).kind, 'ignore');
});

test('Skew requires continuity, supports published phase changes, and rejects invalid depth', () => {
  const { book } = readSkewBookFrame(null, skewSnapshot(), marketId);
  assert.equal(readSkewBookFrame(book, skewDelta(skewSequence + 1n), marketId).kind, 'resync');
  assert.equal(readSkewBookFrame(book, skewDelta(skewSequence, 32n << 40n), marketId).kind, 'resync');
  assert.equal(readSkewBookFrame(book, { ...skewDelta(), phase: 'settled' }, marketId).book.phase, 'settled');
  assert.equal(readSkewBookFrame(book, { ...skewDelta(), ts: 'invalid' }, marketId).kind, 'resync');
  assert.equal(readSkewBookFrame(null, { ...skewSnapshot(), hl: { bids: [200, 2] } }, marketId).kind, 'resync');
});

class MockSocket {
  static latest;

  constructor(url, protocol) {
    this.url = url;
    this.protocol = protocol;
    this.readyState = 0;
    this.sent = [];
    MockSocket.latest = this;
  }

  open() {
    this.readyState = 1;
    this.onopen();
  }

  send(message) {
    this.sent.push(JSON.parse(message));
  }

  message(frame) {
    this.onmessage({ data: JSON.stringify(frame) });
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

test('native subscription only reads the requested side and closes with the view', () => {
  const events = [];
  const stop = watchHyperCoreBook('37286', 0, event => events.push(event), MockSocket);
  const ws = MockSocket.latest;
  try {
    ws.open();
    assert.deepEqual(ws.sent[0], { method: 'subscribe', subscription: { type: 'l2Book', coin: outcomeCoin } });
    const frame = nativeFrame();
    frame.data.time = Date.now();
    ws.message(frame);
    assert.equal(events.at(-1).status, 'live');
  } finally {
    stop();
  }
  assert.equal(ws.readyState, 3);
});

test('anonymous Skew subscription hides broken chains until a fresh snapshot arrives', () => {
  const events = [];
  const stop = watchSkewBook(marketId, event => events.push(event), MockSocket);
  const ws = MockSocket.latest;
  try {
    ws.open();
    assert.equal(ws.protocol, 'skew.markets.v1');
    assert.deepEqual(ws.sent[0], { op: 'subscribe', id: 1, ch: 'book', m: [marketId] });
    ws.message({ t: 'feed', status: 'ok' });
    ws.message(skewSnapshot());
    assert.equal(events.at(-1).status, 'live');
    assert.equal(events.at(-1).feed, 'ok');
    ws.message({ t: 'hb', feed: 'down' });
    assert.equal(events.at(-1).feed, 'down');
    ws.message(skewDelta(skewSequence + 1n));
    assert.equal(events.at(-1).status, 'connecting');
    assert.equal(events.at(-1).book, undefined);
    assert.deepEqual(ws.sent[1], { op: 'resync', id: 2, m: [marketId] });
    ws.message(skewDelta(skewSequence + 2n));
    assert.equal(ws.sent.length, 2);
    ws.message(skewSnapshot(skewSequence + 3n));
    assert.equal(events.at(-1).status, 'live');
    assert.equal(events.at(-1).book.seq, skewSequence + 3n);
  } finally {
    stop();
  }
});

test('native stream marks a silent book stale and requires a new snapshot after reconnect', context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: time });
  const events = [];
  const stop = watchHyperCoreBook('37286', 0, event => events.push(event), MockSocket);
  const first = MockSocket.latest;
  try {
    first.open();
    first.message(nativeFrame());
    assert.equal(events.at(-1).status, 'live');
    context.mock.timers.tick(30_000);
    assert.equal(events.at(-1).status, 'stale');
    first.close();
    assert.equal(events.at(-1).status, 'unavailable');
    assert.equal(events.at(-1).book, undefined);
    context.mock.timers.tick(1_000);
    const second = MockSocket.latest;
    assert.notEqual(second, first);
    second.open();
    assert.equal(events.at(-1).status, 'connecting');
    const fresh = nativeFrame();
    fresh.data.time = Date.now();
    second.message(fresh);
    assert.equal(events.at(-1).status, 'live');
  } finally {
    stop();
  }
});
