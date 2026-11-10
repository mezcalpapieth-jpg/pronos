import { ethers } from 'ethers';
import { isSepoliaGasDatabase, SEPOLIA_INCOMING_RESERVE_ADDRESS } from './sepolia-gas-config.js';

export const ACCOUNTING_CHAIN_ID = 421614;
const MAX_MARKETS = 40;
const GRACE_SECONDS = 30 * 86400;
const RECOVERY_LOG_WINDOW = 10000000;
const MAX_RECOVERY_WINDOWS = 8;
const addressType = ' view returns (address)';
const uintType = ' view returns (uint256)';
const factoryRoles = ['owner', 'resolver', 'marketCreator', 'treasury', 'liquidityReserve', 'emergencyReserve', 'feeCollector'];
const factoryAbi = [
  ...[...factoryRoles, 'collateral', 'feeVault'].map(role => 'function ' + role + '()' + addressType),
  'function marketCount()' + uintType,
];
const poolAbi = [
  ...['collateral', 'token', 'factory'].map(name => 'function ' + name + '()' + addressType),
  ...['totalFeesCollected', 'totalRecovered', 'totalRedeemed', 'resolvedAt', 'marketId', 'outcomeCount', 'outcome'].map(name => 'function ' + name + '()' + uintType),
  ...['canceled', 'resolved', 'disputed'].map(name => 'function ' + name + '() view returns (bool)'),
];
const sharesAbi = [
  'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
  'function totalSupply(uint256) view returns (uint256)',
];
export const transferEvents = new ethers.utils.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
export const poolMoneyEvents = new ethers.utils.Interface([
  'event LiquidityAdded(address indexed provider,uint256 amount)',
  'event DustRecovered(address indexed recipient,uint256 amount)',
  'event CancelRefunded(address indexed user,uint256 payout)',
  'event WinningsRedeemed(address indexed user,uint256 shares,uint256 payout)',
  'event WinningsRedeemed(address indexed user,uint8 indexed outcomeIndex,uint256 shares,uint256 payout)',
  'event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
  'event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
  'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
  'event SharesSold(address indexed seller,uint8 indexed outcomeIndex,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
]);
const optional = async (promise) => {
  try { return await promise; } catch { return null; }
};
const asUnits = value => BigInt(value.toString());
export const formatUnits = (value, decimals = 6) => value === null ? null : ethers.utils.formatUnits(value, decimals);
export const normalizeAddress = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value) && ethers.utils.isAddress(value)
  && value.toLowerCase() !== ethers.constants.AddressZero ? value.toLowerCase() : null;
export const isHash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
export const invalidAccountingQuery = () => Object.assign(new Error('invalid_accounting_query'), { status: 400 });

export function accountingSettings(env = process.env) {
  const enabled = env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'onchain-sepolia'
    && Number(env.ONCHAIN_CHAIN_ID) === ACCOUNTING_CHAIN_ID;
  const collateral = normalizeAddress(env.ONCHAIN_COLLATERAL_ADDRESS);
  const factories = new Map();
  for (const [key, version] of [
    ['ONCHAIN_MARKET_FACTORY_ADDRESS', 'v1'], ['ONCHAIN_MARKET_FACTORY_V2_ADDRESS', 'v2'],
    ['ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS', 'v1'], ['ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS', 'v2'],
  ]) {
    const address = normalizeAddress(env[key]);
    if (address && !factories.has(address)) factories.set(address, version);
  }
  const extraWallets = (env.ONCHAIN_ACCOUNTING_WALLETS || '').split(',').map(value => value.trim()).filter(Boolean);
  const explorerKey = env.ETHERSCAN_API_KEY || env.ETHERSCAN_API || env.ARBISCAN_API_KEY || null;
  return {
    enabled, configured: Boolean(enabled && collateral && factories.size && env.ONCHAIN_RPC_URL && isSepoliaGasDatabase(env.DATABASE_URL)),
    collateral, factories, extraWallets, explorerKey,
  };
}

export async function accountingContext({ sql, provider, settings, env = process.env, snapshotBlock, marketBefore = null }) {
  const { collateral, factories } = settings;
  if (Number((await provider.getNetwork()).chainId) !== ACCOUNTING_CHAIN_ID) throw new Error('accounting_wrong_chain');
  const block = await provider.getBlock(snapshotBlock ?? 'latest');
  if (!block) throw invalidAccountingQuery();
  const wallets = new Map();
  const warnings = [];
  function add(value, role, kind = 'wallet') {
    const address = normalizeAddress(value);
    if (!address) return;
    if (!wallets.has(address)) wallets.set(address, { address, roles: [], kind });
    const row = wallets.get(address);
    if (!row.roles.includes(role)) row.roles.push(role);
    if (kind === 'contract') row.kind = kind;
  }
  for (const [key, role, kind] of [
    ['ONCHAIN_DEPLOYER_ADDRESS', 'operations'], ['ONCHAIN_OWNER_ADDRESS', 'owner'],
    ['ONCHAIN_RESOLVER_ADDRESS', 'resolver'], ['ONCHAIN_GAS_FUNDER_ADDRESS', 'gasFunder'],
    ['ONCHAIN_TRADING_ROUTER_ADDRESS', 'router', 'contract'],
  ]) add(env[key], role, kind);
  add(SEPOLIA_INCOMING_RESERVE_ADDRESS, 'incomingReserve');
  for (const value of settings.extraWallets.slice(0, 32)) add(value, 'additional');
  if (settings.extraWallets.length > 32 || settings.extraWallets.some(value => !normalizeAddress(value))) warnings.push('additional_wallets_invalid');
  if (!normalizeAddress(env.ONCHAIN_GAS_FUNDER_ADDRESS)) warnings.push('gas_funder_missing');
  if (!normalizeAddress(env.ONCHAIN_DEPLOYER_ADDRESS)) warnings.push('operations_missing');

  const token = new ethers.Contract(collateral, [
    'function balanceOf(address)' + uintType, 'function decimals() view returns (uint8)', 'function symbol() view returns (string)',
  ], provider);
  const at = { blockTag: block.number };
  const [decimals, symbol, registry, factoryRows] = await Promise.all([
    token.decimals(at), token.symbol(at),
    optional(sql`SELECT id, market_id, question, pool_address, factory_address, tx_hash
      FROM protocol_markets WHERE chain_id = 421614 AND LOWER(factory_address) = ANY(${[...factories.keys()]}::text[])
      AND (${marketBefore}::int IS NULL OR id < ${marketBefore}::int)
      ORDER BY id DESC LIMIT ${MAX_MARKETS + 1}`),
    Promise.all([...factories].map(async ([address, version]) => {
      const factory = new ethers.Contract(address, factoryAbi, provider);
      const [factoryCollateral, count, ...roles] = await Promise.all(
        ['collateral', 'marketCount', ...factoryRoles, 'feeVault'].map(name => optional(factory[name](at))),
      );
      return { address, version, collateral: normalizeAddress(factoryCollateral), count: count?.toNumber() ?? null,
        roles: [...factoryRoles, 'feeVault'].map((role, i) => [role, roles[i]]) };
    })),
  ]);
  // MXNP uses the same six-decimal accounting units as the Points indexer.
  if (decimals !== 6) throw new Error('accounting_collateral_decimals');
  const pools = new Map();
  const page = registry?.slice(0, MAX_MARKETS) || [];
  const nextMarketBefore = registry?.length > MAX_MARKETS ? page.at(-1).id : null;
  const paged = marketBefore !== null || nextMarketBefore !== null;
  let factoryMarkets = 0;
  for (const factory of factoryRows) {
    if (!factory.collateral) {
      warnings.push('factory_unavailable');
      factoryMarkets = null;
      continue;
    }
    if (factory.collateral !== collateral) {
      warnings.push('other_collateral');
      continue;
    }
    add(factory.address, factory.version + 'Factory', 'contract');
    for (const [role, value] of factory.roles) add(value, role, role === 'feeVault' ? 'contract' : 'wallet');
    if (factory.roles.slice(0, -1).some(([, value]) => !normalizeAddress(value))) warnings.push('factory_roles_incomplete');
    factoryMarkets = factoryMarkets === null || factory.count === null ? null : factoryMarkets + factory.count;
    const rows = page.filter(row => normalizeAddress(row.factory_address) === factory.address);
    if (factory.count === null || (!paged && factory.count !== rows.length)) warnings.push('registry_incomplete');
    for (const row of rows) {
      const address = normalizeAddress(row.pool_address);
      if (!address || pools.has(address)) {
        warnings.push('registry_incomplete');
        continue;
      }
      pools.set(address, { address, factory: factory.address, version: factory.version, id: row.market_id,
        question: row.question, creationTx: isHash(row.tx_hash) ? row.tx_hash.toLowerCase() : null });
    }
  }
  if (!registry) warnings.push('registry_unavailable');
  if (paged) warnings.push('market_page');
  return { block, at, collateral, provider, sql, token, symbol, wallets, pools, warnings: [...new Set(warnings)],
    marketBefore, nextMarketBefore, factoryMarkets };
}

export function parseEvent(iface, log) {
  try { return iface.parseLog(log); } catch { return null; }
}

export function seedEvidence(receipt, market, collateral) {
  const seedLogs = receipt.logs.filter(log => log.address.toLowerCase() === market.address)
    .map(log => parseEvent(poolMoneyEvents, log)).filter(event => event?.name === 'LiquidityAdded');
  if (seedLogs.length !== 1 || normalizeAddress(seedLogs[0].args.provider) !== market.factory) return null;
  const amount = asUnits(seedLogs[0].args.amount);
  const transfers = receipt.logs.filter(log => log.address.toLowerCase() === collateral)
    .map(log => parseEvent(transferEvents, log)).filter(event => event?.name === 'Transfer' && asUnits(event.args.value) === amount);
  const seeds = transfers.filter(event => normalizeAddress(event.args.to) === market.factory);
  const poolLeg = transfers.some(event => normalizeAddress(event.args.from) === market.factory
    && normalizeAddress(event.args.to) === market.address);
  if (seeds.length !== 1 || !poolLeg) return null;
  return { amount, from: normalizeAddress(seeds[0].args.from) };
}

export function liquidityResult({ seed, ownedSeed, recovery, recoverable, closed }) {
  const realized = closed && ownedSeed && recovery !== null ? recovery - seed : null;
  const openDownside = !closed && ownedSeed && recoverable !== null && recovery !== null
    ? (seed > recoverable + recovery ? seed - recoverable - recovery : 0n) : null;
  return { realized, openDownside };
}

async function recoveryLogs(provider, address, fromBlock, toBlock) {
  if (toBlock - fromBlock + 1 > RECOVERY_LOG_WINDOW * MAX_RECOVERY_WINDOWS) throw new Error('accounting_recovery_range');
  const topics = [poolMoneyEvents.getEventTopic('DustRecovered')];
  const windows = [];
  for (let start = fromBlock; start <= toBlock; start += RECOVERY_LOG_WINDOW) {
    windows.push(provider.getLogs({ address, fromBlock: start, toBlock: Math.min(start + RECOVERY_LOG_WINDOW - 1, toBlock), topics }));
  }
  return (await Promise.all(windows)).flat().filter(log => !log.removed);
}

async function readPool(context, market) {
  const { at, block, collateral, provider, token, wallets } = context;
  const pool = new ethers.Contract(market.address, poolAbi, provider);
  const [poolCollateral, factory, marketId, creation, balance, fees, canceled, resolved, disputed, outcome, shareAddress, outcomeCount, payouts, eth] = await Promise.all([
    pool.collateral(at), pool.factory(at), pool.marketId(at), market.creationTx ? optional(provider.getTransactionReceipt(market.creationTx)) : null,
    token.balanceOf(market.address, at), pool.totalFeesCollected(at), pool.canceled(at), pool.resolved(at),
    optional(pool.disputed(at)), pool.outcome(at), pool.token(at), market.version === 'v2' ? pool.outcomeCount(at) : 2,
    optional(pool.totalRedeemed(at)), optional(provider.getBalance(market.address, block.number)),
  ]);
  if (normalizeAddress(poolCollateral) !== collateral || normalizeAddress(factory) !== market.factory || marketId.toNumber() !== market.id) {
    throw new Error('accounting_pool_mismatch');
  }
  const seed = creation?.status === 1 && creation.blockNumber <= block.number ? seedEvidence(creation, market, collateral) : null;
  const ownedSeed = Boolean(seed?.from && wallets.has(seed.from) && wallets.get(seed.from).kind === 'wallet');
  const count = Number(outcomeCount);
  const start = BigInt(market.id) * (market.version === 'v2' ? 256n : 2n);
  const winningIndex = Number(outcome) - (market.version === 'v2' ? 0 : 1);
  const shares = new ethers.Contract(shareAddress, sharesAbi, provider);
  const shareBalances = count >= 2 && count <= 8 && !canceled && disputed === false
    ? await optional(shares.balanceOfBatch(Array(count).fill(market.address),
      Array.from({ length: count }, (_, i) => start + BigInt(i)), at)) : null;
  const candidates = shareBalances?.map(asUnits);
  const recoverable = candidates
    ? (resolved ? candidates[winningIndex] ?? null : candidates.reduce((min, value) => value < min ? value : min))
    : null;
  const poolBalance = asUnits(balance);
  // An observed reserve cannot be called recoverable if the collateral fails
  // to cover even the pool's own position.
  const winningSupply = resolved && recoverable !== null && winningIndex >= 0
    ? await optional(shares.totalSupply(start + BigInt(winningIndex), at)) : null;
  const backing = winningSupply !== null && asUnits(winningSupply) >= recoverable ? asUnits(winningSupply) - recoverable : null;
  const supportedRecovery = recoverable !== null && recoverable + (backing ?? 0n) <= poolBalance ? recoverable : null;
  let recovery = null;
  let paidElsewhere = null;
  let recoveryEligible = false;
  if (!resolved && !canceled) {
    recovery = paidElsewhere = 0n;
  } else {
    const [resolvedAt, totalRecovered] = await Promise.all([
      resolved && !canceled && disputed === false ? optional(pool.resolvedAt(at)) : null,
      optional(pool.totalRecovered(at)),
    ]);
    recoveryEligible = Boolean(resolvedAt?.gt(0) && block.timestamp >= resolvedAt.toNumber() + GRACE_SECONDS);
    if (totalRecovered?.isZero()) {
      recovery = paidElsewhere = 0n;
    } else if (creation?.status === 1 && creation.blockNumber <= block.number) {
      const logs = await optional(recoveryLogs(provider, market.address, creation.blockNumber, block.number));
      if (logs) {
        const payouts = logs.map(log => parseEvent(poolMoneyEvents, log));
        if (payouts.every(event => event?.name === 'DustRecovered')) {
          recovery = paidElsewhere = 0n;
          for (const event of payouts) {
            const recipient = wallets.get(normalizeAddress(event.args.recipient));
            if (recipient?.kind === 'wallet' || recipient?.roles.includes('feeVault')) recovery += asUnits(event.args.amount);
            else paidElsewhere += asUnits(event.args.amount);
          }
          if (totalRecovered !== null && recovery + paidElsewhere !== asUnits(totalRecovered)) recovery = paidElsewhere = null;
        }
      }
    }
  }
  const closed = resolved && !canceled && disputed === false && recoveryEligible && supportedRecovery === 0n && recovery !== null;
  const { realized, openDownside } = liquidityResult({ seed: seed?.amount, ownedSeed, recovery, recoverable: supportedRecovery, closed });
  return {
    ...market, status: canceled ? 'canceled' : disputed ? 'disputed' : closed ? 'recovered' : resolved ? 'pending_recovery' : 'open',
    creationBlock: creation?.status === 1 && creation.blockNumber <= block.number ? creation.blockNumber : null,
    seed: seed?.amount ?? null, seedWallet: seed?.from ?? null, ownedSeed, poolBalance, fees: asUnits(fees),
    eth: eth === null ? null : asUnits(eth), winnerBacking: backing, winnerPayouts: payouts === null ? null : asUnits(payouts),
    recovery, paidElsewhere, recoverable: supportedRecovery, realized, openDownside,
  };
}

export async function accountingSummary(context, nativeHistory) {
  const { at, provider, token, wallets, pools, block, collateral, symbol, warnings } = context;
  const accounts = [...wallets.values()];
  const markets = [...pools.values()].slice(0, MAX_MARKETS);
  const walletRows = [];
  const marketRows = [];
  for (let i = 0; i < Math.max(accounts.length, markets.length); i += 6) {
    await Promise.all([
      ...accounts.slice(i, i + 6).map(async wallet => {
        const [mxnp, eth] = await Promise.all([
          optional(token.balanceOf(wallet.address, at)), optional(provider.getBalance(wallet.address, block.number)),
        ]);
        walletRows.push({ ...wallet, mxnp: mxnp === null ? null : asUnits(mxnp), eth: eth === null ? null : asUnits(eth) });
      }),
      ...markets.slice(i, i + 6).map(async market => {
        const row = await optional(readPool(context, market));
        marketRows.push(row ?? { ...market, status: 'unavailable', seed: null, seedWallet: null, ownedSeed: false,
          poolBalance: null, fees: null, eth: null, winnerBacking: null, winnerPayouts: null,
          recovery: null, paidElsewhere: null, recoverable: null, realized: null, openDownside: null });
      }),
    ]);
  }
  const total = (rows, key, decimals = 6) => {
    const known = rows.filter(row => row[key] != null);
    return { amount: formatUnits(known.reduce((sum, row) => sum + row[key], 0n), decimals), known: known.length, count: rows.length };
  };
  const operating = walletRows.filter(row => row.kind === 'wallet');
  const realizedMarkets = marketRows.filter(row => row.status === 'recovered');
  const gasFunders = operating.filter(row => row.roles.includes('gasFunder')).map(row => row.address);
  const grantTotals = gasFunders.length ? await optional(context.sql`
    SELECT COALESCE(SUM(amount_wei), 0)::text AS amount, COUNT(*)::int AS count
    FROM sepolia_gas_transfers WHERE chain_id = 421614 AND funder_address = ANY(${gasFunders}::text[])
      AND status = 'confirmed' AND confirmed_at <= ${new Date(block.timestamp * 1000).toISOString()}::timestamptz`) : null;
  const metrics = {
    walletMxnp: total(operating, 'mxnp'), walletEth: total(operating, 'eth', 18),
    fees: total(marketRows, 'fees'), poolBalance: total(marketRows, 'poolBalance'),
    winnerPayouts: total(marketRows, 'winnerPayouts'),
    seed: total(marketRows.filter(row => row.seed === null || row.ownedSeed), 'seed'),
    recovery: total(marketRows, 'recovery'), realized: total(realizedMarkets, 'realized'),
    openDownside: total(marketRows.filter(row => row.status !== 'recovered'), 'openDownside'),
  };
  // This figure combines gross commissions with realized liquidity results
  // only. Unrecovered positions and expenses in another asset stay separate.
  const contribution = realizedMarkets.reduce((sum, row) => sum + (row.realized ?? 0n), 0n);
  metrics.contribution = { ...metrics.fees,
    amount: formatUnits(marketRows.reduce((sum, row) => sum + (row.fees ?? 0n), contribution)),
    partial: warnings.some(warning => warning !== 'market_page')
      || marketRows.some(row => row.fees === null || !row.ownedSeed || row.recovery === null),
  };
  const formatted = row => Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, typeof value === 'bigint' ? formatUnits(value, key === 'eth' ? 18 : 6) : value]));
  return { chainId: ACCOUNTING_CHAIN_ID, readOnly: true, block: block.number, asOf: new Date(block.timestamp * 1000).toISOString(), collateral, symbol,
    nativeHistory, warnings, metrics, marketBefore: context.marketBefore, nextMarketBefore: context.nextMarketBefore,
    factoryMarkets: context.factoryMarkets, sponsoredGas: grantTotals
      ? { amount: formatUnits(asUnits(grantTotals[0].amount), 18), count: grantTotals[0].count } : null,
    wallets: walletRows.sort((a, b) => a.address.localeCompare(b.address)).map(formatted),
    markets: marketRows.sort((a, b) => a.factory.localeCompare(b.factory) || b.id - a.id).map(formatted) };
}
