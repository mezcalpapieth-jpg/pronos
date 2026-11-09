// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PronosMainnetTradingRouter} from "../src/PronosTradingRouter.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {MarketFactoryV2} from "../src/MarketFactoryV2.sol";

/// @notice Simulation is the default. Bind the router before transferring
/// ownership of the factories to the Safe.
contract DeployMainnetTradingRouter is Script {
    function run() external {
        require(block.chainid == 42161, "Arbitrum One only");
        MarketFactory v1 = MarketFactory(vm.envAddress("ONCHAIN_MARKET_FACTORY_ADDRESS"));
        MarketFactoryV2 v2 = MarketFactoryV2(vm.envAddress("ONCHAIN_MARKET_FACTORY_V2_ADDRESS"));
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        require(v1.owner() == vm.addr(key) && v2.owner() == vm.addr(key), "Deployer must own both factories");
        require(v1.tradingRouter() == address(0) && v2.tradingRouter() == address(0), "Already bound");
        require(address(v1.feeVault()).code.length > 0 && address(v2.feeVault()).code.length > 0, "Mainnet fee vaults required");
        require(
            v1.resolutionReviewer().code.length > 0 && v2.resolutionReviewer().code.length > 0,
            "Independent reviewers required"
        );

        vm.startBroadcast(key);
        PronosMainnetTradingRouter router = new PronosMainnetTradingRouter(address(v1), address(v2));
        v1.setTradingRouter(address(router));
        v2.setTradingRouter(address(router));
        vm.stopBroadcast();

        console.log("ONCHAIN_TRADING_ROUTER_ADDRESS=", address(router));
        console.log("ONCHAIN_TRADING_ROUTER_CODE_HASH=");
        console.logBytes32(address(router).codehash);
    }
}
