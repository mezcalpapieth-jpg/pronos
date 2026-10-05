// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TournamentMXNP} from "../src/TournamentMXNP.sol";

/**
 * @title DeployTournamentMXNP
 * @notice Deploys controlled testnet MXNP collateral for on-chain Points
 *         tournaments. No public faucet is exposed.
 *
 * Usage:
 *   forge script script/DeployTournamentMXNP.s.sol \
 *     --rpc-url arbitrum_sepolia --broadcast --verify
 *
 * Env vars:
 *   DEPLOYER_PRIVATE_KEY      - deployer's secp256k1 hex key
 *   TOURNAMENT_MXNP_OWNER    - optional owner/minter address; defaults to deployer
 *
 * After deploy:
 *   1. Set ONCHAIN_COLLATERAL_ADDRESS to the printed token address.
 *   2. Redeploy MarketFactory and MarketFactoryV2 with that collateral.
 *   3. Use the owner wallet to mint reset allocations to tournament wallets.
 */
contract DeployTournamentMXNP is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("TOURNAMENT_MXNP_OWNER", deployer);

        console.log("=== Deploying Tournament MXNP (testnet only) ===");
        console.log("Owner:", owner);

        vm.startBroadcast(deployerKey);
        TournamentMXNP mxnp = new TournamentMXNP(owner);
        vm.stopBroadcast();

        console.log("TournamentMXNP deployed:", address(mxnp));
        console.log("Decimals:", mxnp.decimals());
        console.log("");
        console.log("Vercel env:");
        console.log("ONCHAIN_COLLATERAL_ADDRESS=", address(mxnp));
        console.log("ONCHAIN_TOURNAMENT_MXNP_ADDRESS=", address(mxnp));
        console.log("Next steps:");
        console.log("  1. Redeploy MarketFactory(V1+V2) with COLLATERAL_ADDRESS =", address(mxnp));
        console.log("  2. Set ONCHAIN_COLLATERAL_ADDRESS =", address(mxnp));
        console.log("  3. Mint reset allocations from the owner wallet");
    }
}
