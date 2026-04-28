/**
 * GET /api/points/admin/onchain-status
 *
 * Pre-flight check for the onchain trading + auto-deploy plumbing.
 * Reads every env var we depend on, calls factory.owner() +
 * factory.collateral() on both V1 and V2, and reports the deployer
 * wallet's ETH + collateral balance.
 *
 * Use case: hit this endpoint after every contract redeploy / env var
 * change. The response lays out all the things that need to be true
 * for auto-deploy to fire, so when something fails the operator can
 * pinpoint exactly which piece is misconfigured without needing to
 * trigger a real deploy and read the error toast.
 *
 * Sample (everything green):
 *   {
 *     ok: true,
 *     env: { rpc, chainId, factoryV1, factoryV2, collateral, deployerSuborgId, deployerAddress, policiesEnabled },
 *     v1: { reachable: true, owner, collateral, deployerIsOwner: true, collateralMatches: true },
 *     v2: { reachable: true, owner, collateral, deployerIsOwner: true, collateralMatches: true },
 *     deployer: { ethBalanceWei, ethBalanceEther, collateralBalanceRaw, collateralBalanceUnits, decimals },
 *     warnings: [],
 *   }
 *
 * Returns 200 even when things are wrong; the `ok` field + `warnings`
 * array are the source of truth.
 */

import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const FACTORY_ABI = [
  'function owner() view returns (address)',
  'function collateral() view returns (address)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

function eqAddr(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

async function probeFactory({ provider, address, deployerAddress, expectedCollateral, label }) {
  const out = {
    address: address || null,
    reachable: false,
    owner: null,
    collateral: null,
    deployerIsOwner: false,
    collateralMatches: false,
    error: null,
  };
  if (!address) {
    out.error = `${label}_address_not_set`;
    return out;
  }
  try {
    const c = new ethers.Contract(address, FACTORY_ABI, provider);
    const [owner, collateral] = await Promise.all([
      c.owner(),
      c.collateral(),
    ]);
    out.reachable = true;
    out.owner = owner;
    out.collateral = collateral;
    out.deployerIsOwner = deployerAddress ? eqAddr(owner, deployerAddress) : false;
    out.collateralMatches = expectedCollateral ? eqAddr(collateral, expectedCollateral) : false;
  } catch (e) {
    out.error = e?.message?.slice(0, 240) || 'rpc_call_failed';
  }
  return out;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const env = {
      rpc:               !!process.env.ONCHAIN_RPC_URL,
      chainId:           Number(process.env.ONCHAIN_CHAIN_ID || 0) || null,
      factoryV1:         process.env.ONCHAIN_MARKET_FACTORY_ADDRESS || null,
      factoryV2:         process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS || null,
      collateral:        process.env.ONCHAIN_COLLATERAL_ADDRESS || null,
      deployerSuborgId:  !!process.env.ONCHAIN_DEPLOYER_SUBORG_ID,
      deployerAddress:   process.env.ONCHAIN_DEPLOYER_ADDRESS || null,
      policiesEnabled:   process.env.TURNKEY_POLICIES_ENABLED === 'true',
    };

    const warnings = [];
    if (!env.rpc) warnings.push('ONCHAIN_RPC_URL missing');
    if (!env.chainId) warnings.push('ONCHAIN_CHAIN_ID missing or 0');
    if (!env.factoryV1) warnings.push('ONCHAIN_MARKET_FACTORY_ADDRESS missing — V1 (binary) auto-deploy disabled');
    if (!env.factoryV2) warnings.push('ONCHAIN_MARKET_FACTORY_V2_ADDRESS missing — V2 (multi) auto-deploy disabled');
    if (!env.collateral) warnings.push('ONCHAIN_COLLATERAL_ADDRESS missing');
    if (!env.deployerSuborgId) warnings.push('ONCHAIN_DEPLOYER_SUBORG_ID missing');
    if (!env.deployerAddress) warnings.push('ONCHAIN_DEPLOYER_ADDRESS missing');
    if (!env.policiesEnabled) warnings.push('TURNKEY_POLICIES_ENABLED is not "true" — Turnkey delegation gated off');

    if (!env.rpc) {
      // No RPC = nothing else to check on-chain.
      return res.status(200).json({
        ok: false,
        env,
        v1: null,
        v2: null,
        deployer: null,
        warnings,
      });
    }

    const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);

    const [v1, v2] = await Promise.all([
      probeFactory({
        provider,
        address: env.factoryV1,
        deployerAddress: env.deployerAddress,
        expectedCollateral: env.collateral,
        label: 'factoryV1',
      }),
      probeFactory({
        provider,
        address: env.factoryV2,
        deployerAddress: env.deployerAddress,
        expectedCollateral: env.collateral,
        label: 'factoryV2',
      }),
    ]);

    if (v1.address && !v1.reachable) warnings.push(`V1 factory ${v1.address} unreachable: ${v1.error}`);
    if (v2.address && !v2.reachable) warnings.push(`V2 factory ${v2.address} unreachable: ${v2.error}`);
    if (v1.reachable && env.deployerAddress && !v1.deployerIsOwner) {
      warnings.push(`V1 factory.owner() = ${v1.owner} but ONCHAIN_DEPLOYER_ADDRESS = ${env.deployerAddress} — auto-deploy will revert with "not owner"`);
    }
    if (v2.reachable && env.deployerAddress && !v2.deployerIsOwner) {
      warnings.push(`V2 factory.owner() = ${v2.owner} but ONCHAIN_DEPLOYER_ADDRESS = ${env.deployerAddress} — auto-deploy will revert with "not owner"`);
    }
    if (v1.reachable && env.collateral && !v1.collateralMatches) {
      warnings.push(`V1 factory.collateral() = ${v1.collateral} but ONCHAIN_COLLATERAL_ADDRESS = ${env.collateral} — UI/balance reads will be wrong`);
    }
    if (v2.reachable && env.collateral && !v2.collateralMatches) {
      warnings.push(`V2 factory.collateral() = ${v2.collateral} but ONCHAIN_COLLATERAL_ADDRESS = ${env.collateral} — UI/balance reads will be wrong`);
    }

    // Deployer wallet balances — needs ETH for gas + collateral for seed.
    let deployer = null;
    if (env.deployerAddress) {
      try {
        const ethBalance = await provider.getBalance(env.deployerAddress);
        let collateralRaw = null;
        let collateralUnits = null;
        let decimals = 6;
        let symbol = null;
        if (env.collateral) {
          try {
            const erc20 = new ethers.Contract(env.collateral, ERC20_ABI, provider);
            const [bal, dec, sym] = await Promise.all([
              erc20.balanceOf(env.deployerAddress),
              erc20.decimals().catch(() => 6),
              erc20.symbol().catch(() => null),
            ]);
            collateralRaw = bal.toString();
            decimals = Number(dec);
            symbol = sym;
            collateralUnits = Number(ethers.utils.formatUnits(bal, decimals));
          } catch (e) {
            warnings.push(`collateral.balanceOf failed: ${e?.message?.slice(0, 120) || 'rpc'}`);
          }
        }
        const ethEther = Number(ethers.utils.formatEther(ethBalance));
        deployer = {
          address: env.deployerAddress,
          ethBalanceWei: ethBalance.toString(),
          ethBalanceEther: ethEther,
          collateralSymbol: symbol,
          collateralDecimals: decimals,
          collateralBalanceRaw: collateralRaw,
          collateralBalanceUnits: collateralUnits,
        };
        if (ethEther === 0) warnings.push(`Deployer ${env.deployerAddress} has 0 ETH on chain ${env.chainId} — needs gas to deploy`);
        if (collateralUnits === 0 && env.collateral) warnings.push(`Deployer has 0 collateral (${symbol || 'token'}) — every createMarket reverts with "seed transfer failed"`);
      } catch (e) {
        warnings.push(`deployer balance probe failed: ${e?.message?.slice(0, 120) || 'rpc'}`);
      }
    }

    const ok = warnings.length === 0;

    return res.status(200).json({
      ok,
      env,
      v1,
      v2,
      deployer,
      warnings,
    });
  } catch (e) {
    console.error('[admin/onchain-status] unhandled', { message: e?.message });
    return res.status(500).json({ error: 'status_check_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
