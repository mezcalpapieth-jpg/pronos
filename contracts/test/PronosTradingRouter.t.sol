// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PronosTradingRouter.sol";

contract RouterMXNP is ERC20 {
    constructor() ERC20("Test MXNP", "MXNP") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address user, uint256 amount) external { _mint(user, amount); }
}

contract SpoofPool {
    address public factory;
    uint256 public marketId;
    constructor(address f, uint256 id) { factory = f; marketId = id; }
}

contract PronosTradingRouterTest is Test {
    RouterMXNP mxnp;
    PronosToken yesNo;
    PronosTokenV2 multi;
    MarketFactory v1;
    MarketFactoryV2 v2;
    PronosTradingRouter router;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0x123);

    function setUp() public {
        vm.chainId(421614);
        mxnp = new RouterMXNP();
        yesNo = new PronosToken();
        multi = new PronosTokenV2();
        v1 = new MarketFactory(address(yesNo), address(mxnp), treasury, treasury, treasury);
        v2 = new MarketFactoryV2(address(multi), address(mxnp), treasury, treasury, treasury);
        yesNo.setMinter(address(v1), true);
        yesNo.transferOwnership(address(v1));
        multi.setMinter(address(v2), true);
        multi.transferOwnership(address(v2));
        router = new PronosTradingRouter(address(v1), address(v2));
        v1.setTradingRouter(address(router));
        v2.setTradingRouter(address(router));
        mxnp.mint(address(this), 100_000e6);
        mxnp.mint(alice, 1_000e6);
        mxnp.approve(address(v1), type(uint256).max);
        mxnp.approve(address(v2), type(uint256).max);
        // Consent/approvals happen BEFORE any pool exists.
        vm.startPrank(alice);
        mxnp.approve(address(router), type(uint256).max);
        yesNo.setApprovalForAll(address(router), true);
        multi.setApprovalForAll(address(router), true);
        vm.stopPrank();
    }

    function pool(bool binary) internal returns (address result, uint256 id) {
        if (binary) {
            id = v1.createMarket("Technical test", "test", block.timestamp + 1 days, "Manual test", 1_000e6);
            (result, , , , , ) = v1.getMarket(id);
        } else {
            string[] memory outcomes = new string[](3);
            outcomes[0] = "A"; outcomes[1] = "B"; outcomes[2] = "C";
            id = v2.createMarket("Technical test", "test", block.timestamp + 1 days, "Manual test", outcomes, 1_000e6);
            (result, , , , , , ) = v2.getMarket(id);
        }
    }

    function test_oneApprovalCoversFutureBinaryAndMultiPools() public {
        for (uint256 i; i < 4; i++) {
            bool binary = i % 2 == 0;
            (address p, uint256 id) = pool(binary);
            uint8 side = binary ? 1 : 2;
            vm.recordLogs();
            vm.prank(alice);
            uint256 bought = router.buy(p, side, 10e6, 1);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            bytes32 eventId = binary
                ? keccak256("SharesBought(address,bool,uint256,uint256,uint256)")
                : keccak256("SharesBought(address,uint8,uint256,uint256,uint256)");
            bool sawUser;
            for (uint256 j; j < logs.length; j++) {
                if (logs[j].emitter == p && logs[j].topics[0] == eventId) {
                    assertEq(address(uint160(uint256(logs[j].topics[1]))), alice);
                    sawUser = true;
                }
            }
            assertTrue(sawUser, "indexer must see actual user");
            assertGt(bought, 0);
            assertEq(binary ? yesNo.balanceOf(alice, id * 2 + side) : multi.balanceOf(alice, id * 256 + side), bought);
            assertEq(binary ? PronosAMM(p).costBasis(alice, side) : PronosAMMMulti(p).costBasis(alice, side), 10e6);
            vm.prank(alice);
            uint256 paid = router.sell(p, side, bought / 2, 1);
            assertGt(paid, 0);
            assertEq(binary ? PronosAMM(p).costBasis(alice, side) : PronosAMMMulti(p).costBasis(alice, side), 10e6 - 10e6 * (bought / 2) / bought);
            assertEq(mxnp.allowance(alice, p), 0, "no per-pool collateral approval");
            assertFalse(binary ? yesNo.isApprovedForAll(alice, p) : multi.isApprovedForAll(alice, p), "no per-pool share approval");
        }
        assertEq(mxnp.balanceOf(address(router)), 0, "router never holds collateral");
    }

    function test_redemptionsPayOwnerAndKeepUserEvents() public {
        for (uint256 i; i < 2; i++) {
            bool binary = i == 0;
            (address p, uint256 id) = pool(binary);
            vm.prank(alice);
            uint256 bought = router.buy(p, 0, 10e6, 1);
            if (binary) v1.resolveMarket(id, 1);
            else v2.resolveMarket(id, 0);
            vm.warp(block.timestamp + 2 days); // redeem even after market close
            uint256 beforeBalance = mxnp.balanceOf(alice);
            vm.recordLogs();
            vm.prank(alice);
            router.redeem(p, bought);
            Vm.Log[] memory logs = vm.getRecordedLogs();
            bytes32 eventId = binary ? keccak256("WinningsRedeemed(address,uint256,uint256)")
                : keccak256("WinningsRedeemed(address,uint8,uint256,uint256)");
            bool sawUser;
            for (uint256 j; j < logs.length; j++) {
                if (logs[j].emitter == p && logs[j].topics[0] == eventId) {
                    assertEq(address(uint160(uint256(logs[j].topics[1]))), alice); sawUser = true;
                }
            }
            assertTrue(sawUser);
            assertEq(mxnp.balanceOf(alice) - beforeBalance, bought);
            assertEq(binary ? yesNo.balanceOf(alice, id * 2) : multi.balanceOf(alice, id * 256), 0);
        }
        assertEq(mxnp.balanceOf(address(router)), 0);
    }

    function test_slippageFailureRollsBackPrepaidTokens() public {
        for (uint256 i; i < 2; i++) {
            bool binary = i == 0;
            (address p, uint256 id) = pool(binary);
            uint256 balance = mxnp.balanceOf(alice);
            vm.prank(alice); vm.expectRevert();
            router.buy(p, 0, 10e6, type(uint256).max);
            assertEq(mxnp.balanceOf(alice), balance);
            vm.prank(alice);
            uint256 bought = router.buy(p, 0, 10e6, 1);
            vm.prank(alice); vm.expectRevert();
            router.sell(p, 0, bought, type(uint256).max);
            assertEq(binary ? yesNo.balanceOf(alice, id * 2) : multi.balanceOf(alice, id * 256), bought);
            assertEq(binary ? PronosAMM(p).costBasis(alice, 0) : PronosAMMMulti(p).costBasis(alice, 0), 10e6);
        }
    }

    function test_spoofAndUntrustedPoolsCannotSpendApprovals() public {
        pool(true);
        address spoof = address(new SpoofPool(address(v1), 0));
        vm.prank(alice); vm.expectRevert("Router: unregistered pool");
        router.buy(spoof, 0, 10e6, 1);
        address unknown = address(new SpoofPool(address(0xBAD), 0));
        vm.prank(alice); vm.expectRevert("Router: untrusted factory");
        router.buy(unknown, 0, 10e6, 1);
        assertEq(mxnp.balanceOf(alice), 1_000e6);
    }

    function test_otherWalletCannotSpendAlicesApprovalsOrCallPrepaidPaths() public {
        (address p, ) = pool(true);
        vm.prank(bob); vm.expectRevert(); router.buy(p, 0, 10e6, 1);
        vm.prank(bob); vm.expectRevert("PronosAMM: not router");
        PronosAMM(p).buyRouted(alice, true, 10e6, 1);
        vm.prank(bob); vm.expectRevert("PronosAMM: not router");
        PronosAMM(p).sellRouted(alice, true, 10e6, 1);
        vm.prank(bob); vm.expectRevert("PronosAMM: not router");
        PronosAMM(p).redeemRouted(alice, 1);
        assertEq(mxnp.balanceOf(alice), 1_000e6);
    }

    function test_noGenericCallsNativeValueOrZeroGuards() public {
        (address p, ) = pool(true);
        vm.prank(alice); vm.expectRevert("Router: amount or guard"); router.buy(p, 0, 10e6, 0);
        vm.prank(alice); vm.expectRevert("Router: amount or guard"); router.sell(p, 0, 1, 0);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok, ) = address(router).call{value: 1}(abi.encodeCall(router.buy, (p, 0, 10e6, 1)));
        assertFalse(ok);
        (ok, ) = address(router).call(abi.encodeWithSignature("transfer(address,uint256)", bob, 1));
        assertFalse(ok);
    }

    function test_routerBindingIsOneTimeAndOwnerOnly() public {
        vm.expectRevert(); v1.setTradingRouter(address(router));
        vm.expectRevert(); v2.setTradingRouter(address(router));
        vm.prank(bob); vm.expectRevert("MarketFactory: not owner"); v1.setTradingRouter(address(router));
    }

    function test_revokedTokenApprovalsBlockFurtherBuysAndSells() public {
        for (uint256 i; i < 2; i++) {
            (address p, ) = pool(i == 0);
            vm.startPrank(alice);
            uint256 bought = router.buy(p, 0, 10e6, 1);
            mxnp.approve(address(router), 0);
            vm.expectRevert(); router.buy(p, 0, 1e6, 1);
            mxnp.approve(address(router), type(uint256).max);
            if (i == 0) yesNo.setApprovalForAll(address(router), false);
            else multi.setApprovalForAll(address(router), false);
            vm.expectRevert(); router.sell(p, 0, bought, 1);
            vm.stopPrank();
        }
    }

    function test_multiPrepaidPathsAreRestrictedAndResolvedTradingBlocked() public {
        (address p, uint256 id) = pool(false);
        vm.prank(bob); vm.expectRevert("PronosAMMMulti: not router");
        PronosAMMMulti(p).buyRouted(alice, 0, 10e6, 1);
        vm.prank(bob); vm.expectRevert("PronosAMMMulti: not router");
        PronosAMMMulti(p).sellRouted(alice, 0, 10e6, 1);
        vm.prank(bob); vm.expectRevert("PronosAMMMulti: not router");
        PronosAMMMulti(p).redeemRouted(alice, 1);
        v2.resolveMarket(id, 0);
        vm.prank(alice); vm.expectRevert("Router: market closed"); router.buy(p, 0, 10e6, 1);
    }

    function test_routerCannotDeployOnAnotherChain() public {
        vm.chainId(42161);
        vm.expectRevert("Router: Sepolia only"); new PronosTradingRouter(address(v1), address(v2));
    }

    function test_eightOutcomeTradesFitDelegatedGasBudget() public {
        string[] memory outcomes = new string[](8);
        for (uint256 i; i < 8; i++) outcomes[i] = "Outcome";
        uint256 id = v2.createMarket("8 outcomes", "test", block.timestamp + 1 days, "manual", outcomes, 1000e6);
        (address p, , , , , , ) = v2.getMarket(id);
        coolRoute(p);
        vm.prank(alice);
        uint256 start = gasleft();
        uint256 bought = router.buy(p, 7, 10e6, 1);
        assertLt(start - gasleft(), 570000, "buy gas plus transaction overhead");
        coolRoute(p);
        vm.prank(alice);
        start = gasleft();
        router.sell(p, 7, bought / 2, 1);
        assertLt(start - gasleft(), 570000, "sell gas plus transaction overhead");
    }

    function coolRoute(address p) internal {
        vm.cool(address(router)); vm.cool(p); vm.cool(address(v2));
        vm.cool(address(mxnp)); vm.cool(address(multi));
    }

    function test_expiredPausedAndResolvedPoolsCannotTrade() public {
        (address p, uint256 id) = pool(true);
        v1.pauseMarket(id, true);
        vm.prank(alice); vm.expectRevert(); router.buy(p, 0, 10e6, 1);
        v1.pauseMarket(id, false);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice); vm.expectRevert("Router: market closed"); router.buy(p, 0, 10e6, 1);
    }

    function testFuzz_routedPartialSellsPreserveCostBasis(uint96 input, uint16 fraction) public {
        uint256 amount = bound(uint256(input), 1e6, 100e6);
        uint256 numerator = bound(uint256(fraction), 1, 1000);
        (address p, ) = pool(true);
        vm.prank(alice); uint256 bought = router.buy(p, 0, amount, 1);
        uint256 sold = bought * numerator / 1000;
        vm.prank(alice); router.sell(p, 0, sold, 1);
        assertEq(PronosAMM(p).costBasis(alice, 0), amount - amount * sold / bought);
        assertEq(yesNo.balanceOf(alice, 0), bought - sold);
    }
}
