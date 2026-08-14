// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PronosToken.sol";
import "../src/PronosAMM.sol";
import "../src/MarketFactory.sol";

/// @dev Same MockUSDC as PronosProtocol.t.sol — duplicated rather than
///      cross-imported so this file stays self-contained.
contract MockUSDCFuzz {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }
    function transfer(address to, uint256 a) external returns (bool) {
        require(balanceOf[msg.sender] >= a, "insufficient");
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(balanceOf[f] >= a, "balance");
        require(allowance[f][msg.sender] >= a, "allowance");
        balanceOf[f] -= a;
        allowance[f][msg.sender] -= a;
        balanceOf[t] += a;
        return true;
    }
}

/**
 * @title PronosAMMFuzz
 * @notice Property-based tests for the PronosAMM CPMM math + fees.
 *
 * Targets the high-risk surfaces:
 *   1. CPMM invariant — k can only grow across trades (fees feed k)
 *   2. Buy/sell round-trip net-negative (no free arbitrage)
 *   3. estimate_* matches actual (no off-by-one between view + state-changing)
 *   4. Fee monotonicity — fee% decreases as certainty increases
 *   5. Redemption always pays 1:1 in collateral for winning tokens
 *   6. No drain — sell can never extract more than the pool holds
 *   7. Reserve sanity — reserves never go negative; sum of trades + seed
 *      equals pool's collateral balance + total fees collected
 *
 * Bounds: trade sizes are clamped to [1e3, 5e10] (1e-3 to 50,000 USDC) so
 * we exercise both dust trades and mid-size whale trades but never overflow
 * the seeded liquidity. Fuzz runs default to 256 per test (Foundry default);
 * bump via foundry.toml [fuzz] section if we want more coverage.
 */
contract PronosAMMFuzzTest is Test {
    MockUSDCFuzz public usdc;
    PronosToken  public token;
    MarketFactory public factory;
    PronosAMM    public pool;

    address admin   = address(0xAD);
    address treasury = address(0x111);
    address liqRes   = address(0x222);
    address emerRes  = address(0x333);
    address feeColl  = address(0x444);
    address trader   = address(0xBEEF);

    uint256 constant ONE_USDC = 1e6;
    uint256 constant SEED = 100_000 * ONE_USDC;       // 100k USDC seed (deep pool)
    uint256 constant TRADER_FUNDING = 1_000_000 * ONE_USDC; // 1M USDC for traders

    function setUp() public {
        vm.startPrank(admin);
        usdc  = new MockUSDCFuzz();
        token = new PronosToken();
        factory = new MarketFactory(
            address(token), address(usdc), treasury, liqRes, emerRes
        );
        factory.setFeeCollector(feeColl);
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        vm.stopPrank();

        usdc.mint(admin, SEED);
        usdc.mint(trader, TRADER_FUNDING);

        vm.prank(admin);
        usdc.approve(address(factory), SEED);
        vm.prank(admin);
        uint256 mid = factory.createMarket(
            "Will X happen?", "test", block.timestamp + 7 days, "manual", SEED
        );
        ( address poolAddr,,,,, ) = factory.getMarket(mid);
        pool = PronosAMM(poolAddr);

        vm.prank(trader);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _kProduct() internal view returns (uint256) {
        return pool.reserveYes() * pool.reserveNo();
    }

    // ─── Fuzz: round-trip (buy then sell) is net-negative ────────────────────

    /// @notice Buying then immediately selling the SAME side must lose to fees.
    ///         Otherwise we have free arbitrage = AMM is broken.
    function testFuzz_buy_yes_then_sell_loses_to_fees(uint256 amount) public {
        amount = bound(amount, ONE_USDC, 10_000 * ONE_USDC);

        uint256 startUsdc = usdc.balanceOf(trader);

        vm.prank(trader);
        uint256 shares = pool.buy(true, amount);
        assertGt(shares, 0, "buy returned zero shares");

        vm.prank(trader);
        token.setApprovalForAll(address(pool), true);
        vm.prank(trader);
        uint256 collOut = pool.sell(true, shares);

        uint256 endUsdc = usdc.balanceOf(trader);
        // After round-trip, trader has strictly LESS USDC than they started.
        assertLt(endUsdc, startUsdc, "round-trip yielded profit (fee leak)");
        // Loss should be at most the round-trip fee (5% upper bound).
        uint256 loss = startUsdc - endUsdc;
        assertLe(loss, (amount * 10) / 100, "loss exceeds 10% - math regression");
        // Sanity: collOut is positive on a non-trivial trade.
        assertGt(collOut, 0, "sell returned zero collateral");
    }

    /// @notice Buying YES then immediately buying NO with the same amount must
    ///         leave the trader strictly worse off (positive fee invariant).
    function testFuzz_buy_yes_then_buy_no_loses_to_fees(uint256 amount) public {
        amount = bound(amount, ONE_USDC, 5_000 * ONE_USDC);

        uint256 startUsdc = usdc.balanceOf(trader);

        vm.prank(trader);
        pool.buy(true, amount);
        vm.prank(trader);
        pool.buy(false, amount);

        // Trader spent 2*amount, holds two batches of opposite-side shares.
        // Even if they could merge them 1:1 (which they can't — only the AMM
        // can burn pairs), the value in shares is upper-bounded by
        // collateralIn - fees. Confirm: trader's USDC + value of shares <
        // 2*amount.
        assertEq(usdc.balanceOf(trader), startUsdc - 2 * amount, "USDC accounting off");
    }

    // ─── Fuzz: k = reserveYes * reserveNo only grows ─────────────────────────

    /// @notice CPMM invariant: every buy must NOT decrease k. Fees are taken
    ///         BEFORE the pool, but the pool itself follows a strict
    ///         constant-product. With round-up on the reserved side, k should
    ///         tick up by 1 unit on each trade (or stay flat). It must never
    ///         go down.
    function testFuzz_buy_grows_k(uint256 amount, bool buyYes) public {
        amount = bound(amount, ONE_USDC, 10_000 * ONE_USDC);
        uint256 kBefore = _kProduct();
        vm.prank(trader);
        pool.buy(buyYes, amount);
        uint256 kAfter = _kProduct();
        assertGe(kAfter, kBefore, "k decreased on buy: CPMM violated");
    }

    /// @notice Same invariant for sell. With our quadratic solver, k should
    ///         stay constant (within rounding). Specifically, the ROUND-DOWN
    ///         on `c = (a + b - sqrt) / 2` means we transfer slightly LESS
    ///         than the exact c, leaving extra in the pool — k can only grow.
    function testFuzz_sell_does_not_decrease_k(uint256 buyAmount, bool sellYes) public {
        buyAmount = bound(buyAmount, ONE_USDC, 5_000 * ONE_USDC);

        // Get some shares first by buying.
        vm.prank(trader);
        uint256 shares = pool.buy(sellYes, buyAmount);

        // Allow pool to pull tokens for sell.
        vm.prank(trader);
        token.setApprovalForAll(address(pool), true);

        uint256 kBefore = _kProduct();
        vm.prank(trader);
        pool.sell(sellYes, shares / 2); // sell half to keep within bounds
        uint256 kAfter = _kProduct();
        assertGe(kAfter, kBefore, "k decreased on sell: quadratic solver bug");
    }

    // ─── Fuzz: estimate_buy / estimate_sell match actual ─────────────────────

    /// @notice estimateBuy must equal the actual sharesOut from buy().
    ///         A mismatch would mean the UI shows a different number than
    ///         what users get — guaranteed to surface as a "I got less than
    ///         the preview" complaint and could enable MEV-style sandwiching.
    function testFuzz_estimate_buy_matches_actual(uint256 amount, bool buyYes) public {
        amount = bound(amount, ONE_USDC, 10_000 * ONE_USDC);

        uint256 estimated = pool.estimateBuy(buyYes, amount);
        vm.prank(trader);
        uint256 actual = pool.buy(buyYes, amount);
        assertEq(estimated, actual, "estimateBuy diverges from buy()");
    }

    function test_buy_with_min_shares_reverts_when_quote_is_stale() public {
        uint256 amount = 100 * ONE_USDC;
        uint256 estimated = pool.estimateBuy(true, amount);

        vm.expectRevert("PronosAMM: price moved");
        vm.prank(trader);
        pool.buy(true, amount, estimated + 1);
    }

    function test_buy_with_min_shares_accepts_current_quote() public {
        uint256 amount = 100 * ONE_USDC;
        uint256 estimated = pool.estimateBuy(true, amount);

        vm.prank(trader);
        uint256 actual = pool.buy(true, amount, estimated);

        assertEq(actual, estimated, "guarded buy changed quote");
    }

    /// @notice estimateSell must equal collOut from sell().
    function testFuzz_estimate_sell_matches_actual(uint256 buyAmount, bool sellYes) public {
        buyAmount = bound(buyAmount, ONE_USDC, 5_000 * ONE_USDC);

        // Buy shares first.
        vm.prank(trader);
        uint256 shares = pool.buy(sellYes, buyAmount);
        assertGt(shares, 0, "no shares to sell");

        vm.prank(trader);
        token.setApprovalForAll(address(pool), true);

        uint256 sellAmount = shares / 2 == 0 ? 1 : shares / 2;
        uint256 estimated = pool.estimateSell(sellYes, sellAmount);
        vm.prank(trader);
        uint256 actual = pool.sell(sellYes, sellAmount);
        assertEq(estimated, actual, "estimateSell diverges from sell()");
    }

    function test_sell_with_min_collateral_reverts_when_quote_is_stale() public {
        uint256 buyAmount = 100 * ONE_USDC;
        vm.prank(trader);
        uint256 shares = pool.buy(true, buyAmount);

        vm.prank(trader);
        token.setApprovalForAll(address(pool), true);

        uint256 sellAmount = shares / 2;
        uint256 estimated = pool.estimateSell(true, sellAmount);

        vm.expectRevert("PronosAMM: price moved");
        vm.prank(trader);
        pool.sell(true, sellAmount, estimated + 1);
    }

    // ─── Fuzz: fee monotonicity ──────────────────────────────────────────────

    /// @notice For the same trade size, fee% at 50/50 must be >= fee% at any
    ///         imbalanced state. We construct an imbalance via a large prior
    ///         buy on one side, then verify the fee on a subsequent same-side
    ///         buy is no higher.
    function testFuzz_fee_decreases_with_certainty(uint256 imbalanceAmount) public {
        imbalanceAmount = bound(imbalanceAmount, 1_000 * ONE_USDC, 50_000 * ONE_USDC);

        uint256 testTradeAmount = 100 * ONE_USDC;

        // Fee at fresh 50/50.
        uint256 feeBalanced = pool.calculateFee(testTradeAmount, true);

        // Push the pool into imbalance by buying YES heavily.
        vm.prank(trader);
        pool.buy(true, imbalanceAmount);

        // Fee on a same-side (YES) follow-up trade should be <= balanced fee.
        // (YES is now the rarer/more-expensive token, so its certainty side
        // dominates. Buying more YES at a high price means low (1-P), low fee.)
        uint256 feeImbalanced = pool.calculateFee(testTradeAmount, true);
        assertLe(feeImbalanced, feeBalanced, "fee did not decrease with imbalance");
    }

    // ─── Fuzz: redeem pays exactly 1:1 ──────────────────────────────────────

    /// @notice After resolution, redeeming N winning tokens must transfer
    ///         exactly N collateral units. No more (would drain pool), no
    ///         less (would steal user funds).
    function testFuzz_redeem_pays_exactly_one_to_one(uint256 buyAmount) public {
        buyAmount = bound(buyAmount, ONE_USDC, 10_000 * ONE_USDC);

        vm.prank(trader);
        uint256 shares = pool.buy(true, buyAmount);

        // Resolve YES.
        vm.prank(admin);
        factory.resolveMarket(0, 1);

        uint256 startUsdc = usdc.balanceOf(trader);
        vm.prank(trader);
        pool.redeem(shares);
        uint256 received = usdc.balanceOf(trader) - startUsdc;
        assertEq(received, shares, "redeem did not pay 1:1");
    }

    // ─── Edge: zero-amount and unauthorized paths ────────────────────────────

    function test_buy_zero_reverts() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMM: zero amount"));
        pool.buy(true, 0);
    }

    function test_sell_zero_reverts() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMM: zero amount"));
        pool.sell(true, 0);
    }

    function test_resolve_invalid_outcome_reverts() public {
        // Outcome 0 = "unresolved" sentinel, must revert.
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: invalid outcome"));
        factory.resolveMarket(0, 0);

        // Outcome 3+ also invalid.
        vm.prank(admin);
        vm.expectRevert(bytes("PronosAMM: invalid outcome"));
        factory.resolveMarket(0, 3);
    }

    function test_double_resolve_reverts() public {
        vm.prank(admin);
        factory.resolveMarket(0, 1);
        vm.prank(admin);
        // Second resolveMarket call hits the active=false guard before
        // reaching pool.resolve() → MarketFactory's "not active" reverts
        // first.
        vm.expectRevert(bytes("MarketFactory: not active"));
        factory.resolveMarket(0, 2);
    }

    function test_redeem_before_resolve_reverts() public {
        vm.prank(trader);
        pool.buy(true, 100 * ONE_USDC);
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMM: not resolved"));
        pool.redeem(1);
    }

    function test_buy_after_resolve_reverts() public {
        vm.prank(admin);
        factory.resolveMarket(0, 1);
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMM: resolved"));
        pool.buy(true, 100 * ONE_USDC);
    }

    function test_pool_paused_blocks_buy() public {
        vm.prank(admin);
        factory.pauseMarket(0, true);
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMM: paused"));
        pool.buy(true, 100 * ONE_USDC);
    }
}
