// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PronoBet.sol";

/// @dev Minimal mock USDC for testing
contract MockUSDC {
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
        balanceOf[to]         += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        balanceOf[from]              -= amount;
        allowance[from][msg.sender]  -= amount;
        balanceOf[to]                += amount;
        return true;
    }
}

contract PronoBetTest is Test {
    PronoBet  public pronoBet;
    MockUSDC  public usdc;

    address admin  = address(0xAD);
    address alice  = address(0xA);
    address bob    = address(0xB);
    address carol  = address(0xC);

    uint256 constant ONE_USDC = 1e6;

    function setUp() public {
        usdc     = new MockUSDC();
        pronoBet = new PronoBet(address(usdc), admin);

        // Mint USDC for users
        usdc.mint(alice, 1000 * ONE_USDC);
        usdc.mint(bob,   1000 * ONE_USDC);
        usdc.mint(carol, 1000 * ONE_USDC);

        // Approve contract
        vm.prank(alice); usdc.approve(address(pronoBet), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(pronoBet), type(uint256).max);
        vm.prank(carol); usdc.approve(address(pronoBet), type(uint256).max);
    }

    // ─── Basic bet placement ───────────────────────────────────────────────────

    function test_placeBet_mexico() public {
        vm.prank(alice);
        pronoBet.placeBet(1, 100 * ONE_USDC);

        assertEq(pronoBet.totalPool(), 100 * ONE_USDC);
        assertEq(pronoBet.outcomePool(1), 100 * ONE_USDC);
    }

    function test_placeBet_all_outcomes() public {
        vm.prank(alice); pronoBet.placeBet(1, 100 * ONE_USDC); // Mexico
        vm.prank(bob);   pronoBet.placeBet(2, 50  * ONE_USDC); // Draw
        vm.prank(carol); pronoBet.placeBet(3, 25  * ONE_USDC); // SA

        assertEq(pronoBet.totalPool(), 175 * ONE_USDC);
        assertEq(pronoBet.outcomePool(1), 100 * ONE_USDC);
        assertEq(pronoBet.outcomePool(2),  50 * ONE_USDC);
        assertEq(pronoBet.outcomePool(3),  25 * ONE_USDC);
    }

    function test_placeBet_reverts_invalid_outcome() public {
        vm.prank(alice);
        vm.expectRevert("PronoBet: invalid outcome (use 1, 2 or 3)");
        pronoBet.placeBet(0, 100 * ONE_USDC);
    }

    function test_placeBet_reverts_below_min() public {
        vm.prank(alice);
        vm.expectRevert("PronoBet: minimum bet is 1 USDC");
        pronoBet.placeBet(1, ONE_USDC - 1);
    }

    // ─── Resolution ───────────────────────────────────────────────────────────

    function test_resolve() public {
        vm.prank(admin);
        pronoBet.resolve(1);

        assertEq(pronoBet.resolved(), true);
        assertEq(pronoBet.result(), 1);
        assertEq(pronoBet.bettingOpen(), false);
    }

    function test_resolve_reverts_non_owner() public {
        vm.prank(alice);
        vm.expectRevert("PronoBet: not owner");
        pronoBet.resolve(1);
    }

    function test_resolve_reverts_twice() public {
        vm.prank(admin); pronoBet.resolve(1);
        vm.prank(admin);
        vm.expectRevert("PronoBet: already resolved");
        pronoBet.resolve(1);
    }

    // ─── Claim winnings ───────────────────────────────────────────────────────

    function test_claimWinnings_mexico_wins() public {
        // Alice bets $100 on Mexico (outcome 1)
        // Bob bets $50 on Draw (outcome 2)
        // Carol bets $25 on SA (outcome 3)
        vm.prank(alice); pronoBet.placeBet(1, 100 * ONE_USDC);
        vm.prank(bob);   pronoBet.placeBet(2,  50 * ONE_USDC);
        vm.prank(carol); pronoBet.placeBet(3,  25 * ONE_USDC);

        uint256 total = 175 * ONE_USDC;
        uint256 fee   = total * 200 / 10_000; // 2% = 3.5 USDC
        uint256 net   = total - fee;           // 171.5 USDC

        // Admin resolves: Mexico wins
        vm.prank(admin); pronoBet.resolve(1);

        // Alice was the only Mexico bettor — she gets the full net pool
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice); pronoBet.claimWinnings();
        uint256 aliceAfter = usdc.balanceOf(alice);

        // Alice bet 100 USDC, her share = 100/100 * 171.5 = 171.5 USDC
        assertApproxEqAbs(aliceAfter - aliceBefore, net, 1);
    }

    function test_claimWinnings_reverts_loser() public {
        vm.prank(alice); pronoBet.placeBet(1, 100 * ONE_USDC);
        vm.prank(bob);   pronoBet.placeBet(2,  50 * ONE_USDC);

        vm.prank(admin); pronoBet.resolve(1); // Mexico wins

        vm.prank(bob);
        vm.expectRevert("PronoBet: nothing to claim");
        pronoBet.claimWinnings();
    }

    function test_claimWinnings_reverts_before_resolution() public {
        vm.prank(alice); pronoBet.placeBet(1, 100 * ONE_USDC);

        vm.prank(alice);
        vm.expectRevert("PronoBet: not resolved yet");
        pronoBet.claimWinnings();
    }

    // ─── Odds ─────────────────────────────────────────────────────────────────

    function test_getOdds_default() public view {
        (uint256 mx, uint256 dr, uint256 sa) = pronoBet.getOdds();
        assertEq(mx + dr + sa, 10_000); // default: equal thirds
    }

    function test_getOdds_after_bets() public {
        vm.prank(alice); pronoBet.placeBet(1, 67 * ONE_USDC);
        vm.prank(bob);   pronoBet.placeBet(2, 18 * ONE_USDC);
        vm.prank(carol); pronoBet.placeBet(3, 15 * ONE_USDC);

        (uint256 mx, uint256 dr, uint256 sa) = pronoBet.getOdds();
        // Rough checks: Mexico should be the highest
        assertTrue(mx > dr);
        assertTrue(mx > sa);
    }

    // ─── Admin: close betting ─────────────────────────────────────────────────

    function test_closeBetting() public {
        vm.prank(admin); pronoBet.closeBetting();
        assertEq(pronoBet.bettingOpen(), false);

        vm.prank(alice);
        vm.expectRevert("PronoBet: betting is closed");
        pronoBet.placeBet(1, 100 * ONE_USDC);
    }
}
