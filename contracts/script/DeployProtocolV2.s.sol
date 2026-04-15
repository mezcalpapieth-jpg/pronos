// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PronosTokenV2} from "../src/PronosTokenV2.sol";
import {MarketFactoryV2} from "../src/MarketFactoryV2.sol";

/**
 * @title DeployProtocolV2
 * @notice Deploys the multi-outcome Pronos protocol alongside v1.
 *
 * Usage:
 *   forge script script/DeployProtocolV2.s.sol --rpc-url arbitrum_sepolia --broadcast --verify
 */
contract DeployProtocolV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address liquidityReserve = vm.envAddress("LIQUIDITY_RESERVE");
        address emergencyReserve = vm.envAddress("EMERGENCY_RESERVE");
        address feeCollector = vm.envOr("FEE_COLLECTOR_ADDRESS", treasury);
        address adminAddress = vm.envOr("ADMIN_ADDRESS", address(0));
        address resolverAddress = vm.envOr("RESOLVER_ADDRESS", address(0));

        console.log("=== Deploying Pronos Protocol V2 ===");
        console.log("USDC:", usdc);
        console.log("Treasury:", treasury);
        console.log("Fee collector:", feeCollector);

        vm.startBroadcast(deployerKey);

        PronosTokenV2 token = new PronosTokenV2();
        console.log("PronosTokenV2 deployed:", address(token));

        MarketFactoryV2 factory = new MarketFactoryV2(
            address(token),
            usdc,
            treasury,
            liquidityReserve,
            emergencyReserve
        );
        console.log("MarketFactoryV2 deployed:", address(factory));

        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        console.log("Token V2 ownership transferred to factory V2");

        if (feeCollector != treasury) {
            factory.setFeeCollector(feeCollector);
            console.log("Fee collector updated:", feeCollector);
        }

        if (resolverAddress != address(0)) {
            factory.setResolver(resolverAddress);
            console.log("Resolver transferred to:", resolverAddress);
        }

        if (adminAddress != address(0)) {
            factory.transferOwnership(adminAddress);
            console.log("Factory V2 ownership transferred to:", adminAddress);
        }

        vm.stopBroadcast();

        console.log("=== Deployment Complete ===");
        console.log("Vercel env:");
        console.log("VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2=", address(factory));
        console.log("VITE_PRONOS_ARB_SEPOLIA_TOKEN_V2=", address(token));
        console.log("PRONOS_FACTORY_V2_ADDRESS=", address(factory));
        console.log("FACTORY_V2_ADDRESS=", address(factory));
        console.log("Next steps:");
        console.log("  1. Add the V2 env vars above to Vercel");
        console.log("  2. Run /api/migrate");
        console.log("  3. Create multi-option markets from /mvp/admin");
    }
}
