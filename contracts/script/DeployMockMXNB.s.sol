// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockMXNB} from "../src/MockMXNB.sol";

/**
 * @title DeployMockMXNB
 * @notice Deploys a faucet-equipped MXNB ERC-20 for Arbitrum Sepolia.
 *
 * Usage:
 *   forge script script/DeployMockMXNB.s.sol \
 *     --rpc-url arbitrum_sepolia --broadcast --verify
 *
 * Env vars:
 *   DEPLOYER_PRIVATE_KEY - deployer's secp256k1 hex key
 *
 * After deploy:
 *   1. Note the printed address.
 *   2. Set Vercel `ONCHAIN_COLLATERAL_ADDRESS` to that address.
 *   3. Re-deploy MarketFactory + MarketFactoryV2 with USDC_ADDRESS = mock MXNB address.
 *   4. Anyone (including the new factory deployer wallet) can call
 *      `MockMXNB.faucet()` to mint 1,000 MXNB for testing.
 */
contract DeployMockMXNB is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        console.log("=== Deploying Mock MXNB (testnet only) ===");

        vm.startBroadcast(deployerKey);
        MockMXNB mxnb = new MockMXNB();
        vm.stopBroadcast();

        console.log("MockMXNB deployed:", address(mxnb));
        console.log("Decimals:", mxnb.decimals());
        console.log("Faucet amount per call:", mxnb.FAUCET_AMOUNT());
        console.log("");
        console.log("Next steps:");
        console.log("  1. Set Vercel ONCHAIN_COLLATERAL_ADDRESS =", address(mxnb));
        console.log("  2. Re-deploy MarketFactory(V1+V2) with USDC_ADDRESS =", address(mxnb));
        console.log("  3. Call faucet() from your deployer wallet for testnet MXNB");
    }
}
