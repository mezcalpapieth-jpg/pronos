import { STOCK_ASSETS, STOCK_CHART_RANGES, stockAsset } from './stock-assets.js';
import { readBanxicoLatest, SERIES, banxicoFechaToYmd, mexicoDateYmdFromIso } from './banxico.js';
import { assertStockQuoteFresh, fixed, stockError } from './stock-math.js';

export async function rows(db, text, params = []) {
  const result = await db.query(text, params);
  return Array.isArray(result) ? result : result.rows;
}

export function validateFx(fx, now = Date.now()) {
  try {
    const date = Date.parse(`${fx?.date}T00:00:00Z`);
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== fx.date
        || date > now || now - date > 7 * 86400000 || fixed(fx.rate, 8) <= 0n) throw new Error('invalid FX');
    return fx;
  } catch { throw stockError('stock_fx_unavailable', 503); }
}

export function createStockData(db, { fetchInfo = infoRequest, fetchFx = latestFx, fetchFxAt = historicalFx, now = Date.now } = {}) {
  const pending = new Map();
  const venueFor = asset => asset.marketType === 'spot' ? 'spot' : asset.dex;
  async function cached(key, maxAge, loader, stale = false) {
    const [stored] = await rows(db, 'SELECT payload, fetched_at FROM points_stock_cache WHERE cache_key = $1', [key]);
    const age = now() - new Date(stored?.fetched_at).getTime();
    if (stored && age >= 0 && age < maxAge) return stored.payload;
    // Coalesce within an instance. Persisted snapshots are shared by Vercel instances.
    const pendingKey = key;
    if (!pending.has(pendingKey)) {
      const task = (async () => {
        const value = await loader();
        await db.query(`INSERT INTO points_stock_cache(cache_key,payload,fetched_at) VALUES($1,$2,$3)
          ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,fetched_at=EXCLUDED.fetched_at`,
        [key, JSON.stringify(value), new Date(now()).toISOString()]);
        return value;
      })();
      pending.set(pendingKey, task);
      task.finally(() => pending.delete(pendingKey)).catch(() => {});
    }
    try { return await pending.get(pendingKey); }
    catch (error) {
      if (stale && stored) return { ...stored.payload, stale: true };
      throw error;
    }
  }

  async function fx(stale = false) {
    const value = await cached('fx:banxico', 3600000, async () => validateFx(await fetchFx(), now()), stale);
    try { return validateFx(value, now()); }
    catch (error) { if (stale) return { ...value, stale: true }; throw error; }
  }

  async function metadata(venue, stale = false) {
    return cached(`meta:v4:${venue || 'native'}`, 5000, async () => {
      const response = await fetchInfo(venue === 'spot' ? { type: 'spotMetaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex: venue });
      const universe = response?.[0]?.universe;
      const contexts = response?.[1];
      if (!Array.isArray(universe) || !Array.isArray(contexts)) throw stockError('stock_price_unavailable', 503);
      const assets = STOCK_ASSETS.filter(asset => venueFor(asset) === venue).map(asset => {
        const i = universe.findIndex(item => item.name === asset.coin);
        const token = venue === 'spot' ? response[0].tokens?.find(t => t.tokenId === asset.tokenId) : null;
        const identityMatches = venue !== 'spot' || (token?.evmContract?.address?.toLowerCase() === asset.wrapperAddress
          && universe[i]?.tokens?.includes(token.index));
        // Spot universe entries are sparse and can be reordered independently
        // of contexts. Their explicit market ID is the join key.
        const context = venue === 'spot' ? contexts.find(item => item.coin === asset.coin) : contexts[i];
        const szDecimals = venue === 'spot' ? token?.szDecimals : universe[i]?.szDecimals;
        const price = Number(context?.markPx);
        const previous = Number(context?.prevDayPx);
        const available = i >= 0 && identityMatches && !universe[i].isDelisted && Number.isFinite(price) && price > 0
          && Number.isInteger(szDecimals) && szDecimals >= 0 && szDecimals <= 8;
        return { ...asset, available, szDecimals, fetchedAt: now(), priceUsd: available ? String(context.markPx) : null,
          change24h: available && previous > 0 ? (price / previous - 1) * 100 : null,
          volumeUsd: Number(context?.dayNtlVlm) || 0 };
      });
      return { assets, fetchedAt: now(), stale: false };
    }, stale);
  }

  async function assets(stale = false, ticker, { includePreviews = true } = {}) {
    const selected = ticker ? stockAsset(ticker) : null;
    if (ticker && !selected) throw stockError('stock_not_found', 404);
    const catalogue = selected ? [selected] : STOCK_ASSETS.filter(asset => includePreviews || !asset.readOnly);
    const dexes = [...new Set(catalogue.map(venueFor))];
    const [results, exchange] = await Promise.all([
      Promise.allSettled(dexes.map(dex => metadata(dex, stale))), fx(stale),
    ]);
    const metas = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!metas.length) throw stockError('stock_price_unavailable', 503);
    const unavailable = results.some(result => result.status === 'rejected');
    return { source: 'Hyperliquid', fetchedAt: Math.min(...metas.map(meta => meta.fetchedAt)), fx: exchange,
      stale: Boolean(unavailable || metas.some(meta => meta.stale) || exchange.stale),
      assets: catalogue.map(asset => metas.flatMap(meta => meta.assets).find(item => item.ticker === asset.ticker)
        || { ...asset, available: false, priceUsd: null, change24h: null, volumeUsd: 0 }).map(asset => ({ ...asset,
        priceMxn: asset.priceUsd ? Number(asset.priceUsd) * Number(exchange.rate) : null })) };
  }

  async function book(ticker, { fresh = false } = {}) {
    const asset = stockAsset(ticker);
    if (!asset) throw stockError('stock_not_found', 404);
    const [meta, exchange, response] = await Promise.all([
      metadata(venueFor(asset)), fx(), cached(`book:${asset.ticker}`, fresh ? 0 : 3000, async () => {
        const data = await fetchInfo({ type: 'l2Book', coin: asset.coin });
        return { ...data, fetchedAt: now() };
      }),
    ]);
    const listed = meta.assets.find(item => item.ticker === asset.ticker);
    if (!listed?.available || response.coin !== asset.coin || !Array.isArray(response.levels)
        || response.levels.length !== 2) throw stockError('stock_price_unavailable', 503);
    let levels;
    try {
      levels = response.levels.map((side, sideIndex) => {
        if (!Array.isArray(side) || !side.length) throw new Error('empty');
        let prior = null;
        return side.map(level => {
          const px = fixed(level.px, 8);
          const sz = fixed(level.sz, listed.szDecimals);
          if (px <= 0n || sz <= 0n || (prior !== null && (sideIndex ? px < prior : px > prior))) throw new Error('book');
          prior = px;
          return { px: String(level.px), sz: String(level.sz) };
        });
      });
      if (fixed(levels[0][0].px, 8) >= fixed(levels[1][0].px, 8)) throw new Error('crossed');
    } catch { throw stockError('stock_price_unavailable', 503); }
    const quote = { ticker: asset.ticker, levels, szDecimals: listed.szDecimals,
      fx: exchange, markPriceUsd: listed.priceUsd, markFetchedAt: meta.fetchedAt, bookTime: response.time, fetchedAt: response.fetchedAt };
    assertStockQuoteFresh(quote, now());
    return quote;
  }

  async function candles(ticker, range) {
    const asset = stockAsset(ticker);
    const config = range === 'SPARK' ? { interval: '1h', durationMs: 86400000 } : STOCK_CHART_RANGES[range];
    if (!asset || !config) throw stockError('invalid_stock_chart');
    // Expire ahead of the UI's 60s poll. Equal TTL/poll periods can otherwise
    // reuse the previous sample when the next request starts just before expiry.
    return cached(`candles:${asset.ticker}:${range}`, 55000, async () => {
      const end = now();
      const raw = await fetchInfo({ type: 'candleSnapshot', req: { coin: asset.coin,
        interval: config.interval, startTime: end - config.durationMs, endTime: end } });
      if (!Array.isArray(raw)) throw stockError('stock_price_unavailable', 503);
      const candles = raw.filter(c => c.s === asset.coin && c.i === config.interval
        && Number.isFinite(c.t) && c.t <= end && c.t >= end - config.durationMs
        && Number(c.c) > 0 && Number.isFinite(Number(c.c)))
        .map(c => ({ t: c.t, ...(Number.isFinite(c.T) && c.T >= c.t ? { endTime: c.T } : {}), close: Number(c.c) })).sort((a, b) => a.t - b.t);
      return { ticker: asset.ticker, range, interval: config.interval, candles, fetchedAt: now(), currency: 'USD' };
    });
  }
  async function cutoff(tickers, cutoffAt) {
    if (!Number.isFinite(cutoffAt) || cutoffAt > now()) throw stockError('stock_cutoff_price_unavailable', 503);
    const boundary = Math.floor(cutoffAt / 60000) * 60000;
    const [exchange, prices] = await Promise.all([fetchFxAt(cutoffAt), Promise.all(tickers.map(async ticker => {
      const asset = stockAsset(ticker);
      if (!asset) throw stockError('stock_not_found', 404);
      const raw = await fetchInfo({ type: 'candleSnapshot', req: { coin: asset.coin, interval: '1m', startTime: boundary - 60000, endTime: boundary } });
      // Require the exact last completed minute. Never select a later candle,
      // a forming close, or an older price silently when a cutoff sample is absent.
      const candle = raw?.find?.(c => c.s === asset.coin && c.i === '1m' && c.t === boundary - 60000
        && Number.isFinite(c.T) && c.T < boundary && Number(c.c) > 0 && Number.isFinite(Number(c.c)));
      if (!candle) throw stockError('stock_cutoff_price_unavailable', 503);
      return { ...asset, available: true, priceUsd: String(candle.c), pricedAt: candle.T };
    }))]);
    validateFx(exchange, cutoffAt);
    if (exchange.date > mexicoDateYmdFromIso(new Date(cutoffAt).toISOString())) throw stockError('stock_fx_unavailable', 503);
    return { assets: prices, fx: exchange, fetchedAt: now(), stale: false };
  }
  return { assets, book, candles, cutoff };
}

async function infoRequest(body) {
  try {
    const response = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`info:${response.status}`);
    return await response.json();
  } catch { throw stockError('stock_price_unavailable', 503); }
}

async function latestFx() {
  // Use the same canonical FIX reader as prediction markets; enforce a timeout
  // here because an unavailable rate must never leave a quote waiting forever.
  let timer;
  try {
    const result = await Promise.race([readBanxicoLatest(SERIES.FX_USD_MXN),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('fx timeout')), 5000); })]);
    return { rate: String(result.value), date: banxicoFechaToYmd(result.fecha), source: 'Banxico FIX' };
  } catch { throw stockError('stock_fx_unavailable', 503); }
  finally { clearTimeout(timer); }
}

async function historicalFx(cutoffAt) {
  const token = process.env.BANXICO_API_TOKEN;
  if (!token) throw stockError('stock_fx_unavailable', 503);
  const end = mexicoDateYmdFromIso(new Date(cutoffAt).toISOString());
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  try {
    const response = await fetch(`https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIES.FX_USD_MXN}/datos/${start}/${end}?mediaType=json`, {
      headers: { 'Bmx-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('FX request failed');
    const json = await response.json();
    const points = (json?.bmx?.series?.[0]?.datos || []).map(point => ({ rate: String(point.dato), date: banxicoFechaToYmd(point.fecha), source: 'Banxico FIX' }))
      .filter(point => point.date && point.date <= end && Number(point.rate) > 0).sort((a, b) => b.date.localeCompare(a.date));
    return validateFx(points[0], cutoffAt);
  } catch { throw stockError('stock_fx_unavailable', 503); }
}
