// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TournamentMXNP.sol";

contract TournamentMXNPTest is Test {
    TournamentMXNP public token;

    address owner = address(0xA11CE);
    address alice = address(0xA);
    address bob = address(0xB);

    uint256 constant ONE_MXNP = 1e6;

    function setUp() public {
        token = new TournamentMXNP(owner);
    }

    function test_metadataUsesTournamentBranding() public {
        assertEq(token.name(), "Tournament MXNP");
        assertEq(token.symbol(), "MXNP");
        assertEq(token.decimals(), 6);
        assertEq(token.owner(), owner);
    }

    function test_ownerCanMintResetAllocation() public {
        vm.prank(owner);
        token.mint(alice, 500 * ONE_MXNP);

        assertEq(token.balanceOf(alice), 500 * ONE_MXNP);
        assertEq(token.totalSupply(), 500 * ONE_MXNP);
    }

    function test_nonOwnerCannotMint() public {
        vm.expectRevert("TournamentMXNP: not owner");
        vm.prank(alice);
        token.mint(alice, 500 * ONE_MXNP);
    }

    function test_ownerCanBatchMintTournamentWallets() public {
        address[] memory recipients = new address[](2);
        recipients[0] = alice;
        recipients[1] = bob;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 500 * ONE_MXNP;
        amounts[1] = 750 * ONE_MXNP;

        vm.prank(owner);
        token.batchMint(recipients, amounts);

        assertEq(token.balanceOf(alice), 500 * ONE_MXNP);
        assertEq(token.balanceOf(bob), 750 * ONE_MXNP);
        assertEq(token.totalSupply(), 1_250 * ONE_MXNP);
    }

    function test_ownerCanTransferOwnership() public {
        vm.prank(owner);
        token.transferOwnership(bob);

        assertEq(token.owner(), bob);

        vm.expectRevert("TournamentMXNP: not owner");
        vm.prank(owner);
        token.mint(alice, ONE_MXNP);

        vm.prank(bob);
        token.mint(alice, ONE_MXNP);
        assertEq(token.balanceOf(alice), ONE_MXNP);
    }
}
