/**
 * Chainlink price-feed reader.
 *
 * Read-only helper that hits a public EVM RPC and calls
 * `latestRoundData()` on a Chainlink AggregatorV3 feed. No wallet
 * required — `eth_call` is free. Used by:
 *   - market-gen/crypto.js → pick a round strike from the current spot
 *     when proposing a new over/under market
 *   - cron/points-auto-resolve.js → settle markets whose resolver_type
 *     is 'chainlink_price' by comparing the feed's latest answer
 *     against the stored threshold
 *
 * Keeping the raw JSON-RPC path here (no ethers provider) so the
 * serverless bundle stays lean and we don't pull the full provider
 * machinery just to read five uint256 words.
 */

const AGGREGATOR_SELECTORS = {
  // keccak256("latestRoundData()").slice(0,8)
  latestRoundData: '0xfeaf968c',
  // keccak256("decimals()").slice(0,8)
  decimals: '0x313ce567',
};

const DEFAULT_RPCS = {
  // Arbitrum One — Chainlink publishes BTC/USD, ETH/USD, and several
  // stock + FX feeds here. Keyless public RPC.
  42161: 'https://arb1.arbitrum.io/rpc',
  // Arbitrum Sepolia — feeds are mock / non-market values.
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  // Ethereum mainnet fallback.
  1: 'https://eth.llamarpc.com',
};

function rpcFor(chainId) {
  const id = Number(chainId) || 42161;
  return process.env.CHAINLINK_RPC_URL
      || DEFAULT_RPCS[id]
      || DEFAULT_RPCS[42161];
}

async function ethCall(rpcUrl, to, data) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  };
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chainlink rpc: HTTP ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`chainlink rpc: ${json.error?.message || 'unknown'}`);
  return json?.result; // 0x-prefixed hex
}

// Parse a 32-byte hex word into a BigInt, interpreting as int256.
// Works for both unsigned (positive-only) and signed answers.
function parseInt256Word(hex32) {
  if (!hex32) return 0n;
  const clean = hex32.startsWith('0x') ? hex32.slice(2) : hex32;
  if (clean.length === 0) return 0n;
  const asBig = BigInt('0x' + clean);
  // Sign-extend if the top bit is set (2^255).
  const width = BigInt(clean.length * 4);
  const signBit = 1n << (width - 1n);
  return asBig >= signBit ? asBig - (1n << width) : asBig;
}

function parseUint8(hex) {
  if (!hex || hex === '0x') return 0;
  return Number(BigInt(hex));
}

/**
 * Read the latest price from a Chainlink AggregatorV3 feed.
 * Returns the value as a JS number with the feed's native decimals
 * (typically 8 for USD pairs) already applied — i.e. "1850.12", not "185012000000".
 */
export async function readChainlinkPrice({ feedAddress, chainId = 42161 }) {
  if (!feedAddress) throw new Error('chainlink: feedAddress required');
  const rpcUrl = rpcFor(chainId);

  const [decimalsHex, roundHex] = await Promise.all([
    ethCall(rpcUrl, feedAddress, AGGREGATOR_SELECTORS.decimals),
    ethCall(rpcUrl, feedAddress, AGGREGATOR_SELECTORS.latestRoundData),
  ]);

  const decimals = parseUint8(decimalsHex);
  // latestRoundData returns 5 × 32-byte words packed in a 0x-prefixed hex:
  //   [roundId, answer, startedAt, updatedAt, answeredInRound]
  // answer is the 2nd word, byte offset 32..64.
  const clean = (roundHex || '').startsWith('0x') ? roundHex.slice(2) : (roundHex || '');
  const answerHex = '0x' + clean.slice(64, 128); // second word
  const answer = parseInt256Word(answerHex);

  // Convert BigInt with decimals → JS number. For a feed with 8 decimals
  // and answer=18501200000000, this returns 1850.12. Uses string math
  // to avoid float precision loss on >2^53 values.
  const neg = answer < 0n;
  const abs = neg ? -answer : answer;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, 12);
  const joined = `${neg ? '-' : ''}${whole}.${fracStr}`;
  return Number(joined);
}

/**
 * Compare `price {op} threshold`. Returns true / false.
 */
export function comparePrice(price, op, threshold) {
  switch (op) {
    case 'gt':  return price >  threshold;
    case 'gte': return price >= threshold;
    case 'lt':  return price <  threshold;
    case 'lte': return price <= threshold;
    default: throw new Error(`chainlink: invalid op ${op}`);
  }
}

// ─── Known feeds ────────────────────────────────────────────────────────────
// Keys use UPPER_CASE_SNAKE symbols so generators can look them up cleanly.
// Arbitrum One addresses from https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum

export const FEEDS_ARBITRUM_ONE = {
  BTC_USD: { feedAddress: '0x6ce185860a4963106506C203335A2910413708e9', chainId: 42161, symbol: 'BTC/USD' },
  ETH_USD: { feedAddress: '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', chainId: 42161, symbol: 'ETH/USD' },
};
