// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MarketFeeVault} from "../src/MarketFeeVault.sol";
import {MainnetResolutionReview} from "../src/MainnetResolutionReview.sol";
import {
    MarketFactory,
    MarketFactoryV2,
    PronosAMM,
    PronosAMMMulti,
    PronosMainnetTradingRouter,
    PronosToken,
    PronosTokenV2,
    PronosTradingRouter
} from "../src/PronosTradingRouter.sol";

interface IRehearsalFactory {
    function proposeResolution(uint256 id, uint8 outcome, bytes32 evidenceHash) external;
    function openResolutionDispute(uint256 id) external;
    function clearResolutionDispute(uint256 id) external;
    function proposeResolutionCorrection(uint256 id, bytes32 proposalId, uint8 outcome, bytes32 evidenceHash) external;
    function approveResolution(uint256 id, bytes32 proposalId) external;
    function flagResolution(uint256 id, bytes32 proposalId, bytes32 objectionHash) external;
    function resolutionProposals(uint256 id) external view returns (bytes32, bytes32, address, uint64, uint8, bool);
    function finalizeResolution(uint256 id, bytes32 proposalId) external;
    function sweepDust(uint256 id, address recipient) external;
    function pushRedeem(uint256 id, address[] calldata holders, uint256[] calldata amounts) external;
    function cancelMarket(uint256 id) external;
    function distributeFees() external;
    function distributeMarketFees(uint256 id, bytes32 batchId, uint256 amount) external;
    function feeVault() external view returns (MarketFeeVault);
    function pushCancelRefund(
        uint256 id, address[] calldata holders, uint8[][] calldata outcomes,
        uint256[][] calldata shares, uint256[] calldata payouts
    ) external;
}

interface IRehearsalPool {
    function redeem(uint256 amount) external;
    function disputed() external view returns (bool);
    function finalized() external view returns (bool);
    function totalFeesCollected() external view returns (uint256);
    function totalRedeemed() external view returns (uint256);
    function totalRecovered() external view returns (uint256);
}

contract ArbitrumOneMXNBForkTest is Test {
    uint256 private constant FORK_BLOCK = 522521132;
    // Fund test wallets by executing real MXNB transfers from a historical
    // holder on the fork. The private key is neither known nor used.
    address private constant MXNB_HOLDER = 0x58b704065B7aFF3ED351052f8560019E05925023;
    IERC20Metadata private constant MXNB = IERC20Metadata(0xF197FFC28c23E0309B5559e7a166f2c6164C80aA);
    uint256 private constant SEED = 1_000e6;
    uint256 private constant ORDER = 100e6;
    bytes32 private constant RULES_HASH = keccak256("Fork rules document");
    bytes32 private constant EVIDENCE_HASH = keccak256("Fork evidence document");
    address private trader = makeAddr("trader");
    address private resolver = makeAddr("resolver");
    address private reviewer = makeAddr("reviewer");
    address private treasury = makeAddr("treasury");
    address private liquidity = makeAddr("liquidity");
    address private emergency = makeAddr("emergency");
    PronosToken private binaryShares;
    PronosTokenV2 private multiShares;
    MarketFactory private v1;
    MarketFactoryV2 private v2;
    PronosMainnetTradingRouter private router;

    struct Market {
        IRehearsalFactory factory;
        address pool;
        uint256 id;
        uint256 close;
        uint8 side;
        uint8 outcome;
        bool binary;
    }

    function setUp() public {
        string memory rpc = vm.envOr("ARBITRUM_ONE_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true, "Set ARBITRUM_ONE_FORK_RPC for the MXNB fork rehearsal");
        vm.createSelectFork(rpc, vm.envOr("ARBITRUM_ONE_FORK_BLOCK", FORK_BLOCK));
        assertEq(block.chainid, 42161);
        assertEq(MXNB.decimals(), 6);
        assertEq(MXNB.symbol(), "MXNB");

        binaryShares = new PronosToken();
        multiShares = new PronosTokenV2();
        v1 = new MarketFactory(address(binaryShares), address(MXNB), treasury, liquidity, emergency);
        v2 = new MarketFactoryV2(address(multiShares), address(MXNB), treasury, liquidity, emergency);
        v1.setResolver(resolver);
        v2.setResolver(resolver);
        v1.setResolutionReviewer(reviewer);
        v2.setResolutionReviewer(reviewer);
        binaryShares.setMinter(address(v1), true);
        binaryShares.transferOwnership(address(v1));
        multiShares.setMinter(address(v2), true);
        multiShares.transferOwnership(address(v2));
        router = new PronosMainnetTradingRouter(address(v1), address(v2));
        v1.setTradingRouter(address(router));
        v2.setTradingRouter(address(router));

        vm.startPrank(MXNB_HOLDER);
        assertTrue(MXNB.transfer(address(this), 10_000e6));
        assertTrue(MXNB.transfer(trader, 1_000e6));
        vm.stopPrank();
        assertTrue(MXNB.approve(address(v1), type(uint256).max));
        assertTrue(MXNB.approve(address(v2), type(uint256).max));
        vm.startPrank(trader);
        assertTrue(MXNB.approve(address(router), type(uint256).max));
        binaryShares.setApprovalForAll(address(router), true);
        multiShares.setApprovalForAll(address(router), true);
        vm.stopPrank();
    }

    function test_binaryTradeAndRedeem() public { _tradeAndRedeem(_market(true)); }
    function test_multiTradeAndRedeem() public { _tradeAndRedeem(_market(false)); }
    function test_binaryCancelRefundCannotPayTwice() public { _cancelAndRefund(_market(true)); }
    function test_multiCancelRefundCannotPayTwice() public { _cancelAndRefund(_market(false)); }
    function test_binaryFeesDistributeOnlyEarnedAmounts() public { _fees(true); }
    function test_multiFeesDistributeOnlyEarnedAmounts() public { _fees(false); }
    function test_binaryRecoveryRejectsShortfall() public { _recoveryRejectsShortfall(_market(true)); }
    function test_multiRecoveryRejectsShortfall() public { _recoveryRejectsShortfall(_market(false)); }
    function test_binaryRequiresIndependentReviewAndCutoff() public { _requiresReviewAndCutoff(_market(true)); }
    function test_multiRequiresIndependentReviewAndCutoff() public { _requiresReviewAndCutoff(_market(false)); }

    function test_reviewCannotBeBypassedAtCreationOrByChangingRoles() public {
        uint256 close = block.timestamp + 1 days;
        vm.expectRevert(MainnetResolutionReview.ReviewedResolutionRequired.selector);
        v1.createMarket("Legacy", "test", close, "Manual", SEED);

        MainnetResolutionReview.ReviewedMarketInput memory input = MainnetResolutionReview.ReviewedMarketInput(
            "No rules", "test", close, "Manual", SEED, bytes32(0)
        );
        vm.expectRevert(MainnetResolutionReview.MissingReviewHash.selector);
        v1.createReviewedMarket(input);

        MarketFactory unconfigured = new MarketFactory(address(binaryShares), address(MXNB), treasury, liquidity, emergency);
        input.rulesHash = RULES_HASH;
        vm.expectRevert(MainnetResolutionReview.ReviewUnavailable.selector);
        unconfigured.createReviewedMarket(input);
        input.resolutionSource = "";
        vm.expectRevert(MainnetResolutionReview.MissingResolutionSource.selector);
        v1.createReviewedMarket(input);

        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        v1.setResolver(reviewer);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        v2.transferOwnership(reviewer);
        vm.expectRevert(MainnetResolutionReview.ReviewUnavailable.selector);
        v2.setResolutionReviewer(trader);
    }

    function test_walletFlagIsPublicAndReviewerCanBlockFinalization() public {
        Market memory m = _market(true);
        Market memory other = _market(false);
        bytes32 proposal = _propose(m, m.outcome);
        bytes32 otherProposal = _propose(other, other.outcome);
        assertNotEq(proposal, otherProposal);
        vm.prank(reviewer);
        vm.expectRevert(MainnetResolutionReview.StaleResolutionProposal.selector);
        other.factory.approveResolution(other.id, proposal);
        _approve(m, proposal);

        bytes32 objection = keccak256("Source contradicts proposed outcome");
        vm.expectEmit(true, true, true, true, address(m.factory));
        emit MainnetResolutionReview.ResolutionFlagged(m.id, proposal, trader, objection);
        vm.prank(trader);
        m.factory.flagResolution(m.id, proposal, objection);
        assertFalse(IRehearsalPool(m.pool).disputed());

        vm.prank(trader);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        m.factory.openResolutionDispute(m.id);
        vm.prank(reviewer);
        m.factory.openResolutionDispute(m.id);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(MainnetResolutionReview.ReviewUnavailable.selector);
        m.factory.finalizeResolution(m.id, proposal);
    }

    function test_pendingPayoutLeavesWalletMXNBUsable() public {
        Market memory pending = _market(true);
        uint256 shares = _buy(pending);
        _propose(pending, pending.outcome);
        uint256 available = MXNB.balanceOf(trader);

        address externalWallet = makeAddr("external wallet");
        vm.prank(trader);
        assertTrue(MXNB.transfer(externalWallet, 20e6));
        assertEq(MXNB.balanceOf(externalWallet), 20e6);
        _buy(_market(false));
        assertEq(MXNB.balanceOf(trader), available - 20e6 - ORDER);
        assertEq(_shares(pending), shares);
    }

    function test_clearedDisputeRestartsChallengePeriod() public {
        Market memory m = _market(true);
        bytes32 original = _propose(m, m.outcome);
        _approve(m, original);
        vm.warp(block.timestamp + 1 days);
        m.factory.openResolutionDispute(m.id);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        m.factory.clearResolutionDispute(m.id);
        vm.prank(reviewer);
        m.factory.clearResolutionDispute(m.id);
        bytes32 restarted = _proposalId(m);
        assertNotEq(original, restarted);
        vm.expectRevert(MainnetResolutionReview.StaleResolutionProposal.selector);
        m.factory.finalizeResolution(m.id, original);
        vm.expectRevert(MainnetResolutionReview.ResolutionApprovalRequired.selector);
        m.factory.finalizeResolution(m.id, restarted);
        _approve(m, restarted);
        vm.expectRevert(_poolError(m, "challenge period"));
        m.factory.finalizeResolution(m.id, restarted);
        vm.warp(block.timestamp + 1 days);
        m.factory.finalizeResolution(m.id, restarted);
        assertTrue(IRehearsalPool(m.pool).finalized());
    }

    function test_routerChainAndCollateralGuards() public {
        vm.expectRevert("Router: Sepolia only");
        new PronosTradingRouter(address(v1), address(v2));
        MarketFactory other = new MarketFactory(address(binaryShares), address(1), treasury, liquidity, emergency);
        vm.expectRevert("Router: collateral mismatch");
        new PronosMainnetTradingRouter(address(other), address(v2));
        MarketFactoryV2 otherV2 = new MarketFactoryV2(address(multiShares), address(1), treasury, liquidity, emergency);
        vm.expectRevert("Router: official MXNB required");
        new PronosMainnetTradingRouter(address(other), address(otherV2));
        vm.chainId(421614);
        vm.expectRevert("Router: Arbitrum One only");
        new PronosMainnetTradingRouter(address(v1), address(v2));
    }

    function _market(bool binary) private returns (Market memory m) {
        m.binary = binary;
        m.close = block.timestamp + 1 days;
        MainnetResolutionReview.ReviewedMarketInput memory input = MainnetResolutionReview.ReviewedMarketInput(
            "Fork rehearsal", "test", m.close, "Manual", SEED, RULES_HASH
        );
        if (binary) {
            m.factory = IRehearsalFactory(address(v1));
            m.outcome = 1;
            m.id = v1.createReviewedMarket(input);
            (m.pool,,,,,) = v1.getMarket(m.id);
            assertEq(v1.resolutionRulesHash(m.id), RULES_HASH);
        } else {
            m.factory = IRehearsalFactory(address(v2));
            m.side = 2;
            m.outcome = 2;
            string[] memory outcomes = new string[](3);
            outcomes[0] = "A";
            outcomes[1] = "B";
            outcomes[2] = "C";
            m.id = v2.createReviewedMarket(input, outcomes);
            (m.pool,,,,,,) = v2.getMarket(m.id);
            assertEq(v2.resolutionRulesHash(m.id), RULES_HASH);
        }
        assertEq(MXNB.balanceOf(m.pool), SEED);
    }

    function _proposalId(Market memory m) private view returns (bytes32 id) {
        (id,,,,,) = m.factory.resolutionProposals(m.id);
    }

    function _propose(Market memory m, uint8 outcome) private returns (bytes32) {
        if (block.timestamp < m.close) vm.warp(m.close);
        vm.prank(resolver);
        m.factory.proposeResolution(m.id, outcome, EVIDENCE_HASH);
        return _proposalId(m);
    }

    function _approve(Market memory m, bytes32 proposalId) private {
        vm.prank(reviewer);
        m.factory.approveResolution(m.id, proposalId);
    }

    function _requiresReviewAndCutoff(Market memory m) private {
        uint256 shares = _buy(m);
        vm.prank(resolver);
        vm.expectRevert(abi.encodeWithSignature(
            "Error(string)", m.binary ? "MarketFactory: market still open" : "MarketFactoryV2: market still open"
        ));
        m.factory.proposeResolution(m.id, m.outcome, EVIDENCE_HASH);
        vm.warp(m.close);
        if (m.binary) {
            vm.expectRevert(_poolError(m, "market closed"));
            PronosAMM(m.pool).buy(true, ORDER);
            vm.expectRevert(_poolError(m, "market closed"));
            PronosAMM(m.pool).sell(true, shares);
            vm.expectRevert(MainnetResolutionReview.ReviewedResolutionRequired.selector);
            v1.resolveMarket(m.id, m.outcome);
        } else {
            vm.expectRevert(_poolError(m, "market closed"));
            PronosAMMMulti(m.pool).buy(m.side, ORDER);
            vm.expectRevert(_poolError(m, "market closed"));
            PronosAMMMulti(m.pool).sell(m.side, shares);
            vm.expectRevert(MainnetResolutionReview.ReviewedResolutionRequired.selector);
            v2.resolveMarket(m.id, m.outcome);
        }
        vm.expectRevert("Router: market closed");
        router.buy(m.pool, m.side, ORDER, 1);
        vm.expectRevert("Router: market closed");
        router.sell(m.pool, m.side, shares, 1);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        m.factory.proposeResolution(m.id, m.outcome, EVIDENCE_HASH);
        vm.prank(resolver);
        vm.expectRevert(MainnetResolutionReview.MissingReviewHash.selector);
        m.factory.proposeResolution(m.id, m.outcome, bytes32(0));
        bytes32 proposal = _propose(m, m.binary ? 2 : 0);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(MainnetResolutionReview.ResolutionApprovalRequired.selector);
        m.factory.finalizeResolution(m.id, proposal);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        m.factory.approveResolution(m.id, proposal);
        vm.prank(resolver);
        vm.expectRevert(MainnetResolutionReview.InvalidReviewRole.selector);
        m.factory.approveResolution(m.id, proposal);
    }

    function _shares(Market memory m) private view returns (uint256) {
        return m.binary
            ? binaryShares.balanceOf(trader, binaryShares.yesTokenId(m.id))
            : multiShares.balanceOf(trader, multiShares.tokenId(m.id, m.side));
    }

    function _winningSupply(Market memory m) private view returns (uint256) {
        return m.binary
            ? binaryShares.totalSupply(binaryShares.yesTokenId(m.id))
            : multiShares.totalSupply(multiShares.tokenId(m.id, m.side));
    }

    function _buy(Market memory m) private returns (uint256 bought) {
        uint256 balance = MXNB.balanceOf(trader);
        uint256 quote = m.binary
            ? PronosAMM(m.pool).estimateBuy(true, ORDER)
            : PronosAMMMulti(m.pool).estimateBuy(m.side, ORDER);
        vm.prank(trader);
        bought = router.buy(m.pool, m.side, ORDER, quote);
        assertGt(quote, 0);
        assertEq(bought, quote);
        assertEq(MXNB.balanceOf(trader), balance - ORDER);
        assertEq(_shares(m), bought);
    }

    function _tradeAndRedeem(Market memory m) private {
        uint256 bought = _buy(m);
        uint256 sold = bought / 2;
        uint256 quote = m.binary
            ? PronosAMM(m.pool).estimateSell(true, sold)
            : PronosAMMMulti(m.pool).estimateSell(m.side, sold);
        uint256 balance = MXNB.balanceOf(trader);
        vm.prank(trader);
        assertEq(router.sell(m.pool, m.side, sold, quote), quote);
        assertEq(MXNB.balanceOf(trader), balance + quote);
        assertEq(_shares(m), bought - sold);
        _reviewAndRecover(m, bought - sold);
        balance = MXNB.balanceOf(trader);
        vm.prank(trader);
        router.redeem(m.pool, bought - sold);
        assertEq(MXNB.balanceOf(trader), balance + bought - sold);
        assertEq(_shares(m), 0);
        assertEq(IRehearsalPool(m.pool).totalRedeemed(), bought - sold);
        assertEq(MXNB.balanceOf(m.pool), 0);
        assertEq(MXNB.balanceOf(address(router)), 0);
    }

    function _poolError(Market memory m, string memory reason) private pure returns (bytes memory) {
        return abi.encodeWithSignature("Error(string)", string.concat(m.binary ? "PronosAMM: " : "PronosAMMMulti: ", reason));
    }

    function _reviewAndRecover(Market memory m, uint256 outstandingClaim) private {
        IRehearsalPool pool = IRehearsalPool(m.pool);
        bytes32 wrong = _propose(m, m.binary ? 2 : 0);
        _approve(m, wrong);
        vm.expectRevert(_poolError(m, "challenge period"));
        m.factory.finalizeResolution(m.id, wrong);
        vm.warp(block.timestamp + 1 days);
        m.factory.openResolutionDispute(m.id);
        vm.expectRevert(MainnetResolutionReview.ReviewUnavailable.selector);
        m.factory.finalizeResolution(m.id, wrong);
        vm.prank(resolver);
        m.factory.proposeResolutionCorrection(m.id, wrong, m.outcome, keccak256("Corrected evidence"));
        bytes32 corrected = _proposalId(m);
        assertNotEq(wrong, corrected);
        vm.prank(reviewer);
        vm.expectRevert(MainnetResolutionReview.StaleResolutionProposal.selector);
        m.factory.approveResolution(m.id, wrong);
        _approve(m, corrected);
        uint256 correctedAt = block.timestamp;
        vm.warp(correctedAt + 1 days - 1);
        vm.expectRevert(_poolError(m, "challenge period"));
        m.factory.finalizeResolution(m.id, corrected);

        vm.prank(trader);
        vm.expectRevert(_poolError(m, "not finalized"));
        pool.redeem(outstandingClaim);
        vm.prank(trader);
        vm.expectRevert(_poolError(m, "not finalized"));
        router.redeem(m.pool, outstandingClaim);
        address[] memory holders = new address[](1);
        holders[0] = trader;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = outstandingClaim;
        vm.expectRevert(_poolError(m, "not finalized"));
        m.factory.pushRedeem(m.id, holders, amounts);

        vm.expectRevert(_poolError(m, "not finalized"));
        m.factory.sweepDust(m.id, treasury);
        vm.warp(correctedAt + 1 days);
        vm.expectRevert(_poolError(m, "not finalized"));
        m.factory.sweepDust(m.id, treasury);
        m.factory.finalizeResolution(m.id, corrected);
        assertTrue(pool.finalized());

        uint256 winningSupply = _winningSupply(m);
        assertEq(MXNB.balanceOf(m.pool), winningSupply);
        uint256 recoverable = winningSupply - outstandingClaim;
        uint256 treasuryBefore = MXNB.balanceOf(treasury);
        assertGt(recoverable, 0);
        vm.expectRevert(_poolError(m, "pool recipient"));
        m.factory.sweepDust(m.id, m.pool);
        m.factory.sweepDust(m.id, treasury);
        m.factory.sweepDust(m.id, treasury);
        assertEq(MXNB.balanceOf(treasury), treasuryBefore + recoverable);
        assertEq(pool.totalRecovered(), recoverable);
        assertEq(pool.totalRedeemed(), 0);
        assertEq(_winningSupply(m), outstandingClaim);
        assertEq(MXNB.balanceOf(m.pool), outstandingClaim);
        vm.expectRevert(_poolError(m, "finalized"));
        m.factory.openResolutionDispute(m.id);
        vm.prank(resolver);
        vm.expectRevert(MainnetResolutionReview.ReviewUnavailable.selector);
        m.factory.proposeResolutionCorrection(m.id, corrected, m.binary ? 2 : 0, EVIDENCE_HASH);
        vm.expectRevert(_poolError(m, "finalized"));
        m.factory.cancelMarket(m.id);
    }

    function _recoveryRejectsShortfall(Market memory m) private {
        _buy(m);
        bytes32 proposal = _propose(m, m.outcome);
        _approve(m, proposal);
        vm.warp(block.timestamp + 1 days);
        m.factory.finalizeResolution(m.id, proposal);

        uint256 winningSupply = _winningSupply(m);
        assertEq(MXNB.balanceOf(m.pool), winningSupply);
        // Simulate a one-unit deficit on the fork.
        vm.prank(m.pool);
        assertTrue(MXNB.transfer(emergency, 1));
        uint256 treasuryBefore = MXNB.balanceOf(treasury);
        vm.expectRevert(_poolError(m, "insufficient claim backing"));
        m.factory.sweepDust(m.id, treasury);
        assertEq(MXNB.balanceOf(treasury), treasuryBefore);
        assertEq(MXNB.balanceOf(m.pool), winningSupply - 1);
        assertEq(_winningSupply(m), winningSupply);
        assertEq(IRehearsalPool(m.pool).totalRecovered(), 0);
    }

    function _fees(bool binary) private {
        Market memory m = _market(binary);
        Market memory other = _market(binary);
        MarketFeeVault vault = m.factory.feeVault();
        assertNotEq(address(v1.feeVault()), address(v2.feeVault()));
        assertEq(address(vault.collateral()), address(MXNB));
        _buy(m);
        _buy(other);
        uint256 earned = IRehearsalPool(m.pool).totalFeesCollected();
        uint256 otherEarned = IRehearsalPool(other.pool).totalFeesCollected();
        assertGt(earned, 0);
        assertEq(MXNB.balanceOf(address(vault)), earned + otherEarned);
        uint256 unrelated = 17e6;
        assertTrue(MXNB.transfer(address(vault), unrelated));
        vm.expectRevert(bytes(binary ? "MarketFactory: use fee batches" : "MarketFactoryV2: use fee batches"));
        m.factory.distributeFees();
        vm.expectRevert("FeeVault: exceeds earned fees");
        m.factory.distributeMarketFees(m.id, keccak256("too much"), earned + 1);
        uint256 amount = earned / 2;
        bytes32 batchId = keccak256("reviewed fee batch");
        m.factory.distributeMarketFees(m.id, batchId, amount);
        assertTrue(vault.distributedBatches(batchId));
        assertEq(vault.distributedByMarket(m.id), amount);
        assertEq(MXNB.balanceOf(treasury), amount * 70 / 100);
        assertEq(MXNB.balanceOf(liquidity), amount * 20 / 100);
        assertEq(MXNB.balanceOf(emergency), amount - amount * 70 / 100 - amount * 20 / 100);
        vm.expectRevert("FeeVault: invalid or used batch");
        m.factory.distributeMarketFees(m.id, batchId, amount);
        m.factory.distributeMarketFees(m.id, keccak256("remainder"), earned - amount);
        assertEq(vault.distributedByMarket(m.id), earned);
        assertEq(vault.distributedByMarket(other.id), 0);
        assertEq(MXNB.balanceOf(address(vault)), unrelated + otherEarned);
    }

    function _cancelAndRefund(Market memory m) private {
        uint256 balance = MXNB.balanceOf(trader);
        uint256 bought = _buy(m);
        m.factory.cancelMarket(m.id);
        vm.prank(trader);
        vm.expectRevert("Router: market closed");
        router.buy(m.pool, m.side, ORDER, 1);
        address[] memory holders = new address[](1);
        holders[0] = trader;
        uint8[][] memory outcomes = new uint8[][](1);
        outcomes[0] = new uint8[](1);
        outcomes[0][0] = m.side;
        uint256[][] memory shares = new uint256[][](1);
        shares[0] = new uint256[](1);
        shares[0][0] = bought;
        uint256[] memory payouts = new uint256[](1);
        payouts[0] = ORDER;
        m.factory.pushCancelRefund(m.id, holders, outcomes, shares, payouts);
        assertEq(MXNB.balanceOf(trader), balance);
        assertEq(_shares(m), 0);
        vm.expectRevert();
        m.factory.pushCancelRefund(m.id, holders, outcomes, shares, payouts);
        assertEq(MXNB.balanceOf(trader), balance);
    }
}
