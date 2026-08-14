// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PronosToken.sol";
import "../src/PronosAMM.sol";
import "../src/MarketFactory.sol";

contract MockUSDCFactoryFuzz {
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
 * @title MarketFactoryFuzz
 * @notice Property tests for MarketFactory: market creation, resolution
 *         lifecycle, and fee distribution math.
 *
 * High-risk surfaces:
 *   1. createMarket: seed transfer + AMM initialization atomicity
 *   2. distributeFees: 70/20/10 split across rounding edges (the
 *      emergency reserve gets the dust by design — fuzz to confirm
 *      no fees evaporate into rounding)
 *   3. resolveMarket: outcome lock, double-resolve prevention,
 *      access control (only resolver/owner)
 *   4. setX setters: events emit, zero-address checks
 */
contract MarketFactoryFuzzTest is Test {
    MockUSDCFactoryFuzz public usdc;
    PronosToken public token;
    MarketFactory public factory;

    address admin    = address(0xAD);
    address treasury = address(0x111);
    address liqRes   = address(0x222);
    address emerRes  = address(0x333);
    address feeColl  = address(0x444);
    address resolver = address(0x555);
    address random   = address(0x666);

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        vm.startPrank(admin);
        usdc = new MockUSDCFactoryFuzz();
        token = new PronosToken();
        factory = new MarketFactory(
            address(token), address(usdc), treasury, liqRes, emerRes
        );
        factory.setFeeCollector(feeColl);
        token.setMinter(address(factory), true);
        token.transferOwnership(address(factory));
        vm.stopPrank();

        usdc.mint(admin, 10_000_000 * ONE_USDC);
        usdc.mint(feeColl, 1_000_000 * ONE_USDC); // for distributeFees tests
    }

    // ─── Fuzz: distributeFees splits exactly 70/20/10 with no leak ───────────

    /// @notice Fee distribution must always sum exactly to the fee-collector
    ///         balance — no dust evaporates. Treasury gets floor(70%),
    ///         liquidity floor(20%), emergency takes the remainder
    ///         (= total - treasury - liquidity), which absorbs rounding.
    function testFuzz_distributeFees_no_dust(uint256 total) public {
        total = bound(total, 1, 1_000_000 * ONE_USDC);

        // Reset feeCollector balance to exactly `total`.
        uint256 prev = usdc.balanceOf(feeColl);
        if (prev > total) {
            vm.prank(feeColl);
            usdc.transfer(address(0xDEAD), prev - total);
        } else if (prev < total) {
            usdc.mint(feeColl, total - prev);
        }
        assertEq(usdc.balanceOf(feeColl), total, "setup balance off");

        vm.prank(feeColl);
        usdc.approve(address(factory), total);

        uint256 treasBefore = usdc.balanceOf(treasury);
        uint256 liqBefore   = usdc.balanceOf(liqRes);
        uint256 emerBefore  = usdc.balanceOf(emerRes);

        vm.prank(admin);
        factory.distributeFees();

        uint256 toTreas = usdc.balanceOf(treasury) - treasBefore;
        uint256 toLiq   = usdc.balanceOf(liqRes)   - liqBefore;
        uint256 toEmer  = usdc.balanceOf(emerRes)  - emerBefore;

        // Sum must equal total (no leak, no double-count).
        assertEq(toTreas + toLiq + toEmer, total, "fee distribution does not sum to total");
        // Splits within 1 unit of nominal 70/20/10 because of integer rounding.
        assertEq(toTreas, (total * 70) / 100, "treasury split off");
        assertEq(toLiq,   (total * 20) / 100, "liquidity split off");
        // Fee collector left with zero.
        assertEq(usdc.balanceOf(feeColl), 0, "fee collector not drained");
    }

    function test_distributeFees_zero_balance_reverts() public {
        // Drain feeCollector first.
        uint256 bal = usdc.balanceOf(feeColl);
        if (bal > 0) {
            vm.prank(feeColl);
            usdc.transfer(address(0xDEAD), bal);
        }
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: no fees"));
        factory.distributeFees();
    }

    // ─── Fuzz: createMarket lifecycle ────────────────────────────────────────

    function testFuzz_createMarket_succeeds(uint256 seedAmount, uint256 ttl) public {
        seedAmount = bound(seedAmount, ONE_USDC, 100_000 * ONE_USDC);
        ttl = bound(ttl, 1 hours, 365 days);

        vm.prank(admin);
        usdc.approve(address(factory), seedAmount);

        uint256 endTime = block.timestamp + ttl;
        vm.prank(admin);
        uint256 mid = factory.createMarket(
            "Q", "test", endTime, "manual", seedAmount
        );

        ( address pool, , , uint256 storedEnd, , bool active ) = factory.getMarket(mid);
        assertGt(uint160(uint160(pool)), 0, "pool not deployed");
        assertEq(storedEnd, endTime, "endTime mismatch");
        assertTrue(active, "not active");
        // Seed transferred into pool.
        assertEq(usdc.balanceOf(pool), seedAmount, "seed not transferred");
    }

    function test_createMarket_zero_seed_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero seed"));
        factory.createMarket("Q", "c", block.timestamp + 1 days, "manual", 0);
    }

    function test_createMarket_past_endtime_reverts() public {
        vm.prank(admin);
        usdc.approve(address(factory), ONE_USDC);
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: end time in past"));
        factory.createMarket("Q", "c", block.timestamp - 1, "manual", ONE_USDC);
    }

    function test_createMarket_only_creator_or_owner() public {
        vm.prank(random);
        vm.expectRevert(bytes("MarketFactory: not creator"));
        factory.createMarket("Q", "c", block.timestamp + 1 days, "manual", ONE_USDC);
    }

    // ─── Resolution access control + lifecycle ──────────────────────────────

    function _createOne() internal returns (uint256 mid) {
        vm.prank(admin);
        usdc.approve(address(factory), 1000 * ONE_USDC);
        vm.prank(admin);
        mid = factory.createMarket(
            "Q", "c", block.timestamp + 1 days, "manual", 1000 * ONE_USDC
        );
    }

    function test_resolveMarket_only_resolver_or_owner() public {
        uint256 mid = _createOne();
        vm.prank(random);
        vm.expectRevert(bytes("MarketFactory: not resolver"));
        factory.resolveMarket(mid, 1);
    }

    function test_resolveMarket_separate_resolver_works() public {
        uint256 mid = _createOne();
        vm.prank(admin);
        factory.setResolver(resolver);

        vm.prank(resolver);
        factory.resolveMarket(mid, 1);

        ( , , , , , bool active ) = factory.getMarket(mid);
        assertFalse(active, "still active after resolve");
    }

    function test_resolveMarket_flips_active_false() public {
        uint256 mid = _createOne();
        vm.prank(admin);
        factory.resolveMarket(mid, 1);
        ( , , , , , bool active ) = factory.getMarket(mid);
        assertFalse(active);
    }

    function test_resolveMarket_double_reverts() public {
        uint256 mid = _createOne();
        vm.prank(admin);
        factory.resolveMarket(mid, 1);
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: not active"));
        factory.resolveMarket(mid, 2);
    }

    function test_resolveMarket_invalid_market_id_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: invalid market"));
        factory.resolveMarket(999, 1);
    }

    // ─── Pause ───────────────────────────────────────────────────────────────

    function test_pauseMarket_flips_pool_paused() public {
        uint256 mid = _createOne();
        ( address pool, , , , , ) = factory.getMarket(mid);

        vm.prank(admin);
        factory.pauseMarket(mid, true);
        assertTrue(PronosAMM(pool).paused(), "pool not paused");

        vm.prank(admin);
        factory.pauseMarket(mid, false);
        assertFalse(PronosAMM(pool).paused(), "pool still paused");
    }

    function test_pauseMarket_only_owner() public {
        uint256 mid = _createOne();
        vm.prank(random);
        vm.expectRevert(bytes("MarketFactory: not owner"));
        factory.pauseMarket(mid, true);
    }

    // ─── Setters emit events + reject zero address ───────────────────────────

    function test_setFeeCollector_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero address"));
        factory.setFeeCollector(address(0));
    }
    function test_setTreasury_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero address"));
        factory.setTreasury(address(0));
    }
    function test_setLiquidityReserve_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero address"));
        factory.setLiquidityReserve(address(0));
    }
    function test_setEmergencyReserve_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero address"));
        factory.setEmergencyReserve(address(0));
    }

    function test_setFeeCollector_emits_event() public {
        address newCollector = address(0xABCD);
        vm.expectEmit(true, true, false, false, address(factory));
        emit MarketFactory.FeeCollectorUpdated(feeColl, newCollector);
        vm.prank(admin);
        factory.setFeeCollector(newCollector);
    }
    function test_setTreasury_emits_event() public {
        address newT = address(0xBEEF);
        vm.expectEmit(true, true, false, false, address(factory));
        emit MarketFactory.TreasuryUpdated(treasury, newT);
        vm.prank(admin);
        factory.setTreasury(newT);
    }

    // ─── Ownership transfer ─────────────────────────────────────────────────

    function test_transferOwnership_works() public {
        address newOwner = address(0xCAFE);
        vm.prank(admin);
        factory.transferOwnership(newOwner);
        assertEq(factory.owner(), newOwner);
        // Old owner can no longer act.
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: not owner"));
        factory.setTreasury(address(0xBABE));
        // New owner can.
        vm.prank(newOwner);
        factory.setTreasury(address(0xBABE));
        assertEq(factory.treasury(), address(0xBABE));
    }

    function test_transferOwnership_zero_reverts() public {
        vm.prank(admin);
        vm.expectRevert(bytes("MarketFactory: zero address"));
        factory.transferOwnership(address(0));
    }
}
