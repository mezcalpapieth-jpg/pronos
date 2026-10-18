// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {TournamentMXNP} from "../src/TournamentMXNP.sol";
import {PronosToken} from "../src/PronosToken.sol";
import {PronosTokenV2} from "../src/PronosTokenV2.sol";
import {MarketFactory} from "../src/MarketFactory.sol";
import {MarketFactoryV2} from "../src/MarketFactoryV2.sol";
import {PronosTradingRouter} from "../src/PronosTradingRouter.sol";

/// @notice Optional future cycle. Deploys unchanged protocol contracts with a
/// fresh, zero-supply MXNP. Does not mint, reset users or change application env.
/// Simulation by default; a future deployment requires explicit --broadcast.
contract DeployTournamentCycle is Script {
    struct Roles {
        address owner;
        address operations;
        address resolver;
        address treasury;
        address liquidity;
        address emergency;
    }
    struct Deployment {
        address token;
        address factoryV1;
        address factoryV2;
        address shareV1;
        address shareV2;
        address router;
    }

    function run() external returns (Deployment memory d) {
        require(block.chainid == 421614, "Arbitrum Sepolia only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Roles memory r = Roles({
            owner: vm.envAddress("CYCLE_OWNER_ADDRESS"),
            operations: vm.envAddress("CYCLE_OPERATIONS_ADDRESS"),
            resolver: vm.envAddress("CYCLE_RESOLVER_ADDRESS"),
            treasury: vm.envAddress("TREASURY_ADDRESS"),
            liquidity: vm.envAddress("LIQUIDITY_RESERVE"),
            emergency: vm.envAddress("EMERGENCY_RESERVE")
        });
        require(r.owner != address(0) && r.operations != address(0) && r.resolver != address(0)
            && r.treasury != address(0) && r.liquidity != address(0) && r.emergency != address(0), "Zero role");
        vm.startBroadcast(key);
        d.token = address(new TournamentMXNP(r.owner));
        d.shareV1 = address(new PronosToken());
        d.shareV2 = address(new PronosTokenV2());
        MarketFactory v1 = new MarketFactory(d.shareV1, d.token, r.treasury, r.liquidity, r.emergency);
        MarketFactoryV2 v2 = new MarketFactoryV2(d.shareV2, d.token, r.treasury, r.liquidity, r.emergency);
        d.factoryV1 = address(v1);
        d.factoryV2 = address(v2);
        PronosToken(d.shareV1).setMinter(d.factoryV1, true);
        PronosToken(d.shareV1).transferOwnership(d.factoryV1);
        PronosTokenV2(d.shareV2).setMinter(d.factoryV2, true);
        PronosTokenV2(d.shareV2).transferOwnership(d.factoryV2);
        d.router = address(new PronosTradingRouter(d.factoryV1, d.factoryV2));
        v1.setTradingRouter(d.router);
        v2.setTradingRouter(d.router);
        v1.setMarketCreator(r.operations);
        v2.setMarketCreator(r.operations);
        v1.setResolver(r.resolver);
        v2.setResolver(r.resolver);
        v1.transferOwnership(r.owner);
        v2.transferOwnership(r.owner);
        vm.stopBroadcast();

        // Copy this JSON to a private deployment manifest after verifying the
        // receipts. Foundry's broadcast journal is the deployment resume record.
        string memory obj = "cycle-deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "token", d.token);
        vm.serializeAddress(obj, "factoryV1", d.factoryV1);
        vm.serializeAddress(obj, "factoryV2", d.factoryV2);
        vm.serializeAddress(obj, "shareV1", d.shareV1);
        vm.serializeAddress(obj, "shareV2", d.shareV2);
        vm.serializeAddress(obj, "router", d.router);
        vm.serializeAddress(obj, "owner", r.owner);
        vm.serializeAddress(obj, "operations", r.operations);
        console.log(vm.serializeBytes32(obj, "routerCodeHash", d.router.codehash));
    }
}
