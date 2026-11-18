// Public, read-only wire formats: Hyperliquid l2Book and Skew markets v1.
// https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions
// https://github.com/skew-trade/skew-sdk/blob/main/proto/rfq/v1/book.proto

const HYPERCORE_WS = 'wss://api.hyperliquid.xyz/ws';
const SKEW_WS = 'wss://markets.skew.trade/v1/ws';
const BOOK_TTL_MS = 30_000;
const MAX_CLOCK_LEAD_MS = 5_000;
const MAX_SEQUENCE = (1n << 64n) - 1n;
const LAYERS = ['hl', 'pool', 'rfq'];
const PHASES = ['open', 'expired', 'settled', 'unregistered'];
const FEED_STATES = ['ok', 'stale', 'down'];
const INITIAL_STATUS = 'connecting';

export function externalBookMarketId(market) {
  const pattern = market?.venue === 'outcome' ? /^out:([1-9]\d{0,7})(?: · pregunta \d+)?$/
    : market?.venue === 'skew' ? /^skew:([1-9]\d{0,7})$/ : null;
  return pattern?.exec(market.sourceId)?.[1] ?? null;
}

function wireInteger(value) {
  const parsed = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 8.64e15 ? parsed : null;
}

function wireSequence(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) return null;
  const seq = BigInt(value);
  return seq <= MAX_SEQUENCE ? seq : null;
}

function hyperCoreLevel(level) {
  if (typeof level?.px !== 'string' || typeof level?.sz !== 'string'
    || !/^0\.\d{1,5}$/.test(level.px) || !/^\d{1,15}(?:\.0+)?$/.test(level.sz)) return null;
  const price = Number(level.px);
  const shares = Number(level.sz);
  return price > 0 && shares > 0 ? { price, shares } : null;
}

function sortedLevels(levels, ascending) {
  return levels.every((level, i) => level && (!i || (ascending
    ? levels[i - 1].price < level.price : levels[i - 1].price > level.price)));
}

function uncrossed(bids, asks) {
  return !bids[0] || !asks[0] || bids[0].price < asks[0].price;
}

export function decodeHyperCoreBook(frame, coin, receivedAt) {
  const data = frame?.data;
  if (frame?.channel !== 'l2Book' || data?.coin !== coin
    || !Number.isSafeInteger(data.time) || data.time <= 0
    || data.time > receivedAt + MAX_CLOCK_LEAD_MS
    || !Array.isArray(data.levels) || data.levels.length !== 2
    || data.levels.some(side => !Array.isArray(side) || side.length > 20)) return null;
  const [bids, asks] = data.levels.map(side => side.map(hyperCoreLevel));
  if (!sortedLevels(bids, false) || !sortedLevels(asks, true) || !uncrossed(bids, asks)) return null;
  return { bids, asks, time: data.time };
}

export function hyperCoreBookIsFresh(book, now) {
  return Boolean(book && now - book.time < BOOK_TTL_MS);
}

function skewPrice(value) {
  return Number.isInteger(value) && value >= 0 && value <= 1000;
}

function skewSize(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function skewLevels(values, stride, ascending) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > stride * 1001 || values.length % stride) return null;
  const levels = [];
  for (let i = 0; i < values.length; i += stride) {
    const [milli, shares, reserved] = values.slice(i, i + stride);
    if (!skewPrice(milli) || !skewSize(shares) || !shares || (stride === 3 && reserved !== 0)) return null;
    levels.push({ price: milli / 1000, shares });
  }
  return sortedLevels(levels, ascending) ? levels : null;
}

function skewLayerHeader(layer) {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)
    || (layer.stale !== undefined && typeof layer.stale !== 'boolean')
    || (layer.reason !== undefined && typeof layer.reason !== 'string')) return null;
  return layer;
}

function snapshotLayer(raw, layer) {
  const header = skewLayerHeader(raw);
  if (!header) return null;
  const stride = layer === 'hl' ? 3 : 2;
  const bids = skewLevels(header.bids, stride, false);
  const asks = skewLevels(header.asks, stride, true);
  return bids && asks ? { bids, asks, stale: header.stale ?? false, reason: header.reason ?? '' } : null;
}

function applySkewDelta(book, frame) {
  const layers = { ...book.layers };
  for (const key of LAYERS) {
    if (frame[key] === undefined) continue;
    const header = skewLayerHeader(frame[key]);
    if (!header) return null;
    const prev = layers[key] ?? { bids: [], asks: [], stale: false, reason: '' };
    layers[key] = { ...prev, stale: header.stale ?? prev.stale, reason: header.reason ?? prev.reason };
  }
  const changes = frame.levels ?? [];
  if (!Array.isArray(changes) || changes.length > LAYERS.length * 2002) return null;
  const changedSides = new Map();
  for (const change of changes) {
    if (!change || typeof change.layer !== 'string') return null;
    const { layer, side } = change;
    if (!LAYERS.includes(layer)) continue;
    // ProtoJSON can omit zero uint32 fields, including a deletion's size.
    const milli = change.px ?? 0;
    const shares = change.sz ?? 0;
    if (!['bid', 'ask'].includes(side) || !skewPrice(milli) || !skewSize(shares) || !layers[layer]) return null;
    const key = side === 'bid' ? 'bids' : 'asks';
    const id = layer + ':' + key;
    if (!changedSides.has(id)) {
      changedSides.set(id, { layer, key, levels: new Map(layers[layer][key].map(level => [level.price, level])) });
    }
    const { levels } = changedSides.get(id);
    const price = milli / 1000;
    if (shares) levels.set(price, { price, shares });
    else levels.delete(price);
  }
  for (const { layer, key, levels } of changedSides.values()) {
    const ordered = [...levels.values()].sort((a, b) => key === 'bids' ? b.price - a.price : a.price - b.price);
    layers[layer] = { ...layers[layer], [key]: ordered };
  }
  return layers;
}

// A broken chain discards the visible book until a replacement snapshot arrives.
export function readSkewBookFrame(book, frame, marketId) {
  if (frame?.market !== marketId || !['snapshot', 'delta'].includes(frame.t)) return { kind: 'ignore' };
  const seq = wireSequence(frame.book_seq);
  const time = wireInteger(frame.ts);
  if (seq && book && seq <= book.seq) return { kind: 'ignore' };
  const phase = frame.phase ?? book?.phase;
  if (!seq || !time || !PHASES.includes(phase)) return { kind: 'resync' };

  let layers;
  if (frame.t === 'snapshot') {
    layers = {};
    for (const key of LAYERS) {
      if (frame[key] === undefined) continue;
      const layer = snapshotLayer(frame[key], key);
      if (!layer) return { kind: 'resync' };
      layers[key] = layer;
    }
  } else {
    const prevSeq = wireSequence(frame.prev_seq);
    if (!book || !prevSeq || prevSeq !== book.seq || seq !== prevSeq + 1n
      || (seq >> 40n) !== (prevSeq >> 40n) || time < book.time) return { kind: 'resync' };
    layers = applySkewDelta(book, frame);
    if (!layers) return { kind: 'resync' };
  }
  return { kind: 'book', book: { seq, time, phase, layers } };
}

function watchSocket(config, onUpdate, WebSocketImpl) {
  if (!WebSocketImpl) {
    onUpdate({ status: 'unavailable' });
    return () => {};
  }

  let socket;
  let reconnect;
  let check;
  let closed = false;
  let attempt = 0;

  function connect() {
    const wait = () => {
      clearInterval(check);
      if (closed) return;
      onUpdate({ status: 'unavailable' });
      if (attempt < 10) {
        const base = Math.min(500 * 2 ** attempt++, 20_000);
        reconnect = setTimeout(connect, base * (1 + Math.random() / 2));
      }
    };
    let ws;
    try {
      ws = new WebSocketImpl(config.url, config.protocol);
    } catch {
      wait();
      return;
    }
    socket = ws;
    const connectedAt = Date.now();
    let lastMessage = connectedAt;
    let lastPing = connectedAt;
    let lastStatus;
    let lastBook;
    let lastFeed;
    const publish = (status, book, feed) => {
      if (closed || socket !== ws) return;
      if (status !== lastStatus || book !== lastBook || feed !== lastFeed) {
        onUpdate({ status, book, feed });
        lastStatus = status;
        lastBook = book;
        lastFeed = feed;
      }
    };
    const send = message => {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    };
    const stream = config.connect({ send, publish, healthy: () => { attempt = 0; }, disconnect: () => ws.close() });
    publish(INITIAL_STATUS);
    ws.onopen = stream.open;
    ws.onmessage = event => {
      if (closed || socket !== ws || typeof event.data !== 'string') return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      const now = Date.now();
      lastMessage = now;
      stream.message(frame, now);
    };
    ws.onerror = () => ws.close();
    ws.onclose = event => {
      if (closed || socket !== ws) return;
      if (config.stopCodes?.includes(event.code)) {
        clearInterval(check);
        publish('unavailable');
      } else {
        if (event.code === 4429) attempt = Math.max(5, attempt);
        wait();
      }
    };
    check = setInterval(() => {
      const now = Date.now();
      if (now - lastMessage > config.timeout) {
        ws.close();
        return;
      }
      if (config.ping && now - lastPing >= 20_000) {
        send(config.ping);
        lastPing = now;
      }
      stream.tick(now);
    }, 1000);
  }

  connect();
  return () => {
    closed = true;
    clearInterval(check);
    clearTimeout(reconnect);
    socket?.close();
  };
}

export function watchHyperCoreBook(marketId, side, onUpdate, WebSocketImpl = globalThis.WebSocket) {
  const coin = '#' + marketId + side;
  return watchSocket({
    url: HYPERCORE_WS,
    timeout: 45_000,
    ping: { method: 'ping' },
    connect({ send, publish, healthy, disconnect }) {
      let book;
      let openedAt;
      return {
        open() {
          openedAt = Date.now();
          send({ method: 'subscribe', subscription: { type: 'l2Book', coin } });
        },
        message(frame, now) {
          if (frame?.channel === 'error') {
            disconnect();
            return;
          }
          const snapshot = decodeHyperCoreBook(frame, coin, now);
          if (!snapshot || (book && snapshot.time < book.time)) return;
          book = snapshot;
          if (hyperCoreBookIsFresh(book, now)) {
            healthy();
            publish('live', book);
          }
        },
        tick(now) {
          if (!hyperCoreBookIsFresh(book, now) && book) publish('stale', book);
          if (!book && openedAt && now - openedAt > 15_000) disconnect();
        },
      };
    },
  }, onUpdate, WebSocketImpl);
}

export function watchSkewBook(marketId, onUpdate, WebSocketImpl = globalThis.WebSocket) {
  return watchSocket({
    url: SKEW_WS,
    protocol: 'skew.markets.v1',
    timeout: 15_000,
    stopCodes: [4400, 4401, 4403],
    connect({ send, publish, healthy, disconnect }) {
      let book;
      let feed;
      let waitingAt;
      let resyncing = false;
      let nextId = 0;
      return {
        open() {
          waitingAt = Date.now();
          send({ op: 'subscribe', id: ++nextId, ch: 'book', m: [marketId] });
        },
        message(frame, now) {
          if (frame?.t === 'error') {
            publish('unavailable');
            book = null;
            if (['UNKNOWN_MARKET', 'MARKET_SETTLED', 'UNAUTHORIZED', 'UNKNOWN_CHANNEL', 'BAD_REQUEST'].includes(frame.code)) {
              waitingAt = null;
            }
            return;
          }
          const reported = frame?.t === 'feed' ? frame.status : frame?.t === 'hb' ? frame.feed : null;
          if (FEED_STATES.includes(reported)) {
            feed = reported;
            if (book) publish('live', book, feed);
            return;
          }
          if (resyncing && frame?.t !== 'snapshot') return;
          const result = readSkewBookFrame(book, frame, marketId);
          if (result.kind === 'ignore') return;
          if (result.kind === 'resync') {
            if (resyncing) return;
            book = null;
            resyncing = true;
            waitingAt = now;
            publish('connecting');
            send({ op: 'resync', id: ++nextId, m: [marketId] });
            return;
          }
          book = result.book;
          resyncing = false;
          waitingAt = null;
          healthy();
          publish('live', book, feed);
        },
        tick(now) {
          if (waitingAt && now - waitingAt > 10_000) disconnect();
        },
      };
    },
  }, onUpdate, WebSocketImpl);
}
