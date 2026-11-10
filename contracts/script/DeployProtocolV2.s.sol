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
 *   RESOLUTION_REVIEWER_SAFE_ADDRESS - Required independent reviewer on Arbitrum One
 *   RESOLUTION_REVIEWER_ADDRESS - Required independent reviewer on Arbitrum Sepolia
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
        require(block.chainid != 42161 || feeCollector == treasury, "Arbitrum One uses a dedicated fee vault");
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

        address reviewer = resolutionReviewer(vm.addr(deployerKey), adminAddress, resolverAddress);

        console.log("=== Deploying Pronos Protocol V2 ===");
        console.log("Collateral:", collateral);
        console.log("Treasury:", treasury);

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
        console.log("Fee collector:", factory.feeCollector());

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

        if (reviewer != address(0)) factory.setResolutionReviewer(reviewer);

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
        console.log("ONCHAIN_CHAIN_ID=", block.chainid);
        console.log("VITE_ONCHAIN_CHAIN_ID=", block.chainid);
        console.log("ONCHAIN_MARKET_FACTORY_V2_ADDRESS=", address(factory));
        console.log("ONCHAIN_SHARE_TOKEN_V2_ADDRESS=", address(token));
        console.log("MARKET_CREATOR_ADDRESS=", marketCreator);
        console.log("ONCHAIN_DEPLOYER_ADDRESS=", marketCreator);
        if (block.chainid == 421614) {
            console.log("VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2=", address(factory));
            console.log("VITE_PRONOS_ARB_SEPOLIA_TOKEN_V2=", address(token));
        } else if (block.chainid == 42161) {
            console.log("VITE_PRONOS_ARBITRUM_FACTORY_V2=", address(factory));
            console.log("VITE_PRONOS_ARBITRUM_TOKEN_V2=", address(token));
        }
        console.log("PRONOS_FACTORY_V2_ADDRESS=", address(factory));
        console.log("FACTORY_V2_ADDRESS=", address(factory));
        console.log("Next steps:");
        console.log("  1. Add the V2 env vars above to Vercel");
        console.log("  2. Run /api/migrate");
        console.log(
            reviewer == address(0)
                ? "  3. Create multi-option markets from /mvp/admin"
                : "  3. Create first multi-option market with createReviewedMarket and a rules hash"
        );
    }

    function resolutionReviewer(address deployer, address admin, address resolver) private view returns (address reviewer) {
        if (block.chainid == 42161) {
            reviewer = vm.envAddress("RESOLUTION_REVIEWER_SAFE_ADDRESS");
            requireDeployed("RESOLUTION_REVIEWER_SAFE_ADDRESS", reviewer);
        } else if (block.chainid == 421614) {
            reviewer = vm.envAddress("RESOLUTION_REVIEWER_ADDRESS");
        } else {
            return address(0);
        }
        require(
            resolver != address(0) && resolver != deployer && resolver != admin
                && reviewer != address(0) && reviewer != deployer && reviewer != admin && reviewer != resolver,
            "Reviewed settlement requires distinct owner, resolver, and reviewer"
        );
    }

    function requireDeployed(string memory label, address account) internal view {
        require(account.code.length > 0, string.concat(label, " is not deployed on this chain"));
    }
}
