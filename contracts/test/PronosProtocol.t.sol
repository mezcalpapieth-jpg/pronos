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
}
