import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { parseFixedUnits, formatFixedUnits, normalizeUsername } from './onchain-reset-plan.js';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';

export const TOURNAMENT_CHAIN_ID = 421614;
export const MINT_ABI = [
  'function owner() view returns(address)', 'function decimals() view returns(uint8)',
  'function totalSupply() view returns(uint256)', 'function balanceOf(address) view returns(uint256)',
  'function batchMint(address[],uint256[])',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
];
const ADDRESS_FIELDS = ['token', 'factoryV1', 'factoryV2', 'shareV1', 'shareV2', 'router', 'owner', 'operations'];
const fail = message => { throw new Error(message); };
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
export const planHash = plan => createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex');
export function address(value) {
  if (!ethers.utils.isAddress(value || '') || /^0x0{40}$/i.test(value)) fail('invalid_nonzero_address');
  return value.toLowerCase();
}

// Used before any SQL or chain write. Never fall back to the root .env file.
export function requireTournamentPreview({ env = process.env, branch, expectedHost }) {
  let host;
  try { host = new URL(env.DATABASE_URL).hostname; } catch { /* rejected below */ }
  if (branch !== 'onchain-sepolia' || !pendingApprovalSettings(env).previewEnabled
    || !isSepoliaGasDatabase(env.DATABASE_URL) || !expectedHost || host !== expectedHost
    || expectedHost.includes('-pooler.') || !env.ONCHAIN_RPC_URL) fail('tournament_preview_destination_required');
}

export function normalizeDeployment(input) {
  if (Number(input.chainId) !== TOURNAMENT_CHAIN_ID) fail('tournament_chain_mismatch');
  const out = { chainId: TOURNAMENT_CHAIN_ID };
  for (const field of ADDRESS_FIELDS) out[field] = address(input[field]);
  if (new Set(ADDRESS_FIELDS.slice(0, 6).map(k => out[k])).size !== 6) fail('deployment_addresses_must_be_distinct');
  if (!/^0x[\da-f]{64}$/i.test(input.routerCodeHash || '')) fail('router_code_hash_required');
  out.routerCodeHash = input.routerCodeHash.toLowerCase();
  return out;
}

// A sorted, immutable snapshot. Neither existing Points balances nor balances
// of the previous ERC20 determine the new cycle's opening allocation.
export function buildTournamentPlan({ deployment, previousDeployment, users, cycleId, label,
  startsAt, endsAt, allocation = '500', liquidityMxnp, maxTotalMxnp, batchSize = 50 }) {
  const next = normalizeDeployment(deployment);
  const previous = normalizeDeployment(previousDeployment);
  if (ADDRESS_FIELDS.slice(0, 6).some(k => Object.values(previous).includes(next[k]))) fail('fresh_deployment_required');
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(cycleId || '') || !String(label || '').trim()) fail('cycle_identity_required');
  const start = new Date(startsAt), end = new Date(endsAt);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) fail('invalid_cycle_window');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) fail('batch_size_out_of_range');
  const grant = BigInt(parseFixedUnits(allocation));
  const liquidity = BigInt(parseFixedUnits(liquidityMxnp));
  const cap = BigInt(parseFixedUnits(maxTotalMxnp));
  if (grant <= 0n || liquidity <= 0n || cap <= 0n) fail('positive_allocation_liquidity_and_cap_required');
  const usernames = new Set(), wallets = new Set(), suborgs = new Set(), skipped = [];
  const recipients = [];
  for (const row of users) {
    const username = normalizeUsername(row.username);
    if (!username || usernames.has(username)) fail('duplicate_or_empty_username');
    usernames.add(username);
    const wallet = row.wallet_address ? address(row.wallet_address) : null;
    const suborg = row.turnkey_sub_org_id ? String(row.turnkey_sub_org_id).trim() : null;
    if ((wallet && wallets.has(wallet)) || (suborg && suborgs.has(suborg))) fail('duplicate_wallet_or_suborg');
    if (wallet) wallets.add(wallet);
    if (suborg) suborgs.add(suborg);
    if (!wallet || !suborg) { skipped.push(username); continue; }
    if (wallet === next.operations || ADDRESS_FIELDS.slice(0, 6).some(k => next[k] === wallet)) fail('recipient_is_system_address');
    recipients.push({ username, wallet, suborg, units: grant.toString(), kind: 'user' });
  }
  if (!recipients.length) fail('no_eligible_wallets');
  recipients.sort((a, b) => a.username < b.username ? -1 : a.username > b.username ? 1 : 0);
  skipped.sort();
  const userUnits = grant * BigInt(recipients.length);
  const totalUnits = userUnits + liquidity;
  if (totalUnits > cap) fail('cycle_issuance_cap_exceeded');
  const funding = [...recipients, { username: null, wallet: next.operations, suborg: null,
    units: liquidity.toString(), kind: 'liquidity' }];
  const batches = [];
  for (let i = 0; i < funding.length; i += batchSize) {
    const entries = funding.slice(i, i + batchSize);
    batches.push({ index: batches.length, recipients: entries,
      units: entries.reduce((sum, r) => sum + BigInt(r.units), 0n).toString() });
  }
  return { version: 1, strategy: 'new_token_per_tournament', cycleId, label: String(label).trim(),
    startsAt: start.toISOString(), endsAt: end.toISOString(), deployment: next, previousDeployment: previous,
    allocationUnits: grant.toString(), liquidityUnits: liquidity.toString(), maxTotalUnits: cap.toString(),
    userCount: recipients.length, skipped, totalUnits: totalUnits.toString(), batches };
}

export function summarizeTournament(plan) {
  return { cycleId: plan.cycleId, planHash: planHash(plan), strategy: plan.strategy,
    token: plan.deployment.token, previousToken: plan.previousDeployment.token,
    users: plan.userCount, skipped: plan.skipped.length, batches: plan.batches.length,
    allocationMxnp: formatFixedUnits(plan.allocationUnits), liquidityMxnp: formatFixedUnits(plan.liquidityUnits),
    totalMxnp: formatFixedUnits(plan.totalUnits), capMxnp: formatFixedUnits(plan.maxTotalUnits),
    authorization: 'One owner-approved authorization for the new router per user; previous grants are not copied.',
    gas: 'Existing automatic, on-demand gas funding; no per-user ETH distribution.' };
}

export function validateTournamentPlan(plan) {
  const rows = plan.batches.flatMap(b => b.recipients).filter(r => r.kind === 'user')
    .map(r => ({ username: r.username, wallet_address: r.wallet, turnkey_sub_org_id: r.suborg }));
  rows.push(...plan.skipped.map(username => ({ username })));
  const rebuilt = buildTournamentPlan({ deployment: plan.deployment, previousDeployment: plan.previousDeployment,
    users: rows, cycleId: plan.cycleId, label: plan.label, startsAt: plan.startsAt, endsAt: plan.endsAt,
    allocation: formatFixedUnits(plan.allocationUnits), liquidityMxnp: formatFixedUnits(plan.liquidityUnits),
    maxTotalMxnp: formatFixedUnits(plan.maxTotalUnits), batchSize: plan.batches[0].recipients.length });
  if (planHash(rebuilt) !== planHash(plan)) fail('invalid_or_modified_tournament_plan');
  return plan;
}

// Verify every immutable binding and a zero supply before accepting a fresh
// deployment. Rechecked during resume to detect ownership or code changes.
export async function verifyTournamentDeployment(plan, { provider, expectedSupply = '0',
  contractAt = (a, abi) => new ethers.Contract(a, abi, provider) }) {
  const d = plan.deployment;
  if ((await provider.getNetwork()).chainId !== TOURNAMENT_CHAIN_ID) fail('rpc_chain_mismatch');
  for (const field of ADDRESS_FIELDS.slice(0, 6)) {
    const code = await provider.getCode(d[field]);
    if (code === '0x') fail(`contract_missing:${field}`);
    if (field === 'router' && ethers.utils.keccak256(code) !== d.routerCodeHash) fail('router_code_mismatch');
  }
  const token = contractAt(d.token, MINT_ABI);
  const [owner, decimals, supply] = await Promise.all([token.owner(), token.decimals(), token.totalSupply()]);
  if (address(owner) !== d.owner || Number(decimals) !== 6 || supply.toString() !== expectedSupply) fail('token_owner_decimals_or_supply_mismatch');
  const factoryABI = ['function collateral() view returns(address)', 'function token() view returns(address)',
    'function tradingRouter() view returns(address)', 'function marketCreator() view returns(address)',
    'function owner() view returns(address)', 'function marketCount() view returns(uint256)'];
  for (const version of ['V1', 'V2']) {
    const factory = contractAt(d[`factory${version}`], factoryABI);
    const [collateral, shares, router, creator, factoryOwner, count] = await Promise.all([
      factory.collateral(), factory.token(), factory.tradingRouter(), factory.marketCreator(), factory.owner(), factory.marketCount()]);
    if (address(collateral) !== d.token || address(shares) !== d[`share${version}`]
      || address(router) !== d.router || address(creator) !== d.operations || address(factoryOwner) !== d.owner
      || !ethers.BigNumber.from(count).isZero()) fail('factory_binding_or_activity_mismatch');
    const share = contractAt(shares, ['function owner() view returns(address)']);
    if (address(await share.owner()) !== d[`factory${version}`]) fail('share_owner_mismatch');
  }
  const router = contractAt(d.router, ['function VERSION() view returns(uint256)',
    ...['factoryV1', 'factoryV2', 'collateral', 'tokenV1', 'tokenV2'].map(k => `function ${k}() view returns(address)`) ]);
  const bindings = await Promise.all([router.factoryV1(), router.factoryV2(), router.collateral(), router.tokenV1(), router.tokenV2()]);
  if (Number(await router.VERSION()) !== 1 || bindings.map(address).join() !== [d.factoryV1, d.factoryV2, d.token, d.shareV1, d.shareV2].join()) fail('router_binding_mismatch');
}

// Configuration handoff only: never changes Vercel, the active cycle, policies,
// Points balances, or old pools. Keep the previous deployment for old claims.
export function tournamentRuntimeEnv(plan) {
  const d = plan.deployment;
  return { ONCHAIN_TOURNAMENT_CYCLE_ID: plan.cycleId, ONCHAIN_TOURNAMENT_MXNP_ADDRESS: d.token,
    ONCHAIN_COLLATERAL_ADDRESS: d.token, ONCHAIN_COLLATERAL_SYMBOL: 'MXNP',
    VITE_ONCHAIN_COLLATERAL_ADDRESS: d.token,
    ONCHAIN_OWNER_ADDRESS: d.owner, ONCHAIN_DEPLOYER_ADDRESS: d.operations,
    ONCHAIN_MARKET_FACTORY_ADDRESS: d.factoryV1, ONCHAIN_MARKET_FACTORY_V2_ADDRESS: d.factoryV2,
    ONCHAIN_SHARE_TOKEN_ADDRESS: d.shareV1, ONCHAIN_SHARE_TOKEN_V2_ADDRESS: d.shareV2,
    ONCHAIN_TRADING_ROUTER_ADDRESS: d.router, ONCHAIN_TRADING_ROUTER_CODE_HASH: d.routerCodeHash,
    FACTORY_ADDRESS: d.factoryV1, PRONOS_FACTORY_ADDRESS: d.factoryV1,
    FACTORY_V2_ADDRESS: d.factoryV2, PRONOS_FACTORY_V2_ADDRESS: d.factoryV2,
    VITE_PRONOS_ARB_SEPOLIA_FACTORY: d.factoryV1, VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2: d.factoryV2,
    VITE_PRONOS_ARB_SEPOLIA_TOKEN: d.shareV1, VITE_PRONOS_ARB_SEPOLIA_TOKEN_V2: d.shareV2 };
}
