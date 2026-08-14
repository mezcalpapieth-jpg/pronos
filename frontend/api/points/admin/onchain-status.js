/**
 * GET /api/points/admin/onchain-status
 *
 * Pre-flight check for the onchain trading + auto-deploy plumbing.
 * Reads every env var we depend on, calls factory.owner(),
 * factory.marketCreator(), factory.resolver(), and factory.collateral()
 * on both V1 and V2, and reports the deployer wallet's ETH +
 * collateral balance.
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
 *     v1: { reachable: true, owner, marketCreator, collateral, deployerCanCreate: true, collateralMatches: true },
 *     v2: { reachable: true, owner, marketCreator, collateral, deployerCanCreate: true, collateralMatches: true },
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
import { collectOnchainReadiness } from '../../_lib/onchain-readiness.js';
import {
  appendFactoryProbeWarnings,
  buildFactoryProbeStatus,
} from '../../_lib/protocol-factory-readiness.js';

const FACTORY_ABI = [
  'function owner() view returns (address)',
  'function marketCreator() view returns (address)',
  'function resolver() view returns (address)',
  'function collateral() view returns (address)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

async function probeFactory({ provider, address, deployerAddress, resolverAddress, expectedCollateral, label }) {
  const out = {
    address: address || null,
    reachable: false,
    owner: null,
    marketCreator: null,
    resolver: null,
    collateral: null,
    deployerIsOwner: false,
    deployerIsMarketCreator: false,
    deployerCanCreate: false,
    resolverMatches: false,
    collateralMatches: false,
    error: null,
  };
  if (!address) {
    out.error = `${label}_address_not_set`;
    return out;
  }
  try {
    const c = new ethers.Contract(address, FACTORY_ABI, provider);
    const [owner, marketCreator, resolver, collateral] = await Promise.all([
      c.owner(),
      c.marketCreator().catch(() => null),
      c.resolver(),
      c.collateral(),
    ]);
    out.reachable = true;
    out.owner = owner;
    out.marketCreator = marketCreator;
    out.resolver = resolver;
    out.collateral = collateral;
    Object.assign(out, buildFactoryProbeStatus({
      owner,
      marketCreator,
      resolver,
      collateral,
      deployerAddress,
      resolverAddress,
      expectedCollateral,
    }));
  } catch (e) {
    out.error = e?.message?.slice(0, 240) || 'rpc_call_failed';
  }
  return out;
}

async function readProtocolPoolAddresses() {
  const dbUrl = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!dbUrl) return { pools: [], error: null };
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(dbUrl);
    const rows = await sql`
      SELECT pool_address
        FROM protocol_markets
       WHERE pool_address IS NOT NULL
         AND COALESCE(status, 'active') IN ('active', 'resolved')
       ORDER BY created_at DESC
       LIMIT 500
    `;
    return { pools: rows.map(r => r.pool_address).filter(Boolean), error: null };
  } catch (e) {
    return { pools: [], error: e?.message || 'db_read_failed' };
  }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const poolCoverage = await readProtocolPoolAddresses();
    const readiness = collectOnchainReadiness({
      env: process.env,
      protocolPools: poolCoverage.pools,
      protocolPoolError: poolCoverage.error,
    });
    const { env, ownerControls, deployment, turnkey, juno, cre, gas, policy, launch } = readiness;
    const warnings = [...readiness.warnings];

    if (!env.rpc) {
      // No RPC = nothing else to check on-chain.
      return res.status(200).json({
        ok: false,
        env,
        ownerControls,
        deployment,
        turnkey,
        juno,
        cre,
        gas,
        policy,
        launch,
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
        resolverAddress: env.resolverAddress,
        expectedCollateral: env.collateral,
        label: 'factoryV1',
      }),
      probeFactory({
        provider,
        address: env.factoryV2,
        deployerAddress: env.deployerAddress,
        resolverAddress: env.resolverAddress,
        expectedCollateral: env.collateral,
        label: 'factoryV2',
      }),
    ]);

    if (v1.address && !v1.reachable) warnings.push(`V1 factory ${v1.address} unreachable: ${v1.error}`);
    if (v2.address && !v2.reachable) warnings.push(`V2 factory ${v2.address} unreachable: ${v2.error}`);
    appendFactoryProbeWarnings(warnings, {
      label: 'V1',
      probe: v1,
      deployerAddress: env.deployerAddress,
      resolverAddress: env.resolverAddress,
      expectedCollateral: env.collateral,
    });
    appendFactoryProbeWarnings(warnings, {
      label: 'V2',
      probe: v2,
      deployerAddress: env.deployerAddress,
      resolverAddress: env.resolverAddress,
      expectedCollateral: env.collateral,
    });

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
      ownerControls,
      deployment,
      turnkey,
      juno,
      cre,
      gas,
      policy,
      launch,
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
