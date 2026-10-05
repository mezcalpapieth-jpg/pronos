export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const DEFAULT_RESET_ALLOCATION_MXNP = '500';
export const MXNP_DECIMALS = 6;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function hasEnv(env, name) {
  return typeof env?.[name] === 'string' && env[name].trim() !== '';
}

function envValue(env, name) {
  return hasEnv(env, name) ? env[name].trim() : null;
}

export function normalizeAddress(value) {
  const s = String(value || '').trim();
  return ADDRESS_RE.test(s) ? s.toLowerCase() : null;
}

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function parseFixedUnits(value, decimals = MXNP_DECIMALS) {
  const raw = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`invalid_decimal:${raw}`);
  }
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > decimals) {
    throw new Error(`too_many_decimal_places:${raw}`);
  }
  const scale = 10n ** BigInt(decimals);
  const wholeUnits = BigInt(whole || '0') * scale;
  const fractionUnits = BigInt((fraction || '').padEnd(decimals, '0') || '0');
  return (wholeUnits + fractionUnits).toString();
}

export function formatFixedUnits(units, decimals = MXNP_DECIMALS) {
  const scale = 10n ** BigInt(decimals);
  let value = BigInt(String(units || '0'));
  const sign = value < 0n ? '-' : '';
  if (value < 0n) value = -value;
  const whole = value / scale;
  const fraction = value % scale;
  return `${sign}${whole.toString()}.${fraction.toString().padStart(decimals, '0')}`;
}

function trimFixedDecimal(value) {
  return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function multiplyDecimal(value, multiplier, decimals) {
  const units = BigInt(parseFixedUnits(value, decimals));
  return trimFixedDecimal(formatFixedUnits((units * BigInt(multiplier)).toString(), decimals));
}

function parsePositiveInt(value, fallback, max = 50_000) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

export function parseOnchainResetArgs(argv = []) {
  const args = {
    apply: false,
    strict: false,
    help: false,
    allocationMxnp: DEFAULT_RESET_ALLOCATION_MXNP,
    gasEthPerWallet: null,
    cycleLabel: null,
    startsAt: null,
    endsAt: null,
    users: [],
    limit: 5000,
    previewLimit: 20,
    unknown: [],
  };

  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.apply = false;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--allocation=')) args.allocationMxnp = arg.slice('--allocation='.length).trim();
    else if (arg.startsWith('--gas-eth=')) args.gasEthPerWallet = arg.slice('--gas-eth='.length).trim();
    else if (arg.startsWith('--cycle-label=')) args.cycleLabel = arg.slice('--cycle-label='.length).trim();
    else if (arg.startsWith('--starts-at=')) args.startsAt = arg.slice('--starts-at='.length).trim();
    else if (arg.startsWith('--ends-at=')) args.endsAt = arg.slice('--ends-at='.length).trim();
    else if (arg.startsWith('--user=')) args.users.push(...splitList(arg.slice('--user='.length)));
    else if (arg.startsWith('--users=')) args.users.push(...splitList(arg.slice('--users='.length)));
    else if (arg.startsWith('--limit=')) args.limit = parsePositiveInt(arg.slice('--limit='.length), args.limit);
    else if (arg.startsWith('--preview-limit=')) args.previewLimit = parsePositiveInt(arg.slice('--preview-limit='.length), args.previewLimit, 200);
    else args.unknown.push(arg);
  }

  args.users = Array.from(new Set(args.users.map(normalizeUsername).filter(Boolean)));
  return args;
}

function validDateIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function defaultCycleLabel(startIso) {
  const date = new Date(startIso);
  if (!Number.isFinite(date.getTime())) return 'Sepolia on-chain tournament';
  return `Sepolia on-chain tournament ${date.toISOString().slice(0, 10)}`;
}

function normalizeUserRow(row = {}) {
  const username = normalizeUsername(row.username);
  const walletAddress = normalizeAddress(row.wallet_address || row.walletAddress);
  const delegationExpiresAt = row.delegation_expires_at || row.delegationExpiresAt || null;
  return {
    username,
    walletAddress,
    turnkeySubOrgId: row.turnkey_sub_org_id || row.turnkeySubOrgId || null,
    delegationPolicyId: row.delegation_policy_id || row.delegationPolicyId || null,
    delegationExpiresAt,
    pointsBalance: row.points_balance ?? row.pointsBalance ?? null,
    createdAt: row.created_at || row.createdAt || null,
  };
}

function delegationNeedsRefresh(user, now) {
  if (!user.delegationPolicyId) return true;
  if (!user.delegationExpiresAt) return false;
  const expires = new Date(user.delegationExpiresAt);
  if (!Number.isFinite(expires.getTime())) return true;
  return expires.getTime() <= now.getTime();
}

function pushMissingEnv(blockers, env, name, detail) {
  if (!hasEnv(env, name)) {
    blockers.push({
      id: `${name.toLowerCase()}_missing`,
      title: `${name} missing`,
      detail,
      fix: `Set ${name}`,
    });
  }
}

function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function buildOnchainResetPlan({
  env = process.env,
  users = [],
  now = new Date(),
  args = {},
} = {}) {
  const options = {
    ...parseOnchainResetArgs([]),
    ...args,
  };
  const blockers = [];
  const warnings = [];
  const configuredChainId = Number.parseInt(env.ONCHAIN_CHAIN_ID, 10);
  const chainId = Number.isInteger(configuredChainId) ? configuredChainId : null;

  if (options.unknown?.length) {
    blockers.push({
      id: 'unknown_arguments',
      title: 'Unknown script arguments',
      detail: options.unknown.join(', '),
      fix: 'Remove unsupported arguments',
    });
  }
  if (options.apply) {
    blockers.push({
      id: 'apply_not_implemented',
      title: 'Apply mode is intentionally disabled',
      detail: 'This reset skeleton only builds an audit plan. DB writes and chain funding are a later guarded step.',
      fix: 'Run without --apply for now',
    });
  }
  if (!hasEnv(env, 'ONCHAIN_CHAIN_ID')) {
    pushMissingEnv(blockers, env, 'ONCHAIN_CHAIN_ID', 'The reset must target Base Sepolia explicitly.');
  } else if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
    blockers.push({
      id: 'chain_not_base_sepolia',
      title: 'Reset target is not Base Sepolia',
      detail: `ONCHAIN_CHAIN_ID=${chainId}; expected ${BASE_SEPOLIA_CHAIN_ID}.`,
      fix: 'Set ONCHAIN_CHAIN_ID=84532',
    });
  }

  pushMissingEnv(blockers, env, 'ONCHAIN_RPC_URL', 'The reset job needs a Sepolia RPC for token and gas checks.');
  pushMissingEnv(blockers, env, 'ONCHAIN_TOURNAMENT_MXNP_ADDRESS', 'The reset job needs the owner-minted Tournament MXNP token.');
  pushMissingEnv(blockers, env, 'ONCHAIN_COLLATERAL_ADDRESS', 'Runtime trading must point at the same Tournament MXNP token.');
  pushMissingEnv(blockers, env, 'ONCHAIN_MARKET_FACTORY_ADDRESS', 'Approved binary markets need the Sepolia V1 factory.');
  pushMissingEnv(blockers, env, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS', 'Approved multi-outcome markets need the Sepolia V2 factory.');
  pushMissingEnv(blockers, env, 'ONCHAIN_SHARE_TOKEN_ADDRESS', 'Hidden sell approval needs the V1 ERC1155 share token target.');
  pushMissingEnv(blockers, env, 'ONCHAIN_SHARE_TOKEN_V2_ADDRESS', 'Hidden sell approval needs the V2 ERC1155 share token target.');
  pushMissingEnv(blockers, env, 'ONCHAIN_OWNER_ADDRESS', 'The token owner/minter must be known before minting reset allocations.');

  const tokenAddress = normalizeAddress(envValue(env, 'ONCHAIN_TOURNAMENT_MXNP_ADDRESS'));
  const collateralAddress = normalizeAddress(envValue(env, 'ONCHAIN_COLLATERAL_ADDRESS'));
  if (tokenAddress && collateralAddress && tokenAddress !== collateralAddress) {
    blockers.push({
      id: 'collateral_token_mismatch',
      title: 'Tournament token and runtime collateral differ',
      detail: 'ONCHAIN_COLLATERAL_ADDRESS must equal ONCHAIN_TOURNAMENT_MXNP_ADDRESS for the Sepolia tournament.',
      fix: 'Point ONCHAIN_COLLATERAL_ADDRESS at the deployed Tournament MXNP token',
    });
  }

  const startIso = validDateIso(options.startsAt) || now.toISOString();
  const endIso = validDateIso(options.endsAt);
  if (options.startsAt && !validDateIso(options.startsAt)) {
    blockers.push({
      id: 'invalid_start_time',
      title: 'Invalid cycle start timestamp',
      detail: options.startsAt,
      fix: 'Pass --starts-at as an ISO timestamp',
    });
  }
  if (options.endsAt && !endIso) {
    blockers.push({
      id: 'invalid_end_time',
      title: 'Invalid cycle end timestamp',
      detail: options.endsAt,
      fix: 'Pass --ends-at as an ISO timestamp',
    });
  }
  if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
    blockers.push({
      id: 'end_before_start',
      title: 'Cycle end must be after cycle start',
      detail: `${endIso} <= ${startIso}`,
      fix: 'Choose a later --ends-at value',
    });
  }

  let allocationUnits = '0';
  try {
    allocationUnits = parseFixedUnits(options.allocationMxnp, MXNP_DECIMALS);
  } catch (error) {
    blockers.push({
      id: 'invalid_allocation',
      title: 'Invalid MXNP allocation',
      detail: error.message,
      fix: 'Pass --allocation with up to 6 decimal places',
    });
  }

  const normalizedUsers = users
    .map(normalizeUserRow)
    .filter(user => user.username);
  const requestedUsers = new Set((options.users || []).map(normalizeUsername).filter(Boolean));
  const selectedUsers = requestedUsers.size > 0
    ? normalizedUsers.filter(user => requestedUsers.has(user.username))
    : normalizedUsers;
  const foundUsers = new Set(selectedUsers.map(user => user.username));
  const missingRequestedUsers = Array.from(requestedUsers).filter(username => !foundUsers.has(username));
  if (missingRequestedUsers.length > 0) {
    blockers.push({
      id: 'requested_users_missing',
      title: 'Requested users were not found',
      detail: missingRequestedUsers.join(', '),
      fix: 'Check --user values or create the missing Points users first',
    });
  }

  const walletCounts = new Map();
  for (const user of selectedUsers) {
    if (!user.walletAddress) continue;
    walletCounts.set(user.walletAddress, (walletCounts.get(user.walletAddress) || 0) + 1);
  }
  const duplicateWallets = Array.from(walletCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([walletAddress]) => ({
      walletAddress,
      usernames: selectedUsers
        .filter(user => user.walletAddress === walletAddress)
        .map(user => user.username),
    }));
  if (duplicateWallets.length > 0) {
    blockers.push({
      id: 'duplicate_wallets',
      title: 'Multiple users share a tournament wallet',
      detail: duplicateWallets.map(row => `${row.walletAddress}: ${row.usernames.join(', ')}`).join('; '),
      fix: 'Resolve duplicate wallet mappings before reset funding',
    });
  }

  const missingWalletUsers = selectedUsers.filter(user => !user.walletAddress);
  const missingTurnkeyUsers = selectedUsers.filter(user => !user.turnkeySubOrgId);
  const needsDelegationUsers = selectedUsers.filter(user => delegationNeedsRefresh(user, now));
  const eligibleUsers = selectedUsers.filter(user => user.walletAddress && user.turnkeySubOrgId);
  if (eligibleUsers.length === 0) {
    blockers.push({
      id: 'no_eligible_wallets',
      title: 'No eligible wallets found',
      detail: 'A reset needs users with username, Turnkey sub-org, and EVM wallet address.',
      fix: 'Create or repair hidden wallets before reset',
    });
  }
  if (missingWalletUsers.length > 0) {
    warnings.push(`${missingWalletUsers.length} selected users do not have wallet_address yet`);
  }
  if (missingTurnkeyUsers.length > 0) {
    warnings.push(`${missingTurnkeyUsers.length} selected users do not have turnkey_sub_org_id`);
  }
  if (needsDelegationUsers.length > 0) {
    warnings.push(`${needsDelegationUsers.length} selected users need delegated policy creation or refresh`);
  }

  const eligibleCount = eligibleUsers.length;
  const totalAllocationUnits = (BigInt(allocationUnits) * BigInt(eligibleCount)).toString();
  const gasEthPerWallet = options.gasEthPerWallet || null;
  let totalGasEth = null;
  if (gasEthPerWallet != null) {
    try {
      totalGasEth = multiplyDecimal(gasEthPerWallet, eligibleCount, 18);
    } catch (error) {
      blockers.push({
        id: 'invalid_gas_eth',
        title: 'Invalid Sepolia ETH gas estimate',
        detail: error.message,
        fix: 'Pass --gas-eth with up to 18 decimal places',
      });
    }
  }

  return {
    ok: blockers.length === 0,
    dryRun: !options.apply,
    operation: 'onchain_sepolia_tournament_reset',
    generatedAt: now.toISOString(),
    reset: {
      cycleLabel: options.cycleLabel || defaultCycleLabel(startIso),
      startsAt: startIso,
      endsAt: endIso,
      allocationMxnp: formatFixedUnits(allocationUnits, MXNP_DECIMALS),
      allocationUnits,
      decimals: MXNP_DECIMALS,
    },
    chain: {
      chainId,
      expectedChainId: BASE_SEPOLIA_CHAIN_ID,
      networkName: 'Base Sepolia',
      rpcConfigured: hasEnv(env, 'ONCHAIN_RPC_URL'),
      tokenAddress,
      collateralAddress,
      factoryV1: normalizeAddress(envValue(env, 'ONCHAIN_MARKET_FACTORY_ADDRESS')),
      factoryV2: normalizeAddress(envValue(env, 'ONCHAIN_MARKET_FACTORY_V2_ADDRESS')),
      shareTokenV1: normalizeAddress(envValue(env, 'ONCHAIN_SHARE_TOKEN_ADDRESS')),
      shareTokenV2: normalizeAddress(envValue(env, 'ONCHAIN_SHARE_TOKEN_V2_ADDRESS')),
      ownerAddress: normalizeAddress(envValue(env, 'ONCHAIN_OWNER_ADDRESS')),
      gasFunderAddress: normalizeAddress(
        envValue(env, 'ONCHAIN_GAS_FUNDER_ADDRESS')
          || envValue(env, 'ONCHAIN_OWNER_ADDRESS')
          || envValue(env, 'ONCHAIN_DEPLOYER_ADDRESS'),
      ),
    },
    users: {
      totalRows: normalizedUsers.length,
      selectedRows: selectedUsers.length,
      eligibleCount,
      missingWalletCount: missingWalletUsers.length,
      missingTurnkeyCount: missingTurnkeyUsers.length,
      needsDelegationCount: needsDelegationUsers.length,
      duplicateWallets,
      missingRequestedUsers,
      preview: eligibleUsers.slice(0, options.previewLimit).map(user => ({
        username: user.username,
        walletAddress: user.walletAddress,
        delegationPolicyId: user.delegationPolicyId,
        delegationExpiresAt: user.delegationExpiresAt,
      })),
      missingWalletPreview: missingWalletUsers.slice(0, options.previewLimit).map(user => user.username),
      needsDelegationPreview: needsDelegationUsers.slice(0, options.previewLimit).map(user => user.username),
    },
    funding: {
      mxnp: {
        recipients: eligibleCount,
        amountPerWalletMxnp: formatFixedUnits(allocationUnits, MXNP_DECIMALS),
        amountPerWalletUnits: allocationUnits,
        totalMxnp: formatFixedUnits(totalAllocationUnits, MXNP_DECIMALS),
        totalUnits: totalAllocationUnits,
      },
      gas: {
        recipients: eligibleCount,
        amountPerWalletEth: gasEthPerWallet,
        totalEth: totalGasEth,
      },
    },
    blockers: uniqueById(blockers),
    warnings,
    nextActions: [
      'Deploy TournamentMXNP and both protocol factories on Base Sepolia.',
      'Set Sepolia env values for token, collateral, factories, share tokens, RPC, owner, and indexer.',
      'Create or refresh Turnkey wallets and delegated policies for every selected user.',
      'Pre-fund eligible wallets with Sepolia ETH or ship a gas sponsorship path.',
      'Implement the guarded apply step that snapshots the old cycle, opens the on-chain cycle, mints MXNP, and records tx hashes.',
    ],
  };
}
