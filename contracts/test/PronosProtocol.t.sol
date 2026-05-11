// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PronosToken.sol";
import "../src/PronosAMM.sol";
import "../src/MarketFactory.sol";

/// @dev Full-featured mock USDC
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from] -= amount;
        allowance[from][msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract PronosProtocolTest is Test {
    MockUSDC public usdc;
    PronosToken public token;
    MarketFactory public factory;

    address admin     = address(0xAD);
    address treasury  = address(0x111);
    address liqRes    = address(0x222);
    address emerRes   = address(0x333);
    address feeColl   = address(0x444);
    address alice     = address(0xA);
    address bob       = address(0xB);
    address carol     = address(0xC);

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        vm.startPrank(admin);

        usdc  = new MockUSDC();
        token = new PronosToken();

        factory = new MarketFactory(
            address(token),
            address(usdc),
            treasury,
            liqRes,
            emerRes
        );

        // Set fee collector
        factory.setFeeCollector(feeColl);

        // Authorize factory as minter and transfer token ownership to factory
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));

        vm.stopPrank();

        // Mint USDC for everyone
        usdc.mint(admin, 1_000_000 * ONE_USDC);
        usdc.mint(alice, 100_000 * ONE_USDC);
        usdc.mint(bob,   100_000 * ONE_USDC);
        usdc.mint(carol, 100_000 * ONE_USDC);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PronosToken Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function test_token_ids() public view {
        assertEq(token.yesTokenId(0), 0);  // market 0 YES = 0
        assertEq(token.noTokenId(0), 1);   // market 0 NO  = 1
        assertEq(token.yesTokenId(1), 2);  // market 1 YES = 2
        assertEq(token.noTokenId(1), 3);   // market 1 NO  = 3
    }

    function test_token_only_minter_can_mint() public {
        vm.prank(alice);
        vm.expectRevert("PronosToken: not minter");
        token.mintPair(alice, 0, 100);
    }

    function test_token_ownership_is_factory() public view {
        // Token ownership was transferred to factory during setUp
        assertEq(token.owner(), address(factory));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Market Creation Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function _createTestMarket(uint256 seed) internal returns (uint256 marketId) {
        vm.startPrank(admin);
        usdc.approve(address(factory), seed);
        marketId = factory.createMarket(
            "Will Mexico win the World Cup 2026?",
            "deportes",
            block.timestamp + 30 days,
            "FIFA official results",
            seed
        );
        vm.stopPrank();
    }

    function test_createMarket() public {
        uint256 id = _createTestMarket(10_000 * ONE_USDC);
        assertEq(id, 0);
        assertEq(factory.marketCount(), 1);

        (address pool, string memory question, string memory category,
         uint256 endTime, string memory source, bool active) = factory.getMarket(0);

        assertTrue(pool != address(0));
        assertEq(question, "Will Mexico win the World Cup 2026?");
        assertEq(category, "deportes");
        assertTrue(endTime > block.timestamp);
        assertEq(source, "FIFA official results");
        assertTrue(active);
    }

    function test_createMarket_pool_has_reserves() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        assertEq(pool.reserveYes(), 10_000 * ONE_USDC);
        assertEq(pool.reserveNo(),  10_000 * ONE_USDC);
        assertTrue(pool.initialized());
    }

    function test_createMarket_initial_price_50_50() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Both prices should be ~500000 (50 cents = 50%)
        assertEq(pool.priceYes(), 500_000);
        assertEq(pool.priceNo(),  500_000);
    }

    function test_createMarket_reverts_past_endtime() public {
        vm.startPrank(admin);
        usdc.approve(address(factory), 10_000 * ONE_USDC);
        vm.expectRevert("MarketFactory: end time in past");
        factory.createMarket("test?", "cat", block.timestamp - 1, "src", 10_000 * ONE_USDC);
        vm.stopPrank();
    }

    function test_createMarket_reverts_non_owner() public {
        vm.startPrank(alice);
        usdc.approve(address(factory), 10_000 * ONE_USDC);
        vm.expectRevert("MarketFactory: not owner");
        factory.createMarket("test?", "cat", block.timestamp + 1 days, "src", 10_000 * ONE_USDC);
        vm.stopPrank();
    }

    function test_create_multiple_markets() public {
        _createTestMarket(10_000 * ONE_USDC);
        _createTestMarket(5_000 * ONE_USDC);
        assertEq(factory.marketCount(), 2);

        (address pool1,,,,, ) = factory.getMarket(0);
        (address pool2,,,,, ) = factory.getMarket(1);
        assertTrue(pool1 != pool2);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AMM Trading Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function test_buy_yes() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        uint256 buyAmount = 100 * ONE_USDC;
        vm.startPrank(alice);
        usdc.approve(address(pool), buyAmount);
        uint256 sharesOut = pool.buy(true, buyAmount);
        vm.stopPrank();

        // Alice should have received YES tokens
        assertTrue(sharesOut > 0);
        assertEq(token.balanceOf(alice, pool.yesId()), sharesOut);

        // Price of YES should have increased (more demand)
        assertTrue(pool.priceYes() > 500_000);
    }

    function test_buy_no() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(bob);
        usdc.approve(address(pool), 100 * ONE_USDC);
        uint256 sharesOut = pool.buy(false, 100 * ONE_USDC);
        vm.stopPrank();

        assertTrue(sharesOut > 0);
        assertEq(token.balanceOf(bob, pool.noId()), sharesOut);
        assertTrue(pool.priceNo() > 500_000);
    }

    function test_buy_moves_price() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        uint256 priceBefore = pool.priceYes();

        // Alice buys YES
        vm.startPrank(alice);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        pool.buy(true, 1_000 * ONE_USDC);
        vm.stopPrank();

        uint256 priceAfter = pool.priceYes();
        assertTrue(priceAfter > priceBefore, "YES price should increase after buying YES");
    }

    function test_sell_yes() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Alice buys YES first
        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        uint256 shares = pool.buy(true, 100 * ONE_USDC);

        // Approve token transfer for selling
        token.setApprovalForAll(address(pool), true);

        // Sell back
        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 collateralOut = pool.sell(true, shares);
        uint256 usdcAfter = usdc.balanceOf(alice);
        vm.stopPrank();

        assertTrue(collateralOut > 0);
        assertEq(usdcAfter - usdcBefore, collateralOut);
    }

    function test_buy_sell_roundtrip_loses_to_fees() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        uint256 startBalance = usdc.balanceOf(alice);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        uint256 shares = pool.buy(true, 100 * ONE_USDC);
        token.setApprovalForAll(address(pool), true);
        pool.sell(true, shares);
        vm.stopPrank();

        uint256 endBalance = usdc.balanceOf(alice);
        // User should lose money due to fees on both buy and sell
        assertTrue(endBalance < startBalance, "Round-trip should cost fees");
        // Fees went to the collector wallet
        assertTrue(usdc.balanceOf(feeColl) > 0, "Fee collector should have fees");
    }

    function test_estimate_buy_matches_actual() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        uint256 estimate = pool.estimateBuy(true, 100 * ONE_USDC);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        uint256 actual = pool.buy(true, 100 * ONE_USDC);
        vm.stopPrank();

        assertEq(estimate, actual, "Estimate should match actual");
    }

    function test_buy_reverts_when_paused() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(admin);
        factory.pauseMarket(0, true);

        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        vm.expectRevert("PronosAMM: paused");
        pool.buy(true, 100 * ONE_USDC);
        vm.stopPrank();
    }

    function test_buy_reverts_after_resolution() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(admin);
        factory.resolveMarket(0, 1); // YES wins

        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        vm.expectRevert("PronosAMM: resolved");
        pool.buy(true, 100 * ONE_USDC);
        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Resolution & Redemption Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function test_resolve_yes_wins() public {
        _createTestMarket(10_000 * ONE_USDC);

        // Alice buys YES, Bob buys NO
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(alice);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        uint256 aliceShares = pool.buy(true, 1_000 * ONE_USDC);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(pool), 500 * ONE_USDC);
        pool.buy(false, 500 * ONE_USDC);
        vm.stopPrank();

        // Resolve: YES wins
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        assertTrue(pool.resolved());
        assertEq(pool.outcome(), 1);

        // Alice redeems
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(aliceShares);
        uint256 aliceAfter = usdc.balanceOf(alice);

        // Alice should get 1 USDC per winning token
        assertEq(aliceAfter - aliceBefore, aliceShares);
    }

    function test_resolve_no_wins() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(bob);
        usdc.approve(address(pool), 500 * ONE_USDC);
        uint256 bobShares = pool.buy(false, 500 * ONE_USDC);
        vm.stopPrank();

        // Resolve: NO wins
        vm.prank(admin);
        factory.resolveMarket(0, 2);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        pool.redeem(bobShares);
        assertEq(usdc.balanceOf(bob) - bobBefore, bobShares);
    }

    function test_redeem_reverts_before_resolution() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.startPrank(alice);
        usdc.approve(address(pool), 100 * ONE_USDC);
        pool.buy(true, 100 * ONE_USDC);

        vm.expectRevert("PronosAMM: not resolved");
        pool.redeem(100);
        vm.stopPrank();
    }

    function test_resolve_reverts_invalid_outcome() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(admin);
        vm.expectRevert("PronosAMM: invalid outcome");
        factory.resolveMarket(0, 3);
    }

    function test_resolve_reverts_non_resolver() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(alice);
        vm.expectRevert("MarketFactory: not resolver");
        factory.resolveMarket(0, 1);
    }

    function test_resolve_reverts_double() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(admin);
        factory.resolveMarket(0, 1);

        vm.prank(admin);
        vm.expectRevert("MarketFactory: not active");
        factory.resolveMarket(0, 1);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Fee Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function test_fees_go_to_collector() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        uint256 feeCollBefore = usdc.balanceOf(feeColl);

        vm.startPrank(alice);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        pool.buy(true, 1_000 * ONE_USDC);
        vm.stopPrank();

        // At 50/50, fee = 2.5% of 1000 = 25 USDC
        uint256 feeCollAfter = usdc.balanceOf(feeColl);
        assertEq(feeCollAfter - feeCollBefore, 25 * ONE_USDC);
        assertEq(pool.totalFeesCollected(), 25 * ONE_USDC);
    }

    function test_dynamic_fee_decreases_with_probability() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // At 50/50: fee should be ~2.5%
        uint256 feeAt50 = pool.currentFeeBps(true);
        assertEq(feeAt50, 250); // 2.5%

        // Buy a lot of YES to push price up
        vm.startPrank(alice);
        usdc.approve(address(pool), 50_000 * ONE_USDC);
        pool.buy(true, 50_000 * ONE_USDC);
        vm.stopPrank();

        // Now YES price is high, fee for buying YES should be lower
        uint256 feeAfterBuy = pool.currentFeeBps(true);
        assertTrue(feeAfterBuy < feeAt50, "Fee should decrease as probability increases");
    }

    function test_fee_distribution_70_20_10() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Generate fees
        vm.startPrank(alice);
        usdc.approve(address(pool), 10_000 * ONE_USDC);
        pool.buy(true, 10_000 * ONE_USDC);
        vm.stopPrank();

        uint256 fees = usdc.balanceOf(feeColl);
        assertTrue(fees > 0, "Should have fees");

        // Approve factory to pull from feeCollector
        vm.prank(feeColl);
        usdc.approve(address(factory), type(uint256).max);

        // Distribute
        vm.prank(admin);
        factory.distributeFees();

        // Check 70/20/10 distribution
        assertEq(usdc.balanceOf(treasury), (fees * 70) / 100);
        assertEq(usdc.balanceOf(liqRes),   (fees * 20) / 100);
        assertEq(usdc.balanceOf(emerRes),  fees - (fees * 70) / 100 - (fees * 20) / 100);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Integration: Full Lifecycle
    // ═══════════════════════════════════════════════════════════════════════════

    function test_full_lifecycle() public {
        // 1. Create market
        uint256 id = _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(id);
        PronosAMM pool = PronosAMM(poolAddr);

        // 2. Alice buys YES
        vm.startPrank(alice);
        usdc.approve(address(pool), 2_000 * ONE_USDC);
        uint256 aliceYes = pool.buy(true, 2_000 * ONE_USDC);
        vm.stopPrank();

        // 3. Bob buys NO
        vm.startPrank(bob);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        uint256 bobNo = pool.buy(false, 1_000 * ONE_USDC);
        vm.stopPrank();

        // 4. Carol buys YES (drives price up more)
        vm.startPrank(carol);
        usdc.approve(address(pool), 500 * ONE_USDC);
        uint256 carolYes = pool.buy(true, 500 * ONE_USDC);
        vm.stopPrank();

        // Price should reflect demand (YES > 50%)
        assertTrue(pool.priceYes() > 500_000, "YES price should be above 50%");

        // 5. Resolve: YES wins
        vm.prank(admin);
        factory.resolveMarket(id, 1);

        // 6. Winners redeem
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(aliceYes);
        assertEq(usdc.balanceOf(alice) - aliceBefore, aliceYes);

        uint256 carolBefore = usdc.balanceOf(carol);
        vm.prank(carol);
        pool.redeem(carolYes);
        assertEq(usdc.balanceOf(carol) - carolBefore, carolYes);

        // 7. Bob cannot redeem (he holds NO tokens, YES won)
        vm.startPrank(bob);
        vm.expectRevert(); // burn will fail — bob has NO tokens, not YES
        pool.redeem(bobNo);
        vm.stopPrank();

        // 8. Distribute fees
        vm.prank(admin);
        // Fee distribution handled separately via feeCollector wallet

        assertTrue(usdc.balanceOf(feeColl) > 0, "Fee collector should have fees");
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Admin Tests
    // ═══════════════════════════════════════════════════════════════════════════

    function test_pause_unpause() public {
        _createTestMarket(10_000 * ONE_USDC);

        vm.prank(admin);
        factory.pauseMarket(0, true);

        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);
        assertTrue(pool.paused());

        vm.prank(admin);
        factory.pauseMarket(0, false);
        assertFalse(pool.paused());
    }

    function test_set_resolver() public {
        address newResolver = address(0xEE);
        vm.prank(admin);
        factory.setResolver(newResolver);
        assertEq(factory.resolver(), newResolver);
    }

    function test_ownership_transfer() public {
        vm.prank(admin);
        factory.transferOwnership(alice);
        assertEq(factory.owner(), alice);
    }

    // ─── Dust recovery (recoverDust / sweepDust) ─────────────────────

    function test_sweepDust_recovers_seed_after_grace() public {
        uint256 seed = 10_000 * ONE_USDC;
        _createTestMarket(seed);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Alice buys YES, market resolves YES, Alice redeems
        vm.startPrank(alice);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        uint256 aliceShares = pool.buy(true, 1_000 * ONE_USDC);
        vm.stopPrank();

        vm.prank(admin);
        factory.resolveMarket(0, 1);

        vm.prank(alice);
        pool.redeem(aliceShares);

        // Fast-forward past the grace period and sweep
        vm.warp(block.timestamp + 30 days + 1);

        address sweepRecipient = address(0xCAFE);
        uint256 before = usdc.balanceOf(sweepRecipient);
        vm.prank(admin);
        factory.sweepDust(0, sweepRecipient);
        uint256 after_ = usdc.balanceOf(sweepRecipient);

        // Recipient receives the AMM's remaining collateral — should
        // be approximately seed - alice's winning fraction. Either
        // way it's strictly > 0 and strictly <= seed, and the AMM
        // ends up with zero collateral.
        assertGt(after_ - before, 0);
        assertLe(after_ - before, seed);
        assertEq(usdc.balanceOf(address(pool)), 0);
    }

    function test_sweepDust_reverts_before_grace_period() public {
        _createTestMarket(10_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        // Try to sweep immediately — should revert.
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: grace period not over"));
        factory.sweepDust(0, address(0xCAFE));

        // 29 days in is still inside grace
        vm.warp(block.timestamp + 29 days);
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: grace period not over"));
        factory.sweepDust(0, address(0xCAFE));
    }

    function test_sweepDust_reverts_before_resolution() public {
        _createTestMarket(10_000 * ONE_USDC);
        // Skip ahead well past the would-be grace period — without
        // resolution this should still revert.
        vm.warp(block.timestamp + 60 days);
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: not resolved"));
        factory.sweepDust(0, address(0xCAFE));
    }

    function test_sweepDust_idempotent() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);
        vm.warp(block.timestamp + 30 days + 1);

        address sink = address(0xCAFE);
        vm.prank(admin);
        factory.sweepDust(0, sink);
        uint256 firstSweep = usdc.balanceOf(sink);

        // Second call drains nothing further (AMM reserve is empty) but
        // must not revert — lets a "sweep-all-resolved" cron run blindly.
        vm.prank(admin);
        factory.sweepDust(0, sink);
        assertEq(usdc.balanceOf(sink), firstSweep);
    }

    function test_sweepDust_reverts_non_owner() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);
        vm.warp(block.timestamp + 30 days + 1);

        // alice isn't the owner — can't call sweepDust.
        vm.prank(alice);
        vm.expectRevert(bytes("MarketFactory: not owner"));
        factory.sweepDust(0, alice);
    }

    function test_sweepDust_user_redeem_still_works_after_sweep() public {
        // Edge case: a user who DOESN'T redeem within the grace period
        // should still be able to redeem after the sweep. The sweep
        // only drains the AMM's OWN winning reserve, not the
        // collateral backing user-held tokens.
        uint256 seed = 5_000 * ONE_USDC;
        _createTestMarket(seed);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Alice buys YES but never redeems before sweep
        vm.startPrank(alice);
        usdc.approve(address(pool), 500 * ONE_USDC);
        uint256 aliceShares = pool.buy(true, 500 * ONE_USDC);
        vm.stopPrank();

        vm.prank(admin);
        factory.resolveMarket(0, 1);

        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(admin);
        factory.sweepDust(0, address(0xCAFE));

        // Alice redeems after sweep — should still get 1:1 collateral
        // for her winning shares.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        pool.redeem(aliceShares);
        assertEq(usdc.balanceOf(alice) - aliceBefore, aliceShares);
    }

    function test_recoverDust_reverts_non_factory() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);
        vm.warp(block.timestamp + 30 days + 1);

        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);
        // Bypassing the factory by calling the pool directly must
        // fail — only the factory may sweep.
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: not factory"));
        pool.recoverDust(admin);
    }

    // ─── Push-redeem (pushRedeem / redeemOnBehalf) ───────────────────

    function test_pushRedeem_pays_each_holder() public {
        _createTestMarket(10_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        // Alice + Bob buy YES on the same market
        vm.startPrank(alice);
        usdc.approve(address(pool), 1_000 * ONE_USDC);
        uint256 aliceShares = pool.buy(true, 1_000 * ONE_USDC);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(pool), 500 * ONE_USDC);
        uint256 bobShares = pool.buy(true, 500 * ONE_USDC);
        vm.stopPrank();

        // Resolve YES, then admin pushes redemption to both holders
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        address[] memory holders = new address[](2);
        holders[0] = alice;
        holders[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = aliceShares;
        amounts[1] = bobShares;

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(admin);
        factory.pushRedeem(0, holders, amounts);

        // Each holder received 1:1 collateral; neither sent a tx.
        assertEq(usdc.balanceOf(alice) - aliceBefore, aliceShares);
        assertEq(usdc.balanceOf(bob)   - bobBefore,   bobShares);
        // Tokens burned.
        assertEq(token.balanceOf(alice, pool.yesId()), 0);
        assertEq(token.balanceOf(bob,   pool.yesId()), 0);
    }

    function test_pushRedeem_reverts_length_mismatch() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        address[] memory holders = new address[](2);
        holders[0] = alice;
        holders[1] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;

        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: length mismatch"));
        factory.pushRedeem(0, holders, amounts);
    }

    function test_pushRedeem_reverts_empty() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        address[] memory holders = new address[](0);
        uint256[] memory amounts = new uint256[](0);

        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: empty batch"));
        factory.pushRedeem(0, holders, amounts);
    }

    function test_pushRedeem_reverts_non_owner() public {
        _createTestMarket(5_000 * ONE_USDC);
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        address[] memory holders = new address[](1);
        holders[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 100;

        vm.prank(alice);
        vm.expectRevert(bytes("MarketFactory: not owner"));
        factory.pushRedeem(0, holders, amounts);
    }

    function test_pushRedeem_reverts_before_resolution() public {
        _createTestMarket(5_000 * ONE_USDC);
        address[] memory holders = new address[](1);
        holders[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;

        // Market still active — push should revert because the AMM
        // isn't resolved yet, so redeemOnBehalf bails first.
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: not resolved"));
        factory.pushRedeem(0, holders, amounts);
    }

    function test_redeemOnBehalf_reverts_non_factory() public {
        _createTestMarket(5_000 * ONE_USDC);
        (address poolAddr,,,,, ) = factory.getMarket(0);
        PronosAMM pool = PronosAMM(poolAddr);

        vm.prank(admin);
        factory.resolveMarket(0, 1);

        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: not factory"));
        pool.redeemOnBehalf(alice, 100);
    }
}
