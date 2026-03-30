// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PronosToken} from "../src/PronosToken.sol";
import {MarketFactory} from "../src/MarketFactory.sol";

/**
 * @title DeployProtocol
 * @notice Deploys the full Pronos protocol: PronosToken + MarketFactory
 *
 * Usage:
 *   forge script script/DeployProtocol.s.sol --rpc-url base_sepolia --broadcast
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY - Private key of deployer (becomes initial owner)
 *   USDC_ADDRESS         - USDC token address on target chain
 *   TREASURY_ADDRESS     - Treasury wallet (receives 70% of fees)
 *   LIQUIDITY_RESERVE    - Liquidity reserve wallet (receives 20%)
 *   EMERGENCY_RESERVE    - Emergency reserve wallet (receives 10%)
 */
contract DeployProtocol is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address liquidityReserve = vm.envAddress("LIQUIDITY_RESERVE");
        address emergencyReserve = vm.envAddress("EMERGENCY_RESERVE");

        console.log("=== Deploying Pronos Protocol ===");
        console.log("USDC:", usdc);
        console.log("Treasury:", treasury);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PronosToken (ERC-1155)
        PronosToken token = new PronosToken();
        console.log("PronosToken deployed:", address(token));

        // 2. Deploy MarketFactory
        MarketFactory factory = new MarketFactory(
            address(token),
            usdc,
            treasury,
            liquidityReserve,
            emergencyReserve
        );
        console.log("MarketFactory deployed:", address(factory));

        // 3. Authorize factory as minter and transfer token ownership
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        console.log("Token ownership transferred to factory");

        vm.stopBroadcast();

        console.log("=== Deployment Complete ===");
        console.log("Next steps:");
        console.log("  1. Transfer factory ownership to Safe multisig");
        console.log("  2. Set fee collector address");
        console.log("  3. Create first market with seed liquidity");
    }
}
