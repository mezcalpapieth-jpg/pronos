import { createHash } from 'node:crypto';
import { POLYMARKET_BUILDER_PROFILE } from './polymarket-builder.js';
import { discoverSportsMarkets, loadPolymarketSnapshot } from './polymarket-distribution.js';
import { BOOK_TTL_MS, HIP4_BUILDER_BPS, HIP4_VENUE_BPS, checkoutError } from './mxn-checkout-quote.js';

const HYPERCORE = 'https://api.hyperliquid.xyz/info';
const BITSO = 'https://api.bitso.com/v3/ticker/?book=usd_mxn';
const BUILDER_FEES = `https://clob.polymarket.com/fees/builder-fees/${POLYMARKET_BUILDER_PROFILE.code}`;
const TEMPLATE = 'sportsContestWinner';
const DESCRIPTION_HASH = '2eda772db5fb4795994d8a68f748cd237b2e299e882717d03e464753ad1b8b36';
const SIDES = ['{shortNameA}', '{shortNameB}'];
const FIELDS = [
  'competition', 'contestType', 'countedPlay', 'officialSource', 'participantA', 'participantB',
  'resolutionDeadline', 'scheduledStart', 'season', 'shortNameA', 'shortNameB', 'sport', 'stage',
];
const MAX_RESPONSE = 1_048_576;

async function publicJson(fetchImpl, url, body) {
  const options = { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(4500) };
  if (body) Object.assign(options, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await fetchImpl(url, options);
  if (!response.ok) throw checkoutError('market_data_unavailable');
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE || !response.body) {
    throw checkoutError('market_data_unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let json = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE) {
      await reader.cancel();
      throw checkoutError('market_data_unavailable');
    }
    json += decoder.decode(value, { stream: true });
  }
  return JSON.parse(json + decoder.decode());
}

function utcMinute(value) {
  const match = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso ? iso : null;
}

function hip4Market(row, nowMs) {
  if (!Number.isSafeInteger(row?.outcome) || row.outcome < 1 || row.outcome > 99_999_999
    || row.name !== `template:${TEMPLATE}` || row.quoteToken !== 'USDC' || row.venue !== 'out'
    || row.sideSpecs?.length !== 2 || !SIDES.every((side, i) => row.sideSpecs[i]?.name === `template:${side}`)
    || typeof row.description !== 'string' || row.description.length > 2000) return null;
  const entries = row.description.split('|');
  if (entries.length !== FIELDS.length) return null;
  const fields = {};
  for (const [index, field] of FIELDS.entries()) {
    const prefix = `${field}:`;
    const value = entries[index].slice(prefix.length);
    if (!entries[index].startsWith(prefix) || !value || value !== value.trim()
      || value.length > 100 || /[{}\u0000-\u001f\u007f]/.test(value)) return null;
    fields[field] = value;
  }
  const kickoff = utcMinute(fields.scheduledStart);
  const deadline = utcMinute(fields.resolutionDeadline);
  if (fields.competition !== 'NBA' || fields.sport !== 'Basketball' || fields.contestType !== 'Game'
    || fields.countedPlay !== 'the full game including overtime'
    || fields.officialSource !== 'National Basketball Association (NBA)'
    || fields.participantA.toLowerCase() === fields.participantB.toLowerCase()
    || fields.shortNameA === fields.shortNameB
    || ![fields.shortNameA, fields.shortNameB].every(name => /^[A-Z0-9]{2,10}$/.test(name))
    || !kickoff || !deadline || deadline <= kickoff || Date.parse(kickoff) <= nowMs) return null;
  return {
    venue: 'hip4', id: String(row.outcome), title: `${fields.participantA} vs. ${fields.participantB}`,
    outcomes: [fields.participantA, fields.participantB].map((label, index) => ({ index, label })),
    kickoff, cancellationDeadline: deadline, cancellationPayoutPerShare: '0.50',
    collateral: 'USDC', network: 'HyperCore',
    sourceUrl: 'https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets',
  };
}

function hip4Markets(meta, templates, nowMs) {
  if (!Array.isArray(meta?.outcomes) || !Array.isArray(meta.questions) || !Array.isArray(templates)) {
    throw checkoutError('market_data_unavailable');
  }
  const reviewed = templates.filter(template => template?.id === TEMPLATE);
  const description = reviewed[0]?.description;
  const sides = reviewed[0]?.role?.standaloneOutcome?.sideNames;
  if (reviewed.length !== 1 || typeof description !== 'string' || description.length > 4000
    || sides?.length !== 2 || !SIDES.every((side, index) => sides[index] === side)
    || createHash('sha256').update(description).digest('hex') !== DESCRIPTION_HASH) {
    throw checkoutError('unsupported_cancellation');
  }
  const grouped = new Set();
  for (const question of meta.questions) {
    const { fallbackOutcome, namedOutcomes, settledNamedOutcomes } = question ?? {};
    if (!Number.isSafeInteger(fallbackOutcome) || !Array.isArray(namedOutcomes) || !Array.isArray(settledNamedOutcomes)
      || !namedOutcomes.every(Number.isSafeInteger) || !settledNamedOutcomes.every(Number.isSafeInteger)) {
      throw checkoutError('market_data_unavailable');
    }
    for (const member of [fallbackOutcome, ...namedOutcomes, ...settledNamedOutcomes]) grouped.add(member);
  }
  const outcomes = new Map();
  for (const row of meta.outcomes) {
    outcomes.set(row?.outcome, outcomes.has(row?.outcome) ? null : row);
  }
  return [...outcomes.entries()].filter(([id]) => !grouped.has(id))
    .map(([, row]) => hip4Market(row, nowMs)).filter(Boolean)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id));
}

function polyMarket(market, nowMs) {
  const rawTime = market.gameStartTime || market.endDate;
  const time = Date.parse(rawTime);
  if (!Number.isFinite(time) || time <= nowMs) return null;
  return {
    venue: 'polymarket', id: market.id, title: market.title,
    outcomes: market.outcomes.map(({ label }, index) => ({ index, label })),
    kickoff: new Date(time).toISOString(), cancellationDeadline: market.cancellationDeadline,
    cancellationPayoutPerShare: market.cancellationPayoutPerShare,
    collateral: 'pUSD', network: 'Polygon',
    sourceUrl: /^[a-z0-9-]+$/.test(market.slug) ? `https://polymarket.com/event/${market.slug}` : market.resolutionSource,
  };
}

export function checkoutData({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const get = (url, body) => publicJson(fetchImpl, url, body);
  const info = (type, fields) => get(HYPERCORE, { type, ...fields });
  async function listHip4() {
    const [meta, templates] = await Promise.all([info('outcomeMeta'), info('outcomeTemplates')]);
    return hip4Markets(meta, templates, now());
  }
  return {
    async markets() {
      const results = await Promise.allSettled([
        listHip4().then(markets => markets.slice(0, 5)),
        discoverSportsMarkets({ fetchImpl, now }).then(markets => markets.map(market => polyMarket(market, now())).filter(Boolean)),
      ]);
      return {
        markets: results.flatMap(result => result.status === 'fulfilled' ? result.value : []),
        unavailableVenues: ['hip4', 'polymarket'].filter((_, index) => results[index].status === 'rejected'),
      };
    },
    async snapshot({ venue, marketId, outcomeIndex }) {
      if (venue === 'hip4') {
        const markets = await listHip4();
        const market = markets.find(entry => entry.id === marketId);
        if (!market) throw checkoutError('market_not_trading');
        const coin = `#${marketId}${outcomeIndex}`;
        const book = await info('l2Book', { coin });
        if (book?.coin !== coin || !Number.isSafeInteger(book.time) || !Array.isArray(book.levels)
          || book.levels.length !== 2 || !book.levels.every(side => Array.isArray(side) && side.length <= 20)) {
          throw checkoutError('invalid_depth');
        }
        const [bids, asks] = book.levels.map(side => side.map(level => ({ price: level?.px, size: level?.sz })));
        return {
          market, bids, asks, bookTimeMs: book.time, expiresAtMs: Math.min(now() + BOOK_TTL_MS, Date.parse(market.kickoff)),
          minOrderSize: '1', builderFeeBps: HIP4_BUILDER_BPS, builderFeeStatus: 'scenario',
          venueFeeBps: HIP4_VENUE_BPS, venueFeeStatus: 'scenario',
        };
      }
      const [snapshot, fees] = await Promise.all([
        loadPolymarketSnapshot({ marketId, outcomeIndex, fetchImpl, now }),
        get(BUILDER_FEES),
      ]);
      const market = polyMarket(snapshot.market, now());
      if (!market) throw checkoutError('market_not_trading');
      if (fees?.code !== POLYMARKET_BUILDER_PROFILE.code || fees.enabled !== true
        || !Number.isInteger(fees.builder_taker_fee_rate_bps) || fees.builder_taker_fee_rate_bps < 0
        || fees.builder_taker_fee_rate_bps > 100) throw checkoutError('builder_rate_unavailable');
      return {
        market, ...snapshot.book, bookTimeMs: Date.parse(snapshot.bookTimestamp),
        expiresAtMs: Math.min(Date.parse(snapshot.expiresAt), Date.parse(market.kickoff)),
        minOrderSize: snapshot.minOrderSize, builderFeeBps: fees.builder_taker_fee_rate_bps, builderFeeStatus: 'public_effective',
        venueFeeRate: snapshot.fee.rate, venueFeeStatus: 'public_curve',
      };
    },
    async fx() {
      const ticker = await get(BITSO);
      if (ticker?.success !== true || ticker.payload?.book !== 'usd_mxn') throw checkoutError('invalid_fx');
      const { bid, ask, created_at: createdAt } = ticker.payload;
      const timeMs = Date.parse(createdAt);
      if (!Number.isSafeInteger(timeMs)) throw checkoutError('invalid_fx');
      return { bid, ask, timeMs };
    },
  };
}
