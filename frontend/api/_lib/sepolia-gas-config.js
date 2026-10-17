import { ethers } from 'ethers';
import { createHash } from 'node:crypto';
import { pendingApprovalSettings } from './onchain-preview-approval.js';

export const GAS_CHAIN_ID = 421614;
export const gasError = (code = 'gas_funding_unavailable') => Object.assign(new Error(code), { status: 503 });
const validAddress = a => ethers.utils.isAddress(a || '') && a.toLowerCase() !== ethers.constants.AddressZero;
export function isSepoliaGasDatabase(url) {
  try {
    const db = new URL(url);
    return ['postgres:', 'postgresql:'].includes(db.protocol)
      && /^ep-delicate-glitter-amp7yrkv(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(db.hostname);
  } catch { return false; }
}

// Fixed ceilings are intentional: changing a preview env var must not turn
// this service into an unrestricted faucet. All amounts are native ETH wei.
export function sepoliaGasSettings(env = process.env) {
  const requested = env.ONCHAIN_AUTO_GAS_FUNDING_ENABLED === 'true';
  const enabled = requested && pendingApprovalSettings(env).previewEnabled;
  const funder = validAddress(env.ONCHAIN_GAS_FUNDER_ADDRESS) ? env.ONCHAIN_GAS_FUNDER_ADDRESS.toLowerCase() : null;
  const separate = funder && ![
    env.ONCHAIN_DEPLOYER_ADDRESS, env.ONCHAIN_RESOLVER_ADDRESS, env.ONCHAIN_OWNER_ADDRESS,
    env.MARKET_CREATOR_ADDRESS, env.ADMIN_SAFE_ADDRESS, env.RESOLVER_SAFE_ADDRESS,
    // The incoming reserve stays out of the hosted signing path.
    '0x0Caa37c077924038e14e9D8dE46B5208788e52CF',
  ].some(a => a?.toLowerCase() === funder);
  return {
    requested, enabled,
    configured: Boolean(enabled && separate && env.ONCHAIN_GAS_FUNDER_SUBORG_ID && isSepoliaGasDatabase(env.DATABASE_URL)
      && env.ONCHAIN_RPC_URL && env.TURNKEY_POLICIES_ENABLED === 'true'
      && env.TURNKEY_ORGANIZATION_ID && env.TURNKEY_API_PUBLIC_KEY && env.TURNKEY_API_PRIVATE_KEY),
    funder, suborgId: env.ONCHAIN_GAS_FUNDER_SUBORG_ID,
    signerKeyHash: createHash('sha256').update(env.TURNKEY_API_PUBLIC_KEY || '').digest('hex'),
    target: ethers.utils.parseEther('0.0005'),
    minimum: ethers.utils.parseEther('0.0002'),
    walletDaily: ethers.utils.parseEther('0.002'),
    globalDaily: ethers.utils.parseEther('0.1'),
    reserve: ethers.utils.parseEther('0.01'),
    maxFeePerGas: ethers.utils.parseUnits('0.2', 'gwei'),
    transferGasCap: ethers.BigNumber.from(200000),
  };
}
