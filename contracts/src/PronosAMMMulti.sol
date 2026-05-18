// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./PronosTokenV2.sol";

/**
 * @title PronosAMMMulti
 * @notice Constant-product AMM for multi-outcome Pronos markets.
 *
 * Buying an outcome mints a complete set, takes a fixed upfront fee, and uses
 * the net collateral to rebalance reserves. Selling burns complete sets and
 * returns collateral immediately, so users can exit before resolution.
 */
contract PronosAMMMulti is ERC1155Holder, ReentrancyGuard {
    using Math for uint256;

    uint256 public constant PRICE_SCALE = 1e6;
    uint256 public constant RATIO_SCALE = 1e18;
    uint256 public constant INVERSE_SCALE = 1e36;
    uint256 public constant BUY_FEE_BPS = 200; // 2% upfront, outside the pool
    uint8 public constant MAX_OUTCOMES = 8;

    PronosTokenV2 public immutable token;
    // Generic ERC-20 collateral. Arbitrum One: MXNB. Testnet: MockMXNB.
    IERC20 public immutable collateral;
    address public immutable factory;

    uint256 public immutable marketId;
    uint8 public immutable outcomeCount;
    uint256[] public reserves;

    address public feeCollector;
    uint256 public totalFeesCollected;
    mapping(address => mapping(uint8 => uint256)) public costBasis;

    bool public initialized;
    bool public paused;
    bool public resolved;
    bool public canceled;
    bool public disputed;
    uint8 public outcome;

    /// @notice block.timestamp when resolve() was called; 0 while
    /// the market is open. Drives the post-resolution grace period
    /// enforced by recoverDust().
    uint256 public resolvedAt;
    uint256 public totalRedeemed;

    /// @notice Window after resolution before the factory can sweep
    /// leftover collateral. Same value as the binary AMM so operators
    /// don't have to remember two policies.
    uint256 public constant RECOVER_GRACE_PERIOD = 30 days;

    event LiquidityAdded(address indexed provider, uint256 amount);
    event SharesBought(address indexed buyer, uint8 indexed outcomeIndex, uint256 collateralIn, uint256 fee, uint256 sharesOut);
    event SharesSold(address indexed seller, uint8 indexed outcomeIndex, uint256 sharesIn, uint256 collateralOut, uint256 fee);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event WinningsRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout);
    event MarketPaused(bool paused);
    event MarketCanceled(uint256 indexed marketId);
    event ResolutionDisputeOpened(uint256 indexed marketId, uint8 outcome);
    event ResolutionDisputeCleared(uint256 indexed marketId, uint8 outcome);
    event MarketResolutionCorrected(uint256 indexed marketId, uint8 oldOutcome, uint8 newOutcome);
    event CancelRefunded(address indexed user, uint256 payout);
    /// @notice Emitted when the factory sweeps the AMM's leftover
    /// collateral after resolution + grace period.
    event DustRecovered(address indexed recipient, uint256 amount);

    constructor(
        address _token,
        address _collateral,
        uint256 _marketId,
        uint8 _outcomeCount,
        address _feeCollector
    ) {
        require(_outcomeCount >= 2, "PronosAMMMulti: too few outcomes");
        require(_outcomeCount <= MAX_OUTCOMES, "PronosAMMMulti: too many outcomes");
        token = PronosTokenV2(_token);
        collateral = IERC20(_collateral);
        factory = msg.sender;
        marketId = _marketId;
        outcomeCount = _outcomeCount;
        feeCollector = _feeCollector;
        for (uint8 i = 0; i < _outcomeCount; i++) {
            reserves.push(0);
        }
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "PronosAMMMulti: not factory");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PronosAMMMulti: paused");
        _;
    }

    modifier whenNotCanceled() {
        require(!canceled, "PronosAMMMulti: canceled");
        _;
    }

    modifier whenNotResolved() {
        require(!resolved, "PronosAMMMulti: resolved");
        _;
    }

    function initialize(address provider, uint256 amount) external onlyFactory nonReentrant {
        require(!initialized, "PronosAMMMulti: already initialized");
        require(amount > 0, "PronosAMMMulti: zero amount");
        initialized = true;

        require(collateral.transferFrom(provider, address(this), amount), "PronosAMMMulti: transfer failed");
        token.mintCompleteSet(address(this), marketId, amount);

        for (uint8 i = 0; i < outcomeCount; i++) {
            reserves[i] = amount;
        }

        emit LiquidityAdded(provider, amount);
    }

    function calculateFee(uint256 amount, uint8 outcomeIndex) public view returns (uint256) {
        _requireOutcome(outcomeIndex);
        uint256 fee = (amount * BUY_FEE_BPS) / 10_000;
        if (fee == 0 && amount > 0) return 1;
        return fee;
    }

    function currentFeeBps(uint8 outcomeIndex) external view returns (uint256) {
        _requireOutcome(outcomeIndex);
        return BUY_FEE_BPS;
    }

    function buy(uint8 outcomeIndex, uint256 collateralAmount)
        external
        whenNotCanceled
        whenNotPaused
        whenNotResolved
        nonReentrant
        returns (uint256 sharesOut)
    {
        return _buy(msg.sender, outcomeIndex, collateralAmount, 0);
    }

    function buy(uint8 outcomeIndex, uint256 collateralAmount, uint256 minSharesOut)
        external
        whenNotCanceled
        whenNotPaused
        whenNotResolved
        nonReentrant
        returns (uint256 sharesOut)
    {
        return _buy(msg.sender, outcomeIndex, collateralAmount, minSharesOut);
    }

    function _buy(address buyer, uint8 outcomeIndex, uint256 collateralAmount, uint256 minSharesOut)
        internal
        returns (uint256 sharesOut)
    {
        require(initialized, "PronosAMMMulti: not initialized");
        require(collateralAmount > 0, "PronosAMMMulti: zero amount");
        _requireOutcome(outcomeIndex);

        uint256 fee = calculateFee(collateralAmount, outcomeIndex);
        uint256 netAmount = collateralAmount - fee;
        require(netAmount > 0, "PronosAMMMulti: amount too small");

        sharesOut = _estimateBuyNet(outcomeIndex, netAmount);
        require(sharesOut > 0, "PronosAMMMulti: insufficient output");
        require(sharesOut >= minSharesOut, "PronosAMMMulti: price moved");

        require(collateral.transferFrom(buyer, address(this), collateralAmount), "PronosAMMMulti: transfer failed");
        if (fee > 0) {
            require(collateral.transfer(feeCollector, fee), "PronosAMMMulti: fee transfer failed");
            totalFeesCollected += fee;
        }

        token.mintCompleteSet(address(this), marketId, netAmount);

        for (uint8 i = 0; i < outcomeCount; i++) {
            reserves[i] += netAmount;
        }
        reserves[outcomeIndex] -= sharesOut;
        costBasis[buyer][outcomeIndex] += collateralAmount;

        token.safeTransferFrom(
            address(this),
            buyer,
            token.tokenId(marketId, outcomeIndex),
            sharesOut,
            ""
        );

        emit SharesBought(buyer, outcomeIndex, collateralAmount, fee, sharesOut);
    }

    function sell(uint8 outcomeIndex, uint256 sharesAmount)
        external
        whenNotCanceled
        whenNotPaused
        whenNotResolved
        nonReentrant
        returns (uint256 collateralOut)
    {
        return _sell(msg.sender, outcomeIndex, sharesAmount, 0);
    }

    function sell(uint8 outcomeIndex, uint256 sharesAmount, uint256 minCollateralOut)
        external
        whenNotCanceled
        whenNotPaused
        whenNotResolved
        nonReentrant
        returns (uint256 collateralOut)
    {
        return _sell(msg.sender, outcomeIndex, sharesAmount, minCollateralOut);
    }

    function _sell(address seller, uint8 outcomeIndex, uint256 sharesAmount, uint256 minCollateralOut)
        internal
        returns (uint256 collateralOut)
    {
        require(initialized, "PronosAMMMulti: not initialized");
        require(sharesAmount > 0, "PronosAMMMulti: zero amount");
        _requireOutcome(outcomeIndex);

        collateralOut = _estimateSellGross(outcomeIndex, sharesAmount);
        require(collateralOut > 0, "PronosAMMMulti: insufficient output");
        require(collateralOut >= minCollateralOut, "PronosAMMMulti: price moved");
        _reduceCostBasis(
            seller,
            outcomeIndex,
            sharesAmount,
            token.balanceOf(seller, token.tokenId(marketId, outcomeIndex))
        );

        token.safeTransferFrom(
            seller,
            address(this),
            token.tokenId(marketId, outcomeIndex),
            sharesAmount,
            ""
        );

        for (uint8 i = 0; i < outcomeCount; i++) {
            if (i == outcomeIndex) {
                reserves[i] = reserves[i] + sharesAmount - collateralOut;
            } else {
                reserves[i] -= collateralOut;
            }
        }

        token.burnCompleteSet(address(this), marketId, collateralOut);
        require(collateral.transfer(seller, collateralOut), "PronosAMMMulti: transfer failed");

        emit SharesSold(seller, outcomeIndex, sharesAmount, collateralOut, 0);
    }

    function price(uint8 outcomeIndex) public view returns (uint256) {
        _requireOutcome(outcomeIndex);
        if (!initialized) return PRICE_SCALE / outcomeCount;

        uint256 denom = 0;
        uint256 selected = 0;
        for (uint8 i = 0; i < outcomeCount; i++) {
            uint256 inv = INVERSE_SCALE / reserves[i];
            denom += inv;
            if (i == outcomeIndex) selected = inv;
        }

        return (selected * PRICE_SCALE) / denom;
    }

    function prices() external view returns (uint256[] memory out) {
        out = new uint256[](outcomeCount);
        if (!initialized) {
            uint256 equal = PRICE_SCALE / outcomeCount;
            for (uint8 i = 0; i < outcomeCount; i++) out[i] = equal;
            return out;
        }

        uint256[] memory inverses = new uint256[](outcomeCount);
        uint256 denom = 0;
        for (uint8 i = 0; i < outcomeCount; i++) {
            inverses[i] = INVERSE_SCALE / reserves[i];
            denom += inverses[i];
        }
        for (uint8 i = 0; i < outcomeCount; i++) {
            out[i] = (inverses[i] * PRICE_SCALE) / denom;
        }
    }

    function getReserves() external view returns (uint256[] memory out) {
        out = new uint256[](outcomeCount);
        for (uint8 i = 0; i < outcomeCount; i++) {
            out[i] = reserves[i];
        }
    }

    function estimateBuy(uint8 outcomeIndex, uint256 collateralAmount) external view returns (uint256) {
        require(initialized, "PronosAMMMulti: not initialized");
        _requireOutcome(outcomeIndex);
        uint256 fee = calculateFee(collateralAmount, outcomeIndex);
        if (collateralAmount <= fee) return 0;
        return _estimateBuyNet(outcomeIndex, collateralAmount - fee);
    }

    function estimateSell(uint8 outcomeIndex, uint256 sharesAmount) external view returns (uint256) {
        require(initialized, "PronosAMMMulti: not initialized");
        _requireOutcome(outcomeIndex);
        return _estimateSellGross(outcomeIndex, sharesAmount);
    }

    function resolve(uint8 outcomeIndex) external onlyFactory {
        require(!canceled, "PronosAMMMulti: canceled");
        require(!resolved, "PronosAMMMulti: already resolved");
        _requireOutcome(outcomeIndex);
        resolved = true;
        outcome = outcomeIndex;
        resolvedAt = block.timestamp;
        emit MarketResolved(marketId, outcomeIndex);
    }

    /// @notice Sweep the AMM's leftover collateral after resolution +
    /// grace period. Mirrors the binary PronosAMM.recoverDust: burns
    /// the AMM's own winning-outcome tokens and transfers an equal
    /// amount of collateral to `recipient`. User-held positions stay
    /// redeemable because the burned amount equals what we transfer,
    /// preserving the outstanding_winning_tokens == collateral_balance
    /// invariant. Idempotent.
    function recoverDust(address recipient) external onlyFactory nonReentrant {
        require(!canceled, "PronosAMMMulti: canceled");
        require(!disputed, "PronosAMMMulti: disputed");
        require(resolved, "PronosAMMMulti: not resolved");
        require(block.timestamp >= resolvedAt + RECOVER_GRACE_PERIOD, "PronosAMMMulti: grace period not over");
        require(recipient != address(0), "PronosAMMMulti: zero recipient");

        uint256 winningTokenId = token.tokenId(marketId, outcome);
        uint256 ammWinningBalance = token.balanceOf(address(this), winningTokenId);
        if (ammWinningBalance == 0) {
            return; // already swept
        }

        token.burn(address(this), winningTokenId, ammWinningBalance);
        require(collateral.transfer(recipient, ammWinningBalance), "PronosAMMMulti: transfer failed");

        emit DustRecovered(recipient, ammWinningBalance);
    }

    /// @notice Push-redeem: factory pays out a holder's winnings
    /// without them sending a tx. Mirrors PronosAMM.redeemOnBehalf —
    /// the caller (factory) pays gas, the holder always receives
    /// the collateral, no theft vector.
    function redeemOnBehalf(address holder, uint256 amount) external onlyFactory nonReentrant {
        require(!canceled, "PronosAMMMulti: canceled");
        require(!disputed, "PronosAMMMulti: disputed");
        require(resolved, "PronosAMMMulti: not resolved");
        require(amount > 0, "PronosAMMMulti: zero amount");
        require(holder != address(0), "PronosAMMMulti: zero holder");

        token.burn(holder, token.tokenId(marketId, outcome), amount);
        require(collateral.transfer(holder, amount), "PronosAMMMulti: transfer failed");
        totalRedeemed += amount;

        emit WinningsRedeemed(holder, outcome, amount, amount);
    }

    function redeem(uint256 amount) external nonReentrant {
        require(!canceled, "PronosAMMMulti: canceled");
        require(!disputed, "PronosAMMMulti: disputed");
        require(resolved, "PronosAMMMulti: not resolved");
        require(amount > 0, "PronosAMMMulti: zero amount");

        token.burn(msg.sender, token.tokenId(marketId, outcome), amount);
        require(collateral.transfer(msg.sender, amount), "PronosAMMMulti: transfer failed");
        totalRedeemed += amount;

        emit WinningsRedeemed(msg.sender, outcome, amount, amount);
    }

    function cancel() external onlyFactory {
        require(!canceled, "PronosAMMMulti: already canceled");
        require(!resolved || disputed, "PronosAMMMulti: resolved");
        require(totalRedeemed == 0, "PronosAMMMulti: payouts started");
        canceled = true;
        disputed = false;
        paused = true;
        emit MarketCanceled(marketId);
        emit MarketPaused(true);
    }

    function openResolutionDispute() external onlyFactory {
        require(!canceled, "PronosAMMMulti: canceled");
        require(resolved, "PronosAMMMulti: not resolved");
        require(!disputed, "PronosAMMMulti: already disputed");
        disputed = true;
        emit ResolutionDisputeOpened(marketId, outcome);
    }

    function clearResolutionDispute() external onlyFactory {
        require(disputed, "PronosAMMMulti: not disputed");
        disputed = false;
        emit ResolutionDisputeCleared(marketId, outcome);
    }

    function correctResolution(uint8 newOutcome) external onlyFactory {
        require(disputed, "PronosAMMMulti: not disputed");
        require(totalRedeemed == 0, "PronosAMMMulti: payouts started");
        _requireOutcome(newOutcome);
        uint8 oldOutcome = outcome;
        outcome = newOutcome;
        disputed = false;
        resolvedAt = block.timestamp;
        emit MarketResolutionCorrected(marketId, oldOutcome, newOutcome);
        emit MarketResolved(marketId, newOutcome);
    }

    function refundOnBehalf(
        address holder,
        uint8[] calldata outcomeIndexes,
        uint256[] calldata amounts,
        uint256 payout
    ) external onlyFactory nonReentrant {
        require(canceled, "PronosAMMMulti: not canceled");
        require(holder != address(0), "PronosAMMMulti: zero holder");
        require(outcomeIndexes.length == amounts.length, "PronosAMMMulti: length mismatch");
        uint256 maxPayout = 0;
        for (uint256 i = 0; i < outcomeIndexes.length; i++) {
            _requireOutcome(outcomeIndexes[i]);
            if (amounts[i] == 0) continue;
            uint256 tokenIdForOutcome = token.tokenId(marketId, outcomeIndexes[i]);
            maxPayout += _reduceCostBasis(
                holder,
                outcomeIndexes[i],
                amounts[i],
                token.balanceOf(holder, tokenIdForOutcome)
            );
            token.burn(holder, tokenIdForOutcome, amounts[i]);
        }
        require(payout <= maxPayout, "PronosAMMMulti: payout exceeds cost");
        if (payout > 0) {
            require(collateral.transfer(holder, payout), "PronosAMMMulti: transfer failed");
        }
        emit CancelRefunded(holder, payout);
    }

    function setPaused(bool _paused) external onlyFactory {
        paused = _paused;
        emit MarketPaused(_paused);
    }

    function setFeeCollector(address _feeCollector) external onlyFactory {
        require(_feeCollector != address(0), "PronosAMMMulti: zero address");
        feeCollector = _feeCollector;
    }

    function _reduceCostBasis(
        address holder,
        uint8 outcomeIndex,
        uint256 sharesAmount,
        uint256 balanceBefore
    ) internal returns (uint256 reduction) {
        require(balanceBefore >= sharesAmount, "PronosAMMMulti: insufficient shares");
        uint256 current = costBasis[holder][outcomeIndex];
        if (current == 0 || sharesAmount == 0 || balanceBefore == 0) return 0;
        reduction = (current * sharesAmount) / balanceBefore;
        costBasis[holder][outcomeIndex] = current - reduction;
    }

    function _estimateBuyNet(uint8 outcomeIndex, uint256 netAmount) internal view returns (uint256) {
        uint256 newOutcomeReserve = reserves[outcomeIndex];
        for (uint8 i = 0; i < outcomeCount; i++) {
            if (i == outcomeIndex) continue;
            newOutcomeReserve = Math.mulDiv(
                newOutcomeReserve,
                reserves[i],
                reserves[i] + netAmount,
                Math.Rounding.Ceil
            );
        }

        uint256 available = reserves[outcomeIndex] + netAmount;
        if (newOutcomeReserve >= available) return 0;
        return available - newOutcomeReserve;
    }

    function _estimateSellGross(uint8 outcomeIndex, uint256 sharesAmount) internal view returns (uint256) {
        uint256 minAdjusted = type(uint256).max;
        for (uint8 i = 0; i < outcomeCount; i++) {
            uint256 adjusted = reserves[i] + (i == outcomeIndex ? sharesAmount : 0);
            if (adjusted < minAdjusted) minAdjusted = adjusted;
        }
        if (minAdjusted <= 1) return 0;

        uint256 low = 0;
        uint256 high = minAdjusted - 1;
        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            if (_keepsInvariant(outcomeIndex, sharesAmount, mid)) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        return low;
    }

    function _keepsInvariant(uint8 outcomeIndex, uint256 sharesAmount, uint256 collateralOut) internal view returns (bool) {
        uint256 ratio = RATIO_SCALE;
        for (uint8 i = 0; i < outcomeCount; i++) {
            uint256 adjusted = reserves[i] + (i == outcomeIndex ? sharesAmount : 0);
            if (collateralOut >= adjusted) return false;
            ratio = Math.mulDiv(ratio, adjusted - collateralOut, reserves[i]);
            if (ratio == 0) return false;
        }
        return ratio >= RATIO_SCALE;
    }

    function _requireOutcome(uint8 outcomeIndex) internal view {
        require(outcomeIndex < outcomeCount, "PronosAMMMulti: invalid outcome");
    }
}
