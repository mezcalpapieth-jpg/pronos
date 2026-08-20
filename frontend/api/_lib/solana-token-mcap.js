export const COINGECKO_TOKEN_MCAP_SOURCE = 'coingecko-token-mcap';
export const COINGECKO_MARKETS_SOURCE = 'coingecko-markets';
export const GECKOTERMINAL_VERIFY_SOURCE = 'geckoterminal-pool-ohlcv';

export const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
export const GECKOTERMINAL_BASE_URL = 'https://api.geckoterminal.com/api/v2';
export const GECKOTERMINAL_ACCEPT = 'application/json;version=20230203';

const DEFAULT_SNAPSHOT_TOLERANCE_SECONDS = 5 * 60;
const DEFAULT_DISPUTE_BPS = 200;

function toIso(ms) {
  return new Date(ms).toISOString();
}

function parseTimestampMs(timestamp) {
  const ms = timestamp instanceof Date
    ? timestamp.getTime()
    : (typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime());
  if (!Number.isFinite(ms)) throw new Error('solana-token-mcap: invalid timestamp');
  return ms;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeCoinId(value) {
  const coinId = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(coinId)) {
    throw new Error('solana-token-mcap: invalid coingecko coin id');
  }
  return coinId;
}

function normalizeNetwork(value = 'solana') {
  const network = String(value || 'solana').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(network)) {
    throw new Error('solana-token-mcap: invalid geckoterminal network');
  }
  return network;
}

function normalizeSolanaTokenAddress(value) {
  const address = String(value || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(address)) {
    throw new Error('solana-token-mcap: invalid solana token address');
  }
  return address;
}

function normalizePoolAddress(value) {
  const address = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{16,160}$/.test(address)) {
    throw new Error('solana-token-mcap: invalid pool address');
  }
  return address;
}

function resolveRows(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function coingeckoApiKey() {
  return process.env.COINGECKO_API_KEY
    || process.env.COINGECKO_DEMO_API_KEY
    || process.env.CG_DEMO_API_KEY
    || null;
}

export function buildCoinGeckoMarketsUrl({
  coinId,
  baseUrl = COINGECKO_BASE_URL,
} = {}) {
  const url = new URL('/api/v3/coins/markets', baseUrl.endsWith('/api/v3') ? baseUrl.slice(0, -7) : baseUrl);
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('ids', normalizeCoinId(coinId));
  url.searchParams.set('sparkline', 'false');
  return url.toString();
}

export function parseCoinGeckoMarket(row, {
  coinId,
  capturedAt = new Date().toISOString(),
} = {}) {
  const marketCap = positiveNumber(row?.market_cap);
  if (!marketCap) throw new Error('solana-token-mcap: coingecko market_cap missing');
  const sourceUpdatedMs = row?.last_updated ? new Date(row.last_updated).getTime() : NaN;
  return {
    source: COINGECKO_MARKETS_SOURCE,
    coinId: normalizeCoinId(coinId || row?.id),
    symbol: String(row?.symbol || '').toUpperCase() || null,
    name: row?.name || null,
    marketCap,
    priceUsd: positiveNumber(row?.current_price),
    circulatingSupply: positiveNumber(row?.circulating_supply),
    totalSupply: positiveNumber(row?.total_supply),
    fdvUsd: positiveNumber(row?.fully_diluted_valuation),
    capturedAt,
    sourceUpdatedAt: Number.isFinite(sourceUpdatedMs) ? toIso(sourceUpdatedMs) : null,
    raw: row,
  };
}

export async function readCoinGeckoTokenMarketCap({
  coinId,
  fetchImpl = globalThis.fetch,
  apiKey = coingeckoApiKey(),
  capturedAt = new Date().toISOString(),
  baseUrl = COINGECKO_BASE_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('solana-token-mcap: fetch unavailable');
  }
  const normalizedCoinId = normalizeCoinId(coinId);
  const response = await fetchImpl(buildCoinGeckoMarketsUrl({ coinId: normalizedCoinId, baseUrl }), {
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { 'x-cg-demo-api-key': apiKey } : {}),
    },
  });
  if (!response?.ok) {
    throw new Error(`solana-token-mcap: coingecko markets failed ${response?.status || 'unknown'}`);
  }
  const payload = await response.json();
  const row = Array.isArray(payload)
    ? payload.find(item => String(item?.id || '').toLowerCase() === normalizedCoinId) || payload[0]
    : null;
  if (!row) throw new Error('solana-token-mcap: coingecko empty response');
  return parseCoinGeckoMarket(row, { coinId: normalizedCoinId, capturedAt });
}

export function buildGeckoTerminalTokenPoolsUrl({
  network = 'solana',
  tokenAddress,
  baseUrl = GECKOTERMINAL_BASE_URL,
} = {}) {
  const url = new URL(
    `/api/v2/networks/${encodeURIComponent(normalizeNetwork(network))}/tokens/${encodeURIComponent(normalizeSolanaTokenAddress(tokenAddress))}/pools`,
    baseUrl.endsWith('/api/v2') ? baseUrl.slice(0, -7) : baseUrl,
  );
  url.searchParams.set('page', '1');
  return url.toString();
}

export function buildGeckoTerminalOhlcvUrl({
  network = 'solana',
  poolAddress,
  tokenAddress,
  beforeTimestampSec,
  limit = 1000,
  baseUrl = GECKOTERMINAL_BASE_URL,
} = {}) {
  const before = Math.floor(Number(beforeTimestampSec));
  if (!Number.isFinite(before) || before <= 0) {
    throw new Error('solana-token-mcap: invalid ohlcv before timestamp');
  }
  const url = new URL(
    `/api/v2/networks/${encodeURIComponent(normalizeNetwork(network))}/pools/${encodeURIComponent(normalizePoolAddress(poolAddress))}/ohlcv/minute`,
    baseUrl.endsWith('/api/v2') ? baseUrl.slice(0, -7) : baseUrl,
  );
  url.searchParams.set('aggregate', '1');
  url.searchParams.set('before_timestamp', String(before));
  url.searchParams.set('limit', String(Math.max(1, Math.min(1000, Math.floor(Number(limit) || 1000)))));
  url.searchParams.set('currency', 'usd');
  url.searchParams.set('token', normalizeSolanaTokenAddress(tokenAddress));
  return url.toString();
}

export function parseGeckoTerminalPools(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map((row) => {
    const attrs = row?.attributes || {};
    const id = String(row?.id || '');
    const fallbackAddress = id.includes('_') ? id.split('_').slice(1).join('_') : id;
    return {
      id: id || null,
      address: attrs.address || fallbackAddress || null,
      name: attrs.name || null,
      dexId: attrs.dex_id || null,
      reserveInUsd: nonNegativeNumber(attrs.reserve_in_usd),
      baseTokenPriceUsd: positiveNumber(attrs.base_token_price_usd),
      quoteTokenPriceUsd: positiveNumber(attrs.quote_token_price_usd),
    };
  }).filter(pool => pool.address);
}

export function selectMostLiquidPool(pools = []) {
  return [...pools]
    .filter(pool => positiveNumber(pool?.reserveInUsd))
    .sort((a, b) => Number(b.reserveInUsd) - Number(a.reserveInUsd))[0] || null;
}

export function parseGeckoTerminalOhlcvCandles(payload) {
  const rows = Array.isArray(payload?.data?.attributes?.ohlcv_list)
    ? payload.data.attributes.ohlcv_list
    : [];
  return rows.map((row) => {
    if (!Array.isArray(row) || row.length < 5) return null;
    const startSec = Math.floor(Number(row[0]));
    const close = positiveNumber(row[4]);
    if (!Number.isFinite(startSec) || !close) return null;
    return {
      startSec,
      open: positiveNumber(row[1]),
      high: positiveNumber(row[2]),
      low: positiveNumber(row[3]),
      close,
      volume: nonNegativeNumber(row[5]),
    };
  }).filter(Boolean);
}

export async function readGeckoTerminalBoundaryMcap({
  network = 'solana',
  tokenAddress,
  targetAt,
  supply,
  fetchImpl = globalThis.fetch,
  baseUrl = GECKOTERMINAL_BASE_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('solana-token-mcap: fetch unavailable');
  }
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedToken = normalizeSolanaTokenAddress(tokenAddress);
  const targetMs = parseTimestampMs(targetAt);
  const targetSec = Math.floor(targetMs / 1000);
  const supplyNumber = positiveNumber(supply);
  if (!supplyNumber) throw new Error('solana-token-mcap: verification supply missing');

  const poolsResponse = await fetchImpl(buildGeckoTerminalTokenPoolsUrl({
    network: normalizedNetwork,
    tokenAddress: normalizedToken,
    baseUrl,
  }), { headers: { Accept: GECKOTERMINAL_ACCEPT } });
  if (!poolsResponse?.ok) {
    throw new Error(`solana-token-mcap: geckoterminal pools failed ${poolsResponse?.status || 'unknown'}`);
  }
  const pool = selectMostLiquidPool(parseGeckoTerminalPools(await poolsResponse.json()));
  if (!pool) throw new Error('solana-token-mcap: no liquid geckoterminal pool');

  const candlesResponse = await fetchImpl(buildGeckoTerminalOhlcvUrl({
    network: normalizedNetwork,
    poolAddress: pool.address,
    tokenAddress: normalizedToken,
    beforeTimestampSec: targetSec + 120,
    baseUrl,
  }), { headers: { Accept: GECKOTERMINAL_ACCEPT } });
  if (!candlesResponse?.ok) {
    throw new Error(`solana-token-mcap: geckoterminal ohlcv failed ${candlesResponse?.status || 'unknown'}`);
  }

  const candle = parseGeckoTerminalOhlcvCandles(await candlesResponse.json())
    .filter(row => row.startSec + 59 <= targetSec)
    .sort((a, b) => b.startSec - a.startSec)[0];
  if (!candle) throw new Error('solana-token-mcap: no boundary ohlcv candle available');

  return {
    source: GECKOTERMINAL_VERIFY_SOURCE,
    network: normalizedNetwork,
    tokenAddress: normalizedToken,
    poolAddress: pool.address,
    poolReserveUsd: pool.reserveInUsd,
    priceUsd: candle.close,
    supply: supplyNumber,
    marketCap: candle.close * supplyNumber,
    candleStartAt: toIso(candle.startSec * 1000),
    capturedAt: toIso((candle.startSec + 60) * 1000),
    targetAt: toIso(targetSec * 1000),
  };
}

export function marketCapDivergenceBps(a, b) {
  const left = positiveNumber(a);
  const right = positiveNumber(b);
  if (!left || !right) return null;
  return Math.abs(left - right) / left * 10000;
}

export async function writeSolanaTokenMcapSnapshot(sql, {
  marketId,
  coinId,
  network = 'solana',
  tokenAddress,
  snapshot,
} = {}) {
  if (!sql?.query) throw new Error('solana-token-mcap: sql query client required');
  const normalizedCoinId = normalizeCoinId(coinId || snapshot?.coinId);
  const normalizedNetwork = normalizeNetwork(network);
  const normalizedToken = normalizeSolanaTokenAddress(tokenAddress);
  const marketCap = positiveNumber(snapshot?.marketCap);
  if (!marketCap) throw new Error('solana-token-mcap: snapshot market cap missing');
  const capturedAt = new Date(snapshot?.capturedAt || Date.now()).toISOString();
  await sql.query(`
    INSERT INTO points_token_mcap_snapshots (
      market_id, coin_id, network, token_address, source, market_cap_usd,
      price_usd, circulating_supply, total_supply, fdv_usd, captured_at,
      source_updated_at, raw
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13::jsonb
    )
    ON CONFLICT (market_id, source, captured_at) DO UPDATE SET
      market_cap_usd     = EXCLUDED.market_cap_usd,
      price_usd          = EXCLUDED.price_usd,
      circulating_supply = EXCLUDED.circulating_supply,
      total_supply       = EXCLUDED.total_supply,
      fdv_usd            = EXCLUDED.fdv_usd,
      source_updated_at  = EXCLUDED.source_updated_at,
      raw                = EXCLUDED.raw
  `, [
    Number(marketId),
    normalizedCoinId,
    normalizedNetwork,
    normalizedToken,
    snapshot.source || COINGECKO_MARKETS_SOURCE,
    marketCap,
    positiveNumber(snapshot.priceUsd),
    positiveNumber(snapshot.circulatingSupply),
    positiveNumber(snapshot.totalSupply),
    positiveNumber(snapshot.fdvUsd),
    capturedAt,
    snapshot.sourceUpdatedAt || null,
    JSON.stringify(snapshot.raw || {}),
  ]);
  return { ok: true, capturedAt, marketCap };
}

export async function readStoredSolanaTokenMcapSnapshot(sql, {
  marketId,
  coinId,
  tokenAddress,
  targetAt,
  toleranceSeconds = DEFAULT_SNAPSHOT_TOLERANCE_SECONDS,
} = {}) {
  if (!sql?.query) throw new Error('solana-token-mcap: sql query client required');
  const targetIso = toIso(parseTimestampMs(targetAt));
  const tolerance = Math.max(0, Math.floor(Number(toleranceSeconds) || 0));
  const result = await sql.query(`
    SELECT id, market_id, coin_id, network, token_address, source,
           market_cap_usd, price_usd, circulating_supply, total_supply,
           fdv_usd, captured_at, source_updated_at, raw
      FROM points_token_mcap_snapshots
     WHERE market_id = $1
       AND source = $2
       AND captured_at <= $3::timestamptz
       AND captured_at >= ($3::timestamptz - ($4::text)::interval)
       AND ($5::text IS NULL OR coin_id = $5)
       AND ($6::text IS NULL OR token_address = $6)
     ORDER BY captured_at DESC, id DESC
     LIMIT 1
  `, [
    Number(marketId),
    COINGECKO_MARKETS_SOURCE,
    targetIso,
    `${tolerance} seconds`,
    coinId ? normalizeCoinId(coinId) : null,
    tokenAddress ? normalizeSolanaTokenAddress(tokenAddress) : null,
  ]);
  const row = resolveRows(result)[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    marketId: Number(row.market_id),
    coinId: row.coin_id,
    network: row.network,
    tokenAddress: row.token_address,
    source: row.source,
    marketCap: Number(row.market_cap_usd),
    priceUsd: row.price_usd == null ? null : Number(row.price_usd),
    circulatingSupply: row.circulating_supply == null ? null : Number(row.circulating_supply),
    totalSupply: row.total_supply == null ? null : Number(row.total_supply),
    fdvUsd: row.fdv_usd == null ? null : Number(row.fdv_usd),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : row.captured_at,
    sourceUpdatedAt: row.source_updated_at instanceof Date ? row.source_updated_at.toISOString() : row.source_updated_at,
    raw: row.raw || {},
  };
}

export async function resolveSolanaTokenMcapOutcome({
  sql,
  marketId,
  resolverConfig,
  endTime,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cfg = resolverConfig || {};
  if (cfg.source !== COINGECKO_TOKEN_MCAP_SOURCE) {
    throw new Error(`solana-token-mcap: unsupported source ${cfg.source}`);
  }
  if (!cfg.op || cfg.threshold == null || cfg.yesOutcome == null) {
    throw new Error('solana-token-mcap: invalid resolver config');
  }
  const targetAt = cfg.closesAt || endTime;
  const coinId = normalizeCoinId(cfg.coinId);
  const tokenAddress = normalizeSolanaTokenAddress(cfg.tokenAddress);
  const network = normalizeNetwork(cfg.network || 'solana');
  const primary = await readStoredSolanaTokenMcapSnapshot(sql, {
    marketId,
    coinId,
    tokenAddress,
    targetAt,
    toleranceSeconds: cfg.snapshotToleranceSeconds ?? DEFAULT_SNAPSHOT_TOLERANCE_SECONDS,
  });
  if (!primary) {
    const err = new Error('solana_mcap_snapshot_not_ready');
    err.benign = true;
    err.info = { source: cfg.source, coinId, tokenAddress, targetAt };
    throw err;
  }

  let verification = null;
  if (cfg.geckoTerminalVerification !== false) {
    const supply = positiveNumber(primary.circulatingSupply)
      || positiveNumber(cfg.circulatingSupply)
      || positiveNumber(primary.totalSupply)
      || positiveNumber(cfg.totalSupply);
    if (!supply) {
      const err = new Error('solana_mcap_supply_missing_manual_review');
      err.benign = true;
      err.info = { source: cfg.source, coinId, tokenAddress, targetAt, snapshotCapturedAt: primary.capturedAt };
      throw err;
    }
    try {
      verification = await readGeckoTerminalBoundaryMcap({
        network,
        tokenAddress,
        targetAt,
        supply,
        fetchImpl,
      });
    } catch (cause) {
      const err = new Error('solana_mcap_verification_not_ready');
      err.benign = true;
      err.info = {
        source: cfg.source,
        coinId,
        tokenAddress,
        targetAt,
        reason: cause?.message?.slice(0, 180) || 'geckoterminal_failed',
      };
      throw err;
    }

    const divergenceBps = marketCapDivergenceBps(primary.marketCap, verification.marketCap);
    if (divergenceBps != null && divergenceBps >= Number(cfg.disputeBps ?? DEFAULT_DISPUTE_BPS)) {
      const err = new Error('solana_mcap_dispute_manual_review');
      err.benign = true;
      err.info = {
        source: cfg.source,
        coinId,
        tokenAddress,
        targetAt,
        primaryMarketCap: primary.marketCap,
        verificationMarketCap: verification.marketCap,
        divergenceBps: Math.round(divergenceBps),
        disputeBps: Number(cfg.disputeBps ?? DEFAULT_DISPUTE_BPS),
      };
      throw err;
    }
  }

  return {
    price: primary.marketCap,
    readerInfo: {
      coinId,
      tokenAddress,
      network,
      symbol: cfg.symbol || primary.raw?.symbol || null,
      snapshotCapturedAt: primary.capturedAt,
      sourceUpdatedAt: primary.sourceUpdatedAt,
      verificationSource: verification?.source || null,
      verificationMarketCap: verification?.marketCap || null,
      verificationPriceUsd: verification?.priceUsd || null,
      verificationPoolAddress: verification?.poolAddress || null,
      verificationCandleStartAt: verification?.candleStartAt || null,
    },
    resolverConfigPatch: {
      closeMarketCapUsd: primary.marketCap,
      closePriceUsd: primary.priceUsd,
      closeSnapshotAt: primary.capturedAt,
      closeSnapshotSource: primary.source,
      ...(verification ? {
        verificationMarketCapUsd: verification.marketCap,
        verificationPriceUsd: verification.priceUsd,
        verificationPoolAddress: verification.poolAddress,
        verificationCandleStartAt: verification.candleStartAt,
      } : {}),
    },
  };
}
