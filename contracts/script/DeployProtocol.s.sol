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
 *   forge script script/DeployProtocol.s.sol --rpc-url arbitrum_sepolia --broadcast --verify
 *
 * Required env vars:
 *   DEPLOYER_PRIVATE_KEY - Private key of deployer (becomes initial owner)
 *   USDC_ADDRESS         - USDC token address on target chain
 *   TREASURY_ADDRESS     - Treasury wallet (receives 70% of fees)
 *   LIQUIDITY_RESERVE    - Liquidity reserve wallet (receives 20%)
 *   EMERGENCY_RESERVE    - Emergency reserve wallet (receives 10%)
 *
 * Optional env vars:
 *   FEE_COLLECTOR_ADDRESS - Wallet that receives fees upfront (defaults to treasury)
 *   ADMIN_ADDRESS         - If set, ownership transfers to this address during deploy
 *   RESOLVER_ADDRESS      - If set, resolver role transfers to this address during deploy
 *   ADMIN_SAFE_ADDRESS    - Mainnet-safe alias for ADMIN_ADDRESS; must be deployed
 *   RESOLVER_SAFE_ADDRESS - Mainnet-safe alias for RESOLVER_ADDRESS; must be deployed
 */
contract DeployProtocol is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address usdc = vm.envAddress("USDC_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address liquidityReserve = vm.envAddress("LIQUIDITY_RESERVE");
        address emergencyReserve = vm.envAddress("EMERGENCY_RESERVE");
        address feeCollector = vm.envOr("FEE_COLLECTOR_ADDRESS", treasury);
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

        console.log("=== Deploying Pronos Protocol ===");
        console.log("USDC:", usdc);
        console.log("Treasury:", treasury);
        console.log("Fee collector:", feeCollector);

        vm.startBroadcast(deployerKey);

        // 1. Deploy PronosToken (ERC-1155)
        PronosToken token = new PronosToken();
        console.log("PronosToken deployed:", address(token));

        // 2. Deploy MarketFactory
        MarketFactory factory = new MarketFactory(address(token), usdc, treasury, liquidityReserve, emergencyReserve);
        console.log("MarketFactory deployed:", address(factory));

        // 3. Authorize factory as minter and transfer token ownership
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        console.log("Token ownership transferred to factory");

        // Optional one-shot testnet configuration.
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
            console.log("Factory ownership transferred to:", adminAddress);
        }

        vm.stopBroadcast();

        console.log("=== Deployment Complete ===");
        console.log("Vercel env:");
        console.log("VITE_PRONOS_ARB_SEPOLIA_FACTORY=", address(factory));
        console.log("VITE_PRONOS_ARB_SEPOLIA_TOKEN=", address(token));
        console.log("VITE_PRONOS_ARB_SEPOLIA_USDC=", usdc);
        console.log("FACTORY_ADDRESS=", address(factory));
        console.log("PRONOS_FACTORY_ADDRESS=", address(factory));
        console.log("Next steps:");
        console.log("  1. Add the Vercel env vars above");
        console.log("  2. Run /api/migrate if needed");
        console.log("  3. Create first market with seed liquidity from /mvp/admin");
    }

    function requireDeployed(string memory label, address account) internal view {
        require(account.code.length > 0, string.concat(label, " is not deployed on this chain"));
    }
}
