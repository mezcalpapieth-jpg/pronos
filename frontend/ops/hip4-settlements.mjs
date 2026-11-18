import { pathToFileURL } from 'node:url';
import { normalizeMxnCheckoutLedgerEvent } from '../api/_lib/mxn-checkout-ledger.js';

const ENDPOINTS = {
  testnet: 'https://api.hyperliquid-testnet.xyz/info',
  mainnet: 'https://api.hyperliquid.xyz/info',
};
const SCALE = 10n ** 18n;
const MAX_PROVIDER_ROWS = 2_000;
const MAX_LEDGER_ROWS = 500;

function decimalUnits(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,37})(\.\d{1,18})?$/.test(value)) {
    throw new Error('invalid_settlement_decimal');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, '0'));
}

function payoutAmount(fill) {
  const price = decimalUnits(fill.px);
  const shares = decimalUnits(fill.sz);
  const fee = decimalUnits(fill.fee);
  const net = price * shares - fee * SCALE;
  if (price > SCALE || shares === 0n || net < 0n || net % SCALE !== 0n) {
    throw new Error('invalid_settlement_payout');
  }
  const units = net / SCALE;
  const fraction = String(units % SCALE).padStart(18, '0').replace(/0+$/, '');
  return `${units / SCALE}${fraction ? `.${fraction}` : ''}`;
}

export async function readHip4SettlementReceipts({ environment, wallet, accountId, startTime, endTime }, fetchImpl = fetch) {
  if (!Object.hasOwn(ENDPOINTS, environment)
    || typeof wallet !== 'string' || !/^0x[0-9a-f]{40}$/i.test(wallet)
    || typeof accountId !== 'string' || !/^[a-zA-Z0-9._:/#-]{1,200}$/.test(accountId)
    || !Number.isSafeInteger(startTime) || !Number.isSafeInteger(endTime)
    || startTime <= 0 || startTime > endTime || !Number.isFinite(new Date(endTime).getTime())) {
    throw new Error('invalid_settlement_query');
  }
  const user = wallet.toLowerCase();
  const res = await fetchImpl(ENDPOINTS[environment], {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'userFillsByTime', user, startTime, endTime, aggregateByTime: false }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error('hypercore_settlement_read_failed');
  const fills = await res.json();
  if (!Array.isArray(fills)) throw new Error('invalid_hypercore_fills');
  if (fills.length >= MAX_PROVIDER_ROWS) throw new Error('settlement_window_too_dense');

  const receipts = new Map();
  for (const fill of fills) {
    if (fill?.dir !== 'Settlement') continue;
    const encoding = typeof fill.coin === 'string' && /^#(?:[01]|[1-9]\d{0,7}[01])$/.test(fill.coin)
      ? Number(fill.coin.slice(1)) : null;
    if (encoding == null || fill.side !== 'A' || fill.feeToken !== 'USDC'
      || !Number.isSafeInteger(fill.time) || fill.time < startTime || fill.time > endTime
      || !Number.isSafeInteger(fill.tid) || fill.tid < 0) {
      throw new Error('invalid_hypercore_settlement');
    }
    // The provider's settlement fill is account evidence. Market resolution or a
    // balance change alone cannot identify the user's net settlement proceeds.
    const reference = `settlement:${user}:${fill.time}:${fill.coin}:${fill.tid}`;
    const receipt = normalizeMxnCheckoutLedgerEvent({
      environment, accountId, kind: 'settlement', status: 'confirmed', venue: 'hip4',
      asset: 'USDC', source: 'hypercore', reference, eventId: reference,
      occurredAt: new Date(fill.time).toISOString(), marketId: String(Math.floor(encoding / 10)), amount: payoutAmount(fill),
    });
    const previous = receipts.get(reference);
    if (previous && previous.amount !== receipt.amount) throw new Error('conflicting_hypercore_settlement');
    receipts.set(reference, receipt);
  }
  if (receipts.size > MAX_LEDGER_ROWS) throw new Error('settlement_window_too_dense');
  return [...receipts.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)
    || a.reference.localeCompare(b.reference));
}

function utcMillis(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const time = match ? Date.parse(value) : NaN;
  if (!Number.isFinite(time) || `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z` !== new Date(time).toISOString()) {
    throw new Error('invalid_settlement_window');
  }
  return time;
}

async function main(args) {
  const [environment, wallet, accountId, from, to] = args;
  if (args.length !== 5) {
    throw new Error('usage: node frontend/ops/hip4-settlements.mjs <testnet|mainnet> <wallet> <ledger-account-id> <from-utc> <to-utc>');
  }
  const records = await readHip4SettlementReceipts({
    environment, wallet, accountId, startTime: utcMillis(from), endTime: utcMillis(to),
  });
  for (const record of records) console.log(JSON.stringify(record));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const code = error?.code || error?.message;
    console.error(typeof code === 'string' && (/^[a-z0-9_]{1,100}$/i.test(code) || code.startsWith('usage:'))
      ? code : 'hip4_settlement_export_failed');
    process.exitCode = 1;
  }
}
