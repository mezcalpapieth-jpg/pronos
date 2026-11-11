// Public, read-only Polymarket pilot. No signing, wallet, order or settlement calls.
// References: docs.polymarket.com/trading/fees and /api-reference/markets/get-clob-market-info.
import { POLYMARKET_BUILDER_PROFILE } from './polymarket-builder.js';

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const UNIT = 1_000_000n;
const MAX_AMOUNT = 1_000_000n * UNIT;
const MAX_LEVEL_SIZE = 1_000_000_000_000n * UNIT;
const TTL = 15_000;
const BUILDER_BPS = BigInt(POLYMARKET_BUILDER_PROFILE.takerFeeBps);
const MAX_LEVELS = 1000;
const MAX_RESPONSE_BYTES = 1_048_576;
const UINT256 = (1n << 256n) - 1n;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function decimal(value, name, { positive = false, max = MAX_LEVEL_SIZE } = {}) {
  const raw = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== 'string' || !/^(0|[1-9]\d{0,17})(\.\d{1,6})?$/.test(raw)) {
    fail('INVALID_DECIMAL', `${name} must be a finite unsigned decimal with at most six decimal places`);
  }
  const [whole, fraction = ''] = raw.split('.');
  const result = BigInt(whole) * UNIT + BigInt(fraction.padEnd(6, '0'));
  if (result > max || (positive && result === 0n)) fail('INVALID_DECIMAL', `${name} is outside supported bounds`);
  return result;
}

function format(value) {
  const sign = value < 0n ? '-' : '';
  const unsigned = value < 0n ? -value : value;
  const fraction = (unsigned % UNIT).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sign}${unsigned / UNIT}${fraction ? `.${fraction}` : ''}`;
}

const ceilDiv = (numerator, denominator) => (numerator + denominator - 1n) / denominator;
function clock(now) {
  const value = typeof now === 'function' ? now() : now;
  if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_TIME', 'A valid millisecond clock is required');
  return value;
}

function marketId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,19}$/.test(value)) fail('INVALID_MARKET', 'A numeric Gamma market id is required');
  return value;
}

function conditionId(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail('INVALID_CONDITION', 'A complete condition id is required');
  return value.toLowerCase();
}

function tokenId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,77}$/.test(value) || BigInt(value) > UINT256) fail('INVALID_TOKEN', 'A uint256 decimal token id is required');
  return value;
}

function list(value, name) {
  let parsed = value;
  if (typeof value === 'string' && value.length <= 20_000) {
    try { parsed = JSON.parse(value); } catch { fail('INVALID_MARKET', `${name} is malformed`); }
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) fail('UNSUPPORTED_MARKET', `${name} must contain exactly two outcomes`);
  return parsed;
}

function text(value, max = 16_000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function normalizePolymarketMarket(raw, { sportsEvent = false } = {}) {
  if (!raw || typeof raw !== 'object') fail('INVALID_MARKET', 'Missing Gamma market');
  if (raw.version !== 'v1' && raw.version !== 'v2') fail('UNSUPPORTED_VERSION', 'Explicit market version v1 or v2 is required');
  // Both fields may legitimately coexist. Never substitute the other version's identifiers.
  const ids = list(raw.version === 'v1' ? raw.clobTokenIds : raw.positionIds, raw.version === 'v1' ? 'clobTokenIds' : 'positionIds').map(tokenId);
  const labels = list(raw.outcomes, 'outcomes');
  if (ids[0] === ids[1] || labels.some((v) => typeof v !== 'string' || !v.trim() || v.length > 200) || labels[0] === labels[1]) {
    fail('INVALID_MARKET', 'Outcome labels and identifiers must be distinct');
  }
  const sportsMarketType = text(raw.sportsMarketType, 100);
  const sports = sportsEvent || !!sportsMarketType || text(raw.category).toLowerCase() === 'sports'
    || (Array.isArray(raw.tags) && raw.tags.some((tag) => tag && (String(tag.id) === '1' || tag.slug === 'sports')));
  if (!sports) fail('UNSUPPORTED_MARKET', 'Only identified sports markets are supported');
  if (raw.active !== true || raw.closed !== false || raw.archived === true || raw.acceptingOrders !== true || raw.enableOrderBook !== true) {
    fail('MARKET_NOT_TRADING', 'This sports market is not explicitly open and accepting order-book trades');
  }
  const title = text(raw.question, 500);
  if (!title) fail('INVALID_MARKET', 'A market title is required');
  const description = text(raw.description);
  return {
    id: marketId(String(raw.id)), title, description, rules: text(raw.rules) || description,
    resolutionSource: text(raw.resolutionSource, 2000), endDate: text(raw.endDate, 100),
    version: raw.version, conditionId: conditionId(raw.conditionId),
    outcomes: labels.map((label, i) => ({ label, tokenId: ids[i] })),
    active: true, closed: false, acceptingOrders: true, enableOrderBook: true,
    sportsMarketType, negRisk: raw.negRisk === true, restricted: raw.restricted === true,
    accessEligibility: 'unverified',
  };
}

async function getJson(fetchImpl, url) {
  if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE', 'Public market data is unavailable');
  const parsed = new URL(url);
  if (![GAMMA, CLOB].includes(parsed.origin)) fail('INVALID_HOST', 'Only official Polymarket hosts are allowed');
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(8000),
    });
  } catch { fail('UPSTREAM_UNAVAILABLE', 'Polymarket public data request failed'); }
  if (!response?.ok) fail('UPSTREAM_UNAVAILABLE', `Polymarket public data returned HTTP ${response?.status || 'error'}`);
  const announcedSize = Number(response.headers?.get?.('content-length') || 0);
  if (announcedSize > MAX_RESPONSE_BYTES) fail('UPSTREAM_TOO_LARGE', 'Polymarket response exceeds the one-megabyte pilot bound');
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let body = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          fail('UPSTREAM_TOO_LARGE', 'Polymarket response exceeds the one-megabyte pilot bound');
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      return JSON.parse(body);
    }
    // Minimal injected fetch mocks may expose json() only; real Fetch responses use the bounded reader.
    const parsed = await response.json();
    if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_RESPONSE_BYTES) fail('UPSTREAM_TOO_LARGE', 'Polymarket response exceeds the one-megabyte pilot bound');
    return parsed;
  } catch (error) {
    if (error.code) throw error;
    fail('UPSTREAM_MALFORMED', 'Polymarket returned malformed JSON');
  }
}

export async function discoverSportsMarkets({ fetchImpl = globalThis.fetch, now = Date.now, limit = 5 } = {}) {
  const current = clock(now);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) fail('INVALID_LIMIT', 'Discovery limit must be between one and five');
  // Full event objects can recursively include megabytes of related markets. Query a bounded
  // market list directly, with documented date/tag filters, and validate every row locally.
  const params = new URLSearchParams({
    closed: 'false', tag_id: '1', include_tag: 'true', limit: '20', order: 'volume24hr', ascending: 'false',
    end_date_min: new Date(current).toISOString(), end_date_max: new Date(current + 7 * 86_400_000).toISOString(),
  });
  const markets = await getJson(fetchImpl, `${GAMMA}/markets?${params}`);
  if (!Array.isArray(markets) || markets.length > 20) fail('UPSTREAM_MALFORMED', 'Invalid bounded sports markets response');
  const found = [];
  const seen = new Set();
  for (const raw of markets) {
    try {
      const market = normalizePolymarketMarket(raw);
      if (seen.has(market.id)) continue;
      seen.add(market.id);
      found.push(market);
      if (found.length === limit) return found;
    } catch (error) {
      if (!error.code) throw error;
    }
  }
  if (!found.length) fail('NO_SUPPORTED_MARKETS', 'No explicitly supported active binary sports markets were found in this bounded sample');
  return found;
}

function feeConfig(raw) {
  const fd = raw?.fd;
  if (!fd || typeof fd !== 'object') fail('UNSUPPORTED_FEES', 'Explicit live fee-curve parameters are required');
  const rate = decimal(fd.r, 'fee rate', { max: UNIT });
  if (fd.e !== 1 || fd.to !== true) fail('UNSUPPORTED_FEES', 'This pilot supports only exponent-one, taker-only fee curves, including explicit zero rate');
  return { rate: format(rate), exponent: 1, takerOnly: true };
}

function timestamp(value) {
  // The public book endpoint uses epoch milliseconds. Do not guess seconds or ISO formats.
  if (typeof value !== 'string' || !/^\d{13}$/.test(value)) fail('INVALID_BOOK_TIME', 'The book must include an epoch-millisecond timestamp');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) fail('INVALID_BOOK_TIME', 'Invalid book timestamp');
  return result;
}

function validateBook(raw, market, selectedToken, capturedAt, expectedTick, expectedMinimum) {
  if (!raw || conditionId(raw.market) !== market.conditionId || tokenId(raw.asset_id) !== selectedToken) {
    fail('BOOK_ID_MISMATCH', 'Order book condition or token does not match the selected market');
  }
  if ((market.version === 'v2' && raw.version !== 'v2') || (market.version === 'v1' && raw.version != null && raw.version !== 'v1')) {
    fail('BOOK_ID_MISMATCH', 'Book version differs from the explicitly selected market version');
  }
  const bookTimestampMs = timestamp(raw.timestamp);
  if (bookTimestampMs > capturedAt || capturedAt - bookTimestampMs > TTL) fail('STALE_BOOK', 'The public order book is older than fifteen seconds or future-dated');
  const tick = decimal(raw.tick_size, 'book tick', { positive: true, max: UNIT - 1n });
  const minimum = decimal(raw.min_order_size, 'minimum order size', { positive: true, max: MAX_AMOUNT });
  if (tick !== expectedTick || minimum !== expectedMinimum) fail('BOOK_PARAMETERS_CHANGED', 'Book tick or minimum differs from the live market details; refresh required');
  if (typeof raw.neg_risk !== 'boolean' || raw.neg_risk !== market.negRisk) fail('BOOK_ID_MISMATCH', 'Book negative-risk setting differs from market metadata');
  function side(levels, descending) {
    if (!Array.isArray(levels) || !levels.length || levels.length > MAX_LEVELS) fail('INVALID_DEPTH', 'A two-sided book with at most 1,000 levels per side is required');
    const seen = new Set();
    const result = levels.map((level) => {
      const price = decimal(level?.price, 'level price', { positive: true, max: UNIT - 1n });
      const size = decimal(level?.size, 'level size', { positive: true });
      if (price % tick !== 0n || seen.has(price.toString())) fail('INVALID_DEPTH', 'Book prices must be unique and aligned with the current tick');
      seen.add(price.toString());
      return { price, size };
    });
    result.sort((a, b) => a.price === b.price ? 0 : (a.price > b.price ? 1 : -1) * (descending ? -1 : 1));
    return result;
  }
  const bids = side(raw.bids, true);
  const asks = side(raw.asks, false);
  if (bids[0].price >= asks[0].price) fail('CROSSED_BOOK', 'Crossed or locked books are not supported');
  const serialize = (levels) => levels.map(({ price, size }) => ({ price: format(price), size: format(size) }));
  return { book: { bids: serialize(bids), asks: serialize(asks) }, bookTimestamp: new Date(bookTimestampMs).toISOString(), bookTimestampMs };
}

export async function loadPolymarketSnapshot({ marketId: requestedId, outcomeIndex = 0, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const startedAtMs = clock(now);
  const id = marketId(requestedId);
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0 || outcomeIndex > 1) fail('INVALID_OUTCOME', 'Binary outcome index must be zero or one');
  const raw = await getJson(fetchImpl, `${GAMMA}/markets/${id}`);
  const market = normalizePolymarketMarket(raw);
  if (market.id !== id) fail('MARKET_ID_MISMATCH', 'Gamma returned a different market id');
  const details = await getJson(fetchImpl, `${CLOB}/clob-markets/${market.conditionId}`);
  if (conditionId(details?.c) !== market.conditionId || details?.v !== market.version) fail('MARKET_ID_MISMATCH', 'CLOB condition or version differs from Gamma metadata');
  if (details.ao !== true) fail('MARKET_NOT_TRADING', 'The live CLOB market is not accepting orders');
  if (!Array.isArray(details.t) || details.t.length !== 2) fail('MARKET_ID_MISMATCH', 'The CLOB market must identify both binary outcomes');
  const liveTokens = details.t.map((entry) => tokenId(entry?.t));
  if (new Set(liveTokens).size !== 2 || market.outcomes.some(({ tokenId: id }) => !liveTokens.includes(id))) fail('MARKET_ID_MISMATCH', 'Gamma tokens do not belong to this CLOB market');
  if (market.outcomes.some((outcome) => details.t.find((entry) => entry.t === outcome.tokenId)?.o !== outcome.label)) fail('MARKET_ID_MISMATCH', 'Outcome labels differ between Gamma and CLOB');
  const fee = feeConfig(details);
  const tick = decimal(details.mts, 'market tick', { positive: true, max: UNIT - 1n });
  const minimum = decimal(details.mos, 'market minimum', { positive: true, max: MAX_AMOUNT });
  const selectedToken = market.outcomes[outcomeIndex].tokenId;
  const bookRaw = await getJson(fetchImpl, `${CLOB}/book?token_id=${selectedToken}`);
  const capturedAtMs = clock(now);
  if (capturedAtMs < startedAtMs || capturedAtMs - startedAtMs > TTL) fail('STALE_SNAPSHOT', 'Public market capture exceeded fifteen seconds; refresh required');
  const validated = validateBook(bookRaw, market, selectedToken, capturedAtMs, tick, minimum);
  return {
    market, outcomeIndex, tokenId: selectedToken, book: validated.book, fee,
    minOrderSize: format(minimum), tickSize: format(tick),
    capturedAt: new Date(capturedAtMs).toISOString(), bookTimestamp: validated.bookTimestamp,
    expiresAt: new Date(Math.min(capturedAtMs + TTL, validated.bookTimestampMs + TTL)).toISOString(),
  };
}

function levelCost(quantity, price, rate, side) {
  const product = quantity * price;
  const gross = side === 'buy' ? ceilDiv(product, UNIT) : product / UNIT;
  // Curve is C*r*p*(1-p). Ceil fees at five decimal cash places as an indicative upper estimate.
  // Displayed price levels can aggregate multiple makers: this is not an executable fee guarantee.
  const venue = ceilDiv(quantity * rate * price * (UNIT - price), UNIT ** 3n * 10n) * 10n;
  const builder = ceilDiv(gross * BUILDER_BPS, 10_000n);
  return { gross, venue, builder, cash: side === 'buy' ? gross + venue + builder : gross - venue - builder };
}

export function quotePolymarket({ snapshot, side, amount, now = Date.now } = {}) {
  if (side !== 'buy' && side !== 'sell') fail('INVALID_SIDE', 'Quote side must be buy or sell');
  const requested = decimal(amount, 'amount', { positive: true, max: MAX_AMOUNT });
  if (!snapshot?.market) fail('INVALID_SNAPSHOT', 'A validated public snapshot is required');
  const market = snapshot.market;
  const captured = Date.parse(snapshot.capturedAt);
  const bookTime = Date.parse(snapshot.bookTimestamp);
  const expires = Date.parse(snapshot.expiresAt);
  const current = clock(now);
  if (![captured, bookTime, expires].every(Number.isSafeInteger) || captured > current || bookTime > captured
    || expires > Math.min(captured + TTL, bookTime + TTL) || expires < captured || current >= expires) {
    fail('STALE_QUOTE', 'The captured book or quote receipt has expired; refresh required');
  }
  if (!Number.isInteger(snapshot.outcomeIndex) || snapshot.outcomeIndex < 0 || snapshot.outcomeIndex > 1
    || market.outcomes?.[snapshot.outcomeIndex]?.tokenId !== snapshot.tokenId) fail('BOOK_ID_MISMATCH', 'Snapshot token does not match its binary outcome');
  const rate = decimal(snapshot.fee?.rate, 'fee rate', { max: UNIT });
  if (snapshot.fee?.exponent !== 1 || snapshot.fee?.takerOnly !== true) fail('UNSUPPORTED_FEES', 'Unsupported snapshot fee parameters');
  const minimum = decimal(snapshot.minOrderSize, 'minimum order size', { positive: true, max: MAX_AMOUNT });
  const tick = decimal(snapshot.tickSize, 'tick size', { positive: true, max: UNIT - 1n });
  // Revalidate the serializable snapshot; never trust a client-supplied quote object.
  const validated = validateBook({
    ...snapshot.book, market: market.conditionId, asset_id: snapshot.tokenId, version: market.version,
    timestamp: String(bookTime), tick_size: snapshot.tickSize, min_order_size: snapshot.minOrderSize, neg_risk: market.negRisk,
  }, market, snapshot.tokenId, captured, tick, minimum);
  const levels = validated.book[side === 'buy' ? 'asks' : 'bids'];
  let remaining = requested;
  let shares = 0n;
  let gross = 0n;
  let venue = 0n;
  let builder = 0n;
  let cash = 0n;
  let exhaustedBudget = false;
  let touched = 0;
  for (const level of levels) {
    const price = decimal(level.price, 'price');
    const available = decimal(level.size, 'size');
    let quantity = available;
    if (side === 'sell') quantity = quantity < remaining ? quantity : remaining;
    else if (levelCost(quantity, price, rate, side).cash > remaining) {
      let low = 0n;
      let high = quantity;
      while (low < high) {
        const middle = (low + high + 1n) / 2n;
        if (levelCost(middle, price, rate, side).cash <= remaining) low = middle;
        else high = middle - 1n;
      }
      quantity = low;
      exhaustedBudget = true;
    }
    if (!quantity) break;
    const cost = levelCost(quantity, price, rate, side);
    if (side === 'sell' && cost.cash < 0n) fail('FEES_EXCEED_PROCEEDS', 'Fees exceed proceeds at the requested precision');
    shares += quantity;
    gross += cost.gross;
    venue += cost.venue;
    builder += cost.builder;
    cash += cost.cash;
    remaining -= side === 'buy' ? cost.cash : quantity;
    touched += 1;
    if (!remaining || exhaustedBudget) break;
  }
  let status = remaining === 0n || (side === 'buy' && exhaustedBudget && shares > 0n) ? 'filled' : (shares ? 'partial' : 'insufficient_depth');
  const belowMinimum = shares > 0n && shares < minimum;
  const depthLimited = remaining > 0n && !exhaustedBudget;
  if (belowMinimum) status = 'below_minimum';
  const warnings = [
    'Indicative read-only simulation; displayed liquidity and actual per-fill fees can change before execution.',
    `Pronos target fee simulation: ${POLYMARKET_BUILDER_PROFILE.takerFeeBps} bps taker; this is not a verified effective fee or credited revenue. No fee collection or builder credit has been verified.`,
    'Venue fee rounded upward per displayed price level to five cash decimals; maker segmentation and execution size rules require reconciliation before trading.',
  ];
  if (depthLimited) warnings.push('Displayed depth does not cover the requested amount.');
  if (belowMinimum) warnings.push('Simulated shares are below the venue minimum order size.');
  if (market.restricted) warnings.push('access_eligibility_unverified: this market is marked restricted; public data does not establish trading eligibility.');
  return {
    marketId: market.id, outcomeIndex: snapshot.outcomeIndex, side, amount: format(requested),
    grossNotional: format(gross), venueFee: format(venue), pronosFee: format(builder),
    totalSpend: side === 'buy' ? format(cash) : null,
    netProceeds: side === 'sell' ? format(cash) : null,
    filledShares: format(shares), remainingAmount: format(remaining),
    coveragePct: Number((requested - remaining) * 1_000_000n / requested) / 10_000,
    status, capturedAt: snapshot.capturedAt, bookTimestamp: snapshot.bookTimestamp, expiresAt: snapshot.expiresAt,
    depthLimited, minimumMet: shares >= minimum, budgetLimited: side === 'buy' && exhaustedBudget,
    minOrderSize: snapshot.minOrderSize, tickSize: snapshot.tickSize, levelsTouched: touched,
    fee: snapshot.fee, builderCode: POLYMARKET_BUILDER_PROFILE.code,
    builderFeeBps: Number(BUILDER_BPS), builderFeeStatus: 'target_unverified',
    restricted: market.restricted === true, accessEligibility: 'unverified',
    roundingPolicy: 'conservative_per_displayed_level', executable: false, warnings,
  };
}
