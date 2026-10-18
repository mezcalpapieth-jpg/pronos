// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../script/DeployTournamentCycle.s.sol";

contract TournamentCycleTest is Test {
    address alice = address(0xA11CE);

    function configure() internal {
        vm.chainId(421614);
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "12345"); // Local test key only.
        vm.setEnv("CYCLE_OWNER_ADDRESS", vm.toString(address(this)));
        vm.setEnv("CYCLE_OPERATIONS_ADDRESS", vm.toString(address(this)));
        vm.setEnv("CYCLE_RESOLVER_ADDRESS", vm.toString(address(this)));
        vm.setEnv("TREASURY_ADDRESS", vm.toString(address(0x100)));
        vm.setEnv("LIQUIDITY_RESERVE", vm.toString(address(0x200)));
        vm.setEnv("EMERGENCY_RESERVE", vm.toString(address(0x300)));
    }

    function test_newCycleStartsEmptyAndPreservesOldWinningClaims() public {
        configure();
        DeployTournamentCycle script = new DeployTournamentCycle();
        DeployTournamentCycle.Deployment memory old = script.run();
        TournamentMXNP oldToken = TournamentMXNP(old.token);
        MarketFactory oldFactory = MarketFactory(old.factoryV1);
        PronosTradingRouter oldRouter = PronosTradingRouter(old.router);
        oldToken.mint(address(this), 10_000e6);
        oldToken.mint(alice, 1_000e6);
        oldToken.approve(old.factoryV1, type(uint256).max);
        uint256 id = oldFactory.createMarket("Old tournament", "test", block.timestamp + 1 days, "Manual", 1_000e6);
        (address pool, , , , , ) = oldFactory.getMarket(id);
        vm.startPrank(alice);
        oldToken.approve(old.router, type(uint256).max);
        uint256 shares = oldRouter.buy(pool, 0, 100e6, 1);
        vm.stopPrank();
        uint256 oldWalletBalance = oldToken.balanceOf(alice);
        uint256 oldPoolCollateral = oldToken.balanceOf(pool);

        DeployTournamentCycle.Deployment memory next = script.run();
        TournamentMXNP nextToken = TournamentMXNP(next.token);
        assertTrue(next.token != old.token && next.router != old.router);
        assertEq(nextToken.totalSupply(), 0, "Deployment must not allocate funds");
        assertEq(nextToken.balanceOf(alice), 0);
        assertEq(address(MarketFactory(next.factoryV1).collateral()), next.token);
        assertEq(address(MarketFactoryV2(next.factoryV2).collateral()), next.token);
        assertEq(MarketFactory(next.factoryV1).tradingRouter(), next.router);
        assertEq(MarketFactoryV2(next.factoryV2).tradingRouter(), next.router);
        assertEq(nextToken.owner(), address(this));

        address[] memory wallets = new address[](2);
        wallets[0] = alice; wallets[1] = address(this);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500e6; amounts[1] = 10_000e6;
        nextToken.batchMint(wallets, amounts);
        assertEq(nextToken.balanceOf(alice), 500e6, "Old winnings do not carry over");
        assertEq(oldToken.balanceOf(alice), oldWalletBalance);
        assertEq(oldToken.balanceOf(pool), oldPoolCollateral, "Old claims stay collateralized");
        assertEq(nextToken.allowance(alice, next.router), 0, "New router needs owner consent");

        vm.warp(block.timestamp + 2 days);
        oldFactory.resolveMarket(id, 1);
        vm.startPrank(alice);
        PronosToken(old.shareV1).setApprovalForAll(old.router, true);
        oldRouter.redeem(pool, shares);
        vm.stopPrank();
        assertEq(oldToken.balanceOf(alice), oldWalletBalance + shares);
        assertEq(nextToken.balanceOf(alice), 500e6, "Old redemption cannot affect new scoring currency");
    }

    function test_deploymentRefusesOtherChains() public {
        vm.chainId(42161);
        DeployTournamentCycle script = new DeployTournamentCycle();
        vm.expectRevert("Arbitrum Sepolia only");
        script.run();
    }
}
