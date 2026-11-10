// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IResolutionReviewPool {
    function disputed() external view returns (bool);
    function canceled() external view returns (bool);
    function finalized() external view returns (bool);
    function resolvedAt() external view returns (uint256);
    function RESOLUTION_CHALLENGE_PERIOD() external view returns (uint256);
}

/// @notice Independent review for outcome settlement on Arbitrum One and Arbitrum Sepolia.
abstract contract MainnetResolutionReview {
    error ReviewedResolutionRequired();
    error ReviewUnavailable();
    error InvalidReviewRole();
    error MissingReviewHash();
    error MissingResolutionSource();
    error StaleResolutionProposal();
    error ResolutionApprovalRequired();

    struct ReviewedMarketInput {
        string question;
        string category;
        uint256 endTime;
        string resolutionSource;
        uint256 seedAmount;
        bytes32 rulesHash;
    }

    struct ResolutionProposal {
        bytes32 id;
        bytes32 evidenceHash;
        address proposer;
        uint64 revision;
        uint8 outcome;
        bool approved;
    }

    bool public immutable requiresResolutionReview = block.chainid == 42161 || block.chainid == 421614;
    address public resolutionReviewer;
    mapping(uint256 => bytes32) public resolutionRulesHash;
    mapping(uint256 => ResolutionProposal) public resolutionProposals;

    event ResolutionReviewerSet(address indexed reviewer);
    event ResolutionRulesCommitted(uint256 indexed marketId, bytes32 rulesHash);
    event ResolutionProposed(
        uint256 indexed marketId, bytes32 indexed proposalId, address indexed proposer,
        uint8 outcome, bytes32 evidenceHash, uint64 revision, uint256 reviewEndsAt
    );
    event ResolutionApproved(uint256 indexed marketId, bytes32 indexed proposalId, address indexed reviewer);
    event ResolutionFlagged(
        uint256 indexed marketId, bytes32 indexed proposalId, address indexed reporter, bytes32 objectionHash
    );
    event ResolutionReviewFinalized(uint256 indexed marketId, bytes32 indexed proposalId);

    function approveResolution(uint256 marketId, bytes32 expectedProposalId) external {
        _requireReviewer();
        ResolutionProposal storage proposal = _requireCurrentProposal(marketId, expectedProposalId);
        if (_reviewPool(marketId).disputed()) revert ReviewUnavailable();
        if (proposal.approved) return;
        proposal.approved = true;
        emit ResolutionApproved(marketId, expectedProposalId, msg.sender);
    }

    /// @notice Record a public objection for reviewers without granting a wallet veto power.
    function flagResolution(uint256 marketId, bytes32 expectedProposalId, bytes32 objectionHash) external {
        _requireCurrentProposal(marketId, expectedProposalId);
        if (objectionHash == bytes32(0)) revert MissingReviewHash();
        emit ResolutionFlagged(marketId, expectedProposalId, msg.sender, objectionHash);
    }

    function _reviewPool(uint256 marketId) internal view virtual returns (IResolutionReviewPool);

    function _requireLegacyResolution() internal view {
        if (requiresResolutionReview) revert ReviewedResolutionRequired();
    }

    function _requireReviewer() internal view {
        if (msg.sender != resolutionReviewer) revert InvalidReviewRole();
    }

    function _configureReviewer(address reviewer, address owner, address resolver) internal {
        if (!requiresResolutionReview || resolutionReviewer != address(0)) revert ReviewUnavailable();
        if (reviewer == address(0) || reviewer == owner || reviewer == resolver || resolver == owner) {
            revert InvalidReviewRole();
        }
        resolutionReviewer = reviewer;
        emit ResolutionReviewerSet(reviewer);
    }

    function _requireDistinctReviewRoles(address newRole, address otherRole) internal view {
        if (requiresResolutionReview && (newRole == resolutionReviewer || newRole == otherRole)) {
            revert InvalidReviewRole();
        }
    }

    function _requireRulesCommitment(ReviewedMarketInput calldata input) internal view {
        if (resolutionReviewer == address(0)) revert ReviewUnavailable();
        if (input.rulesHash == bytes32(0)) revert MissingReviewHash();
        if (bytes(input.resolutionSource).length == 0) revert MissingResolutionSource();
    }

    function _commitResolutionRules(uint256 marketId, bytes32 rulesHash) internal {
        resolutionRulesHash[marketId] = rulesHash;
        emit ResolutionRulesCommitted(marketId, rulesHash);
    }

    function _requireProposalAuthor(uint256 marketId, address resolver, bytes32 evidenceHash) internal view {
        if (!requiresResolutionReview || resolutionRulesHash[marketId] == bytes32(0)) revert ReviewUnavailable();
        if (msg.sender != resolver) revert InvalidReviewRole();
        if (evidenceHash == bytes32(0)) revert MissingReviewHash();
    }

    function _recordResolutionProposal(uint256 marketId, uint8 outcome, bytes32 evidenceHash, address proposer)
        internal
    {
        uint64 revision = resolutionProposals[marketId].revision + 1;
        bytes32 proposalId = keccak256(
            abi.encode(block.chainid, address(this), marketId, resolutionRulesHash[marketId], revision,
                outcome, evidenceHash, proposer)
        );
        resolutionProposals[marketId] = ResolutionProposal(proposalId, evidenceHash, proposer, revision, outcome, false);
        IResolutionReviewPool pool = _reviewPool(marketId);
        emit ResolutionProposed(
            marketId, proposalId, proposer, outcome, evidenceHash, revision,
            pool.resolvedAt() + pool.RESOLUTION_CHALLENGE_PERIOD()
        );
    }

    function _restartResolutionReview(uint256 marketId) internal {
        ResolutionProposal storage proposal = resolutionProposals[marketId];
        _recordResolutionProposal(marketId, proposal.outcome, proposal.evidenceHash, proposal.proposer);
    }

    function _requireApprovedProposal(uint256 marketId, bytes32 expectedProposalId) internal view {
        ResolutionProposal storage proposal = _requireCurrentProposal(marketId, expectedProposalId);
        if (_reviewPool(marketId).disputed()) revert ReviewUnavailable();
        if (!proposal.approved) revert ResolutionApprovalRequired();
    }

    function _requireCurrentProposal(uint256 marketId, bytes32 expectedProposalId)
        internal view returns (ResolutionProposal storage proposal)
    {
        proposal = resolutionProposals[marketId];
        if (proposal.id == bytes32(0) || proposal.id != expectedProposalId) revert StaleResolutionProposal();
        IResolutionReviewPool pool = _reviewPool(marketId);
        if (pool.canceled() || pool.finalized()) revert ReviewUnavailable();
    }
}
