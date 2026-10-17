// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {PronosTradingRouter} from "../src/PronosTradingRouter.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {MarketFactoryV2} from "../src/MarketFactoryV2.sol";

/// @notice Run after deploying the two compatible factories/share tokens with
/// the existing MXNP collateral. Do not transfer factory ownership until bound.
/// Simulation is the default; broadcasting requires an explicit --broadcast.
contract DeployTradingRouter is Script {
    function run() external {
        require(block.chainid == 421614, "Sepolia only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        MarketFactory v1 = MarketFactory(vm.envAddress("ONCHAIN_MARKET_FACTORY_ADDRESS"));
        MarketFactoryV2 v2 = MarketFactoryV2(vm.envAddress("ONCHAIN_MARKET_FACTORY_V2_ADDRESS"));
        require(v1.owner() == vm.addr(key) && v2.owner() == vm.addr(key), "Deployer must own both factories");
        require(v1.tradingRouter() == address(0) && v2.tradingRouter() == address(0), "Already bound");
        vm.startBroadcast(key);
        PronosTradingRouter router = new PronosTradingRouter(address(v1), address(v2));
        v1.setTradingRouter(address(router));
        v2.setTradingRouter(address(router));
        vm.stopBroadcast();
        console.log("ONCHAIN_TRADING_ROUTER_ADDRESS=", address(router));
        console.log("ONCHAIN_TRADING_ROUTER_CODE_HASH=");
        console.logBytes32(address(router).codehash);
    }
}
