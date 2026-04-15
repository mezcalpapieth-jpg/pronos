// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
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
contract PronosAMMMulti is ERC1155Holder {
    using Math for uint256;

    uint256 public constant PRICE_SCALE = 1e6;
    uint256 public constant RATIO_SCALE = 1e18;
    uint256 public constant INVERSE_SCALE = 1e36;
    uint256 public constant BUY_FEE_BPS = 200; // 2% upfront, outside the pool
    uint8 public constant MAX_OUTCOMES = 8;

    PronosTokenV2 public immutable token;
    IERC20 public immutable collateral;
    address public immutable factory;

    uint256 public immutable marketId;
    uint8 public immutable outcomeCount;
    uint256[] public reserves;

    address public feeCollector;
    uint256 public totalFeesCollected;

    bool public initialized;
    bool public paused;
    bool public resolved;
    uint8 public outcome;

    event LiquidityAdded(address indexed provider, uint256 amount);
    event SharesBought(address indexed buyer, uint8 indexed outcomeIndex, uint256 collateralIn, uint256 fee, uint256 sharesOut);
    event SharesSold(address indexed seller, uint8 indexed outcomeIndex, uint256 sharesIn, uint256 collateralOut, uint256 fee);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event WinningsRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout);
    event MarketPaused(bool paused);

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

    modifier whenNotResolved() {
        require(!resolved, "PronosAMMMulti: resolved");
        _;
    }

    function initialize(address provider, uint256 amount) external onlyFactory {
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
        whenNotPaused
        whenNotResolved
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

        require(collateral.transferFrom(msg.sender, address(this), collateralAmount), "PronosAMMMulti: transfer failed");
        if (fee > 0) {
            require(collateral.transfer(feeCollector, fee), "PronosAMMMulti: fee transfer failed");
            totalFeesCollected += fee;
        }

        token.mintCompleteSet(address(this), marketId, netAmount);

        for (uint8 i = 0; i < outcomeCount; i++) {
            reserves[i] += netAmount;
        }
        reserves[outcomeIndex] -= sharesOut;

        token.safeTransferFrom(
            address(this),
            msg.sender,
            token.tokenId(marketId, outcomeIndex),
            sharesOut,
            ""
        );

        emit SharesBought(msg.sender, outcomeIndex, collateralAmount, fee, sharesOut);
    }

    function sell(uint8 outcomeIndex, uint256 sharesAmount)
        external
        whenNotPaused
        whenNotResolved
        returns (uint256 collateralOut)
    {
        require(initialized, "PronosAMMMulti: not initialized");
        require(sharesAmount > 0, "PronosAMMMulti: zero amount");
        _requireOutcome(outcomeIndex);

        collateralOut = _estimateSellGross(outcomeIndex, sharesAmount);
        require(collateralOut > 0, "PronosAMMMulti: insufficient output");

        token.safeTransferFrom(
            msg.sender,
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
        require(collateral.transfer(msg.sender, collateralOut), "PronosAMMMulti: transfer failed");

        emit SharesSold(msg.sender, outcomeIndex, sharesAmount, collateralOut, 0);
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
        require(!resolved, "PronosAMMMulti: already resolved");
        _requireOutcome(outcomeIndex);
        resolved = true;
        outcome = outcomeIndex;
        emit MarketResolved(marketId, outcomeIndex);
    }

    function redeem(uint256 amount) external {
        require(resolved, "PronosAMMMulti: not resolved");
        require(amount > 0, "PronosAMMMulti: zero amount");

        token.burn(msg.sender, token.tokenId(marketId, outcome), amount);
        require(collateral.transfer(msg.sender, amount), "PronosAMMMulti: transfer failed");

        emit WinningsRedeemed(msg.sender, outcome, amount, amount);
    }

    function setPaused(bool _paused) external onlyFactory {
        paused = _paused;
        emit MarketPaused(_paused);
    }

    function setFeeCollector(address _feeCollector) external onlyFactory {
        require(_feeCollector != address(0), "PronosAMMMulti: zero address");
        feeCollector = _feeCollector;
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
