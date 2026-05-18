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
 *   forge script script/DeployProtocolV2.s.sol --rpc-url arbitrum --broadcast --verify
 *
 * Optional env vars:
 *   MARKET_CREATOR_ADDRESS - Turnkey ops wallet allowed to create markets.
 *                            Defaults to ONCHAIN_DEPLOYER_ADDRESS when set.
 *   ADMIN_ADDRESS         - If set, ownership transfers to this address during deploy
 *   RESOLVER_ADDRESS      - If set, resolver role transfers to this address during deploy
 *   ADMIN_SAFE_ADDRESS    - Mainnet-safe alias for ADMIN_ADDRESS; must be deployed
 *   RESOLVER_SAFE_ADDRESS - Mainnet-safe alias for RESOLVER_ADDRESS; must be deployed
 */
contract DeployProtocolV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address collateral = vm.envOr("COLLATERAL_ADDRESS", address(0));
        if (collateral == address(0)) collateral = vm.envAddress("ONCHAIN_COLLATERAL_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address liquidityReserve = vm.envAddress("LIQUIDITY_RESERVE");
        address emergencyReserve = vm.envAddress("EMERGENCY_RESERVE");
        address feeCollector = vm.envOr("FEE_COLLECTOR_ADDRESS", treasury);
        address marketCreator = vm.envOr("MARKET_CREATOR_ADDRESS", address(0));
        if (marketCreator == address(0)) marketCreator = vm.envOr("ONCHAIN_DEPLOYER_ADDRESS", address(0));
        address adminAddress = vm.envOr("ADMIN_ADDRESS", address(0));
        address resolverAddress = vm.envOr("RESOLVER_ADDRESS", address(0));
        address adminSafe = vm.envOr("ADMIN_SAFE_ADDRESS", address(0));
        address resolverSafe = vm.envOr("RESOLVER_SAFE_ADDRESS", address(0));

        if (adminAddress == address(0) && adminSafe != address(0)) {
            requireDeployed("ADMIN_SAFE_ADDRESS", adminSafe);
            adminAddress = adminSafe;
        }

        if (resolverAddress == address(0) && resolverSafe != address(0)) {
            requireDeployed("RESOLVER_SAFE_ADDRESS", resolverSafe);
            resolverAddress = resolverSafe;
        }

        console.log("=== Deploying Pronos Protocol V2 ===");
        console.log("Collateral:", collateral);
        console.log("Treasury:", treasury);
        console.log("Fee collector:", feeCollector);

        vm.startBroadcast(deployerKey);

        PronosTokenV2 token = new PronosTokenV2();
        console.log("PronosTokenV2 deployed:", address(token));

        MarketFactoryV2 factory = new MarketFactoryV2(
            address(token),
            collateral,
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

        if (marketCreator != address(0)) {
            factory.setMarketCreator(marketCreator);
            console.log("Market creator set to:", marketCreator);
        } else if (adminAddress != address(0)) {
            console.log("WARNING: Safe/admin owner set without MARKET_CREATOR_ADDRESS; createMarket will require Safe execution.");
        }

        if (adminAddress != address(0)) {
            factory.transferOwnership(adminAddress);
            console.log("Factory V2 ownership transferred to:", adminAddress);
        }

        vm.stopBroadcast();

        console.log("=== Deployment Complete ===");
        console.log("Vercel env:");
        console.log("ONCHAIN_MARKET_FACTORY_V2_ADDRESS=", address(factory));
        console.log("MARKET_CREATOR_ADDRESS=", marketCreator);
        console.log("ONCHAIN_DEPLOYER_ADDRESS=", marketCreator);
        console.log("VITE_PRONOS_ARBITRUM_FACTORY_V2=", address(factory));
        console.log("VITE_PRONOS_ARBITRUM_TOKEN_V2=", address(token));
        console.log("PRONOS_FACTORY_V2_ADDRESS=", address(factory));
        console.log("FACTORY_V2_ADDRESS=", address(factory));
        console.log("Next steps:");
        console.log("  1. Add the V2 env vars above to Vercel");
        console.log("  2. Run /api/migrate");
        console.log("  3. Create multi-option markets from /mvp/admin");
    }

    function requireDeployed(string memory label, address account) internal view {
        require(account.code.length > 0, string.concat(label, " is not deployed on this chain"));
    }
}
