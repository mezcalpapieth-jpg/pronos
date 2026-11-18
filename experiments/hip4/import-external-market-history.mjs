import { rename, writeFile } from 'node:fs/promises';
import { getExternalMarkets } from '../../frontend/app/points/src/lib/externalMarkets.js';

// Run with Node 22+. Downloads public prices and replaces the read-only preview snapshot.
const now = Date.now();
const from = now - 60 * 24 * 60 * 60 * 1000;
const requestedStartAt = new Date(from).toISOString();
const sampledAt = new Date(now).toISOString();
const output = new URL('../../frontend/app/points/src/lib/externalMarketHistory.json', import.meta.url);
const pendingOutput = new URL(`${output.href}.${process.pid}.tmp`);
const sideKeys = ['yes', 'no'];
const infoUrl = 'https://api.hyperliquid.xyz/info';
const hipVenueCodes = { outcome: 'out', 'trade-xyz': 'txyz', skew: 'skew' };

async function readJson(url, body) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    ...(body && {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  }
  return response.json();
}

function seriesFrom(rows, time, price, toSeconds = value => value) {
  const points = new Map();
  for (const row of rows) {
    const t = toSeconds(time(row));
    const rawPrice = price(row);
    if (!Number.isSafeInteger(t) || t < Math.floor(from / 1000) || t > Math.floor(now / 1000)) continue;
    if (typeof rawPrice !== 'number' && (typeof rawPrice !== 'string' || !rawPrice.trim())) continue;
    const fraction = Number(rawPrice);
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) continue;
    points.set(t, { t, p: Number((fraction * 100).toFixed(8)) });
  }
  return [...points.values()].sort((a, b) => a.t - b.t);
}

async function polymarketHistory(market) {
  const record = await readJson(`https://gamma-api.polymarket.com/markets/${market.sourceId}`);
  const outcomes = JSON.parse(record.outcomes);
  const tokens = JSON.parse(record.clobTokenIds);
  if (String(record.id) !== market.sourceId || outcomes.length !== 2 || tokens.length !== 2) {
    throw new Error(`Unexpected Polymarket market metadata for ${market.id}`);
  }

  return Promise.all(sideKeys.map(async key => {
    const token = tokens[outcomes.findIndex(label => label.toLowerCase() === key)];
    if (typeof token !== 'string' || !/^\d+$/.test(token)) {
      throw new Error(`Missing Polymarket token for ${market.id} ${key}`);
    }
    const url = new URL('https://clob.polymarket.com/prices-history');
    url.search = new URLSearchParams({
      market: token,
      interval: 'max',
      fidelity: 60,
    });
    const { history } = await readJson(url);
    if (!Array.isArray(history)) throw new Error(`Invalid Polymarket history for ${market.id} ${key}`);
    return { key, data: seriesFrom(history, row => row.t, row => row.p) };
  }));
}

async function hipHistory(market) {
  const [, deployer, id] = /^(out|skew|txyz):(\d+)(?: · .*)?$/.exec(market.sourceId) ?? [];
  if (!id || deployer !== hipVenueCodes[market.venue]) {
    throw new Error(`Invalid HIP-4 contract for ${market.id}`);
  }
  return Promise.all(sideKeys.map(async (key, side) => {
    const coin = `#${10 * Number(id) + side}`;
    const candles = await readJson(infoUrl, {
      type: 'candleSnapshot',
      req: { coin, interval: '1h', startTime: from, endTime: now },
    });
    if (!Array.isArray(candles) || candles.some(row => row.s !== coin || row.i !== '1h')) {
      throw new Error(`Invalid HyperCore history for ${coin}`);
    }
    const tradedHours = candles.filter(row => Number.isInteger(row.n) && row.n > 0 && row.T <= now);
    const data = seriesFrom(tradedHours, row => row.T, row => row.c, time => Math.floor(time / 1000));
    return { key, data };
  }));
}

const historyByMarket = {};
for (const market of getExternalMarkets()) {
  const isPolymarket = market.venue === 'polymarket';
  const series = await (isPolymarket ? polymarketHistory(market) : hipHistory(market));
  historyByMarket[market.id] = {
    source: isPolymarket ? 'polymarket' : 'hyperliquid',
    basis: isPolymarket ? 'sampled' : 'candle-close',
    requestedStartAt,
    sampledAt,
    series,
  };
  console.log(`${market.id} ${series.map(({ key, data }) => `${key}=${data.length}`).join(' ')}`);
}

const records = Object.entries(historyByMarket).map(([id, history]) => (
  `  ${JSON.stringify(id)}: ${JSON.stringify(history)}`
));
await writeFile(pendingOutput, `{\n${records.join(',\n')}\n}\n`);
await rename(pendingOutput, output);
