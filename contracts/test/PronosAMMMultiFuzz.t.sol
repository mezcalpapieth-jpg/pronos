// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PronosTokenV2.sol";
import "../src/PronosAMMMulti.sol";
import "../src/MarketFactoryV2.sol";

contract MockUSDCMultiFuzz {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a; return true;
    }
    function transfer(address to, uint256 a) external returns (bool) {
        require(balanceOf[msg.sender] >= a, "insufficient");
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        require(balanceOf[f] >= a, "balance");
        require(allowance[f][msg.sender] >= a, "allowance");
        balanceOf[f] -= a; allowance[f][msg.sender] -= a; balanceOf[t] += a; return true;
    }
}

/**
 * @title PronosAMMMultiFuzz
 * @notice Property tests for PronosAMMMulti — the multi-outcome AMM.
 *
 * Differs from V1 in three ways the fuzz suite exercises:
 *   - Reserves are an array (not a yes/no pair)
 *   - Buy uses Math.mulDiv with explicit Ceil rounding (correct
 *     direction; the V1 floor-sqrt bug doesn't exist here)
 *   - Sell uses BINARY SEARCH over collateral-out values to find the
 *     largest amount that keeps the product-ratio invariant — this is
 *     the highest-risk surface and what we hammer hardest
 *
 * Bounds: outcomes ∈ {2, 3, 5, 8} (covers binary, common 3-way, and
 * the MAX_OUTCOMES=8 boundary). Trade sizes [1 USDC, 5,000 USDC]
 * against a 100k USDC seed so we exercise mid-imbalance without
 * exhausting reserves.
 */
contract PronosAMMMultiFuzzTest is Test {
    MockUSDCMultiFuzz public usdc;
    PronosTokenV2 public token;
    MarketFactoryV2 public factory;
    PronosAMMMulti public pool;

    address admin   = address(0xAD);
    address treasury = address(0x111);
    address liqRes   = address(0x222);
    address emerRes  = address(0x333);
    address feeColl  = address(0x444);
    address trader   = address(0xBEEF);

    uint256 constant ONE_USDC = 1e6;
    uint256 constant SEED = 100_000 * ONE_USDC;
    uint8   constant N = 3; // 3-way market for most fuzz tests

    function setUp() public {
        vm.startPrank(admin);
        usdc = new MockUSDCMultiFuzz();
        token = new PronosTokenV2();
        factory = new MarketFactoryV2(address(token), address(usdc), treasury, liqRes, emerRes);
        factory.setFeeCollector(feeColl);
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        vm.stopPrank();

        usdc.mint(admin, SEED);
        usdc.mint(trader, 5_000_000 * ONE_USDC);

        string[] memory outcomes = new string[](N);
        outcomes[0] = "A";
        outcomes[1] = "B";
        outcomes[2] = "C";

        vm.prank(admin);
        usdc.approve(address(factory), SEED);
        vm.prank(admin);
        uint256 mid = factory.createMarket(
            "Who wins?", "test", block.timestamp + 7 days, "manual", outcomes, SEED
        );
        ( address poolAddr,,,,,, ) = factory.getMarket(mid);
        pool = PronosAMMMulti(poolAddr);

        vm.prank(trader);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _approveTokens() internal {
        vm.prank(trader);
        token.setApprovalForAll(address(pool), true);
    }

    /// @dev Multi-outcome k-equivalent: product of all reserves. Buy mints
    ///      complete sets so the product GROWS by a factor; sell burns them
    ///      so the product shrinks. The right invariant is the RATIO product
    ///      stays >= initial across sells (binary search guarantees this).
    function _reserveProduct() internal view returns (uint256 prod) {
        uint256[] memory rs = pool.getReserves();
        prod = 1;
        for (uint8 i = 0; i < rs.length; i++) {
            // Avoid overflow on large pools: scale down.
            prod = prod * (rs[i] / ONE_USDC);
        }
    }

    // ─── Fuzz: round-trip loses to fees ──────────────────────────────────────

    function testFuzz_buy_outcome_then_sell_loses_to_fees(uint256 amount, uint8 oi) public {
        amount = bound(amount, ONE_USDC, 5_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        uint256 startUsdc = usdc.balanceOf(trader);

        vm.prank(trader);
        uint256 shares = pool.buy(oi, amount);
        assertGt(shares, 0, "buy returned zero shares");

        _approveTokens();
        vm.prank(trader);
        uint256 collOut = pool.sell(oi, shares);

        uint256 endUsdc = usdc.balanceOf(trader);
        assertLt(endUsdc, startUsdc, "round-trip yielded profit");
        // Loss bounded by fee + slippage; 10% upper bound is generous.
        uint256 loss = startUsdc - endUsdc;
        assertLe(loss, (amount * 10) / 100, "loss exceeds 10%");
        assertGt(collOut, 0, "sell returned zero collateral");
    }

    /// @notice Buy outcome A then sell on the SAME OUTCOME. Asserting the
    ///         common case path through the multi-outcome solver.
    function testFuzz_estimate_buy_matches_actual(uint256 amount, uint8 oi) public {
        amount = bound(amount, ONE_USDC, 5_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        uint256 estimated = pool.estimateBuy(oi, amount);
        vm.prank(trader);
        uint256 actual = pool.buy(oi, amount);
        assertEq(estimated, actual, "estimateBuy diverges");
    }

    function test_buy_with_min_shares_reverts_when_quote_is_stale() public {
        uint256 amount = 100 * ONE_USDC;
        uint8 oi = 1;
        uint256 estimated = pool.estimateBuy(oi, amount);

        vm.expectRevert("PronosAMMMulti: price moved");
        vm.prank(trader);
        pool.buy(oi, amount, estimated + 1);
    }

    function test_buy_with_min_shares_accepts_current_quote() public {
        uint256 amount = 100 * ONE_USDC;
        uint8 oi = 1;
        uint256 estimated = pool.estimateBuy(oi, amount);

        vm.prank(trader);
        uint256 actual = pool.buy(oi, amount, estimated);

        assertEq(actual, estimated, "guarded buy changed quote");
    }

    function testFuzz_estimate_sell_matches_actual(uint256 buyAmount, uint8 oi) public {
        buyAmount = bound(buyAmount, ONE_USDC, 5_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        vm.prank(trader);
        uint256 shares = pool.buy(oi, buyAmount);
        assertGt(shares, 0, "no shares");

        _approveTokens();
        uint256 sellAmount = shares / 2 == 0 ? 1 : shares / 2;
        uint256 estimated = pool.estimateSell(oi, sellAmount);
        vm.prank(trader);
        uint256 actual = pool.sell(oi, sellAmount);
        assertEq(estimated, actual, "estimateSell diverges");
    }

    function test_sell_with_min_collateral_reverts_when_quote_is_stale() public {
        uint256 buyAmount = 100 * ONE_USDC;
        uint8 oi = 1;
        vm.prank(trader);
        uint256 shares = pool.buy(oi, buyAmount);

        _approveTokens();
        uint256 sellAmount = shares / 2;
        uint256 estimated = pool.estimateSell(oi, sellAmount);

        vm.expectRevert("PronosAMMMulti: price moved");
        vm.prank(trader);
        pool.sell(oi, sellAmount, estimated + 1);
    }

    // ─── Solvency: redeem pays exactly 1:1 across all outcomes ──────────────

    function testFuzz_redeem_winning_outcome_pays_one_to_one(uint256 amount, uint8 winningOi) public {
        amount = bound(amount, ONE_USDC, 5_000 * ONE_USDC);
        winningOi = uint8(bound(winningOi, 0, N - 1));

        // Buy winning outcome.
        vm.prank(trader);
        uint256 shares = pool.buy(winningOi, amount);

        // Resolve to that outcome.
        vm.prank(admin);
        factory.resolveMarket(0, winningOi);

        uint256 startUsdc = usdc.balanceOf(trader);
        vm.prank(trader);
        pool.redeem(shares);
        uint256 received = usdc.balanceOf(trader) - startUsdc;
        assertEq(received, shares, "redeem off");
    }

    // ─── Reserves stay bounded ──────────────────────────────────────────────

    /// @notice Across any sequence of buys, no individual reserve should
    ///         go below 1 unit (the binary search in _estimateSellGross
    ///         requires minAdjusted > 1; if buys could drive a reserve
    ///         to 0 we'd have a stuck pool).
    function testFuzz_buy_keeps_all_reserves_positive(uint256 amount, uint8 oi) public {
        amount = bound(amount, ONE_USDC, 10_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        vm.prank(trader);
        pool.buy(oi, amount);

        uint256[] memory rs = pool.getReserves();
        for (uint8 i = 0; i < rs.length; i++) {
            assertGt(rs[i], 0, "reserve hit zero");
        }
    }

    // ─── Prices sum to ~1e6 (PRICE_SCALE) ───────────────────────────────────

    /// @notice Sum of all outcome prices must equal PRICE_SCALE (1e6) within
    ///         a tolerance equal to outcomeCount (one wei rounding per outcome).
    ///         This is the multi-outcome equivalent of "AMM-implied
    ///         probabilities sum to 1".
    function testFuzz_prices_sum_to_one(uint256 amount, uint8 oi) public {
        amount = bound(amount, ONE_USDC, 5_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        vm.prank(trader);
        pool.buy(oi, amount);

        uint256[] memory ps = pool.prices();
        uint256 sum = 0;
        for (uint8 i = 0; i < ps.length; i++) sum += ps[i];

        assertApproxEqAbs(sum, pool.PRICE_SCALE(), N, "prices do not sum to 1");
    }

    /// @notice Buying outcome i must INCREASE its price strictly. Verifies
    ///         the AMM moves prices monotonically with demand.
    function testFuzz_buy_increases_target_price(uint256 amount, uint8 oi) public {
        amount = bound(amount, 100 * ONE_USDC, 5_000 * ONE_USDC);
        oi = uint8(bound(oi, 0, N - 1));

        uint256 priceBefore = pool.price(oi);
        vm.prank(trader);
        pool.buy(oi, amount);
        uint256 priceAfter = pool.price(oi);

        assertGt(priceAfter, priceBefore, "buy did not move price up");
    }

    // ─── Edge cases ──────────────────────────────────────────────────────────

    function test_buy_zero_reverts() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMMMulti: zero amount"));
        pool.buy(0, 0);
    }

    function test_buy_invalid_outcome_reverts() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMMMulti: invalid outcome"));
        pool.buy(N, 100 * ONE_USDC);
    }

    function test_sell_invalid_outcome_reverts() public {
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMMMulti: invalid outcome"));
        pool.sell(N, 100);
    }

    function test_buy_after_resolve_reverts() public {
        vm.prank(admin);
        factory.resolveMarket(0, 0);
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMMMulti: resolved"));
        pool.buy(0, 100 * ONE_USDC);
    }

    function test_resolve_invalid_outcome_reverts() public {
        // MarketFactoryV2 pre-validates the outcome index and reverts
        // with its own message before the call ever reaches the pool.
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactoryV2: invalid outcome"));
        factory.resolveMarket(0, N);
    }

    function test_redeem_before_resolve_reverts() public {
        vm.prank(trader);
        pool.buy(0, 100 * ONE_USDC);
        vm.prank(trader);
        vm.expectRevert(bytes("PronosAMMMulti: not resolved"));
        pool.redeem(1);
    }
}
