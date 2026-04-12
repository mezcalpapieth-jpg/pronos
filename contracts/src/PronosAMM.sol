// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "./PronosToken.sol";

/**
 * @title PronosAMM
 * @notice CPMM (x*y=k) automated market maker for a single binary market.
 *
 * Fixed 2% protocol fee.
 * Fees are deducted BEFORE entering the pool and sent to the fee collector.
 * They never touch the AMM reserves.
 */
contract PronosAMM is ERC1155Holder {
    // ─── State ────────────────────────────────────────────────────────────────

    PronosToken public immutable token;
    IERC20      public immutable collateral;      // USDC
    address     public immutable factory;

    uint256 public immutable marketId;
    uint256 public immutable yesId;
    uint256 public immutable noId;

    uint256 public reserveYes;
    uint256 public reserveNo;

    address public feeCollector;
    uint256 public totalFeesCollected;
    uint256 public constant FEE_BPS = 200; // 2%

    bool public initialized;
    bool public paused;
    bool public resolved;
    uint8 public outcome; // 0=unresolved, 1=YES, 2=NO

    // ─── Events ──────────────────────────────────────────────────────────────

    event LiquidityAdded(address indexed provider, uint256 amount);
    event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut);
    event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event WinningsRedeemed(address indexed user, uint256 shares, uint256 payout);
    event MarketPaused(bool paused);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _token,
        address _collateral,
        uint256 _marketId,
        address _feeCollector
    ) {
        token        = PronosToken(_token);
        collateral   = IERC20(_collateral);
        factory      = msg.sender;
        marketId     = _marketId;
        yesId        = _marketId * 2;
        noId         = _marketId * 2 + 1;
        feeCollector = _feeCollector;
    }

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyFactory() {
        require(msg.sender == factory, "PronosAMM: not factory");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "PronosAMM: paused");
        _;
    }

    modifier whenNotResolved() {
        require(!resolved, "PronosAMM: resolved");
        _;
    }

    // ─── Fee Calculation ─────────────────────────────────────────────────────

    /**
     * @notice Calculate the fixed 2% protocol fee in collateral units.
     */
    function calculateFee(uint256 amount, bool) public pure returns (uint256) {
        return (amount * FEE_BPS) / 10_000;
    }

    // ─── Initialize (seed liquidity) ─────────────────────────────────────────

    function initialize(address provider, uint256 amount) external onlyFactory {
        require(!initialized, "PronosAMM: already initialized");
        require(amount > 0, "PronosAMM: zero amount");
        initialized = true;

        require(collateral.transferFrom(provider, address(this), amount), "PronosAMM: transfer failed");
        token.mintPair(address(this), marketId, amount);

        reserveYes = amount;
        reserveNo  = amount;

        emit LiquidityAdded(provider, amount);
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    /**
     * @notice Buy outcome tokens with USDC.
     *         Fee is deducted first and sent to feeCollector.
     *         Remaining USDC enters the pool.
     */
    function buy(bool buyYes, uint256 collateralAmount)
        external
        whenNotPaused
        whenNotResolved
        returns (uint256 sharesOut)
    {
        require(initialized, "PronosAMM: not initialized");
        require(collateralAmount > 0, "PronosAMM: zero amount");

        // 1. Calculate and deduct fee BEFORE pool
        uint256 fee = calculateFee(collateralAmount, buyYes);
        uint256 netAmount = collateralAmount - fee;

        // 2. Transfer full amount from user
        require(collateral.transferFrom(msg.sender, address(this), collateralAmount), "PronosAMM: transfer failed");

        // 3. Send fee directly to fee collector (never enters pool)
        if (fee > 0) {
            require(collateral.transfer(feeCollector, fee), "PronosAMM: fee transfer failed");
            totalFeesCollected += fee;
        }

        // 4. Mint YES + NO tokens backed by net amount
        token.mintPair(address(this), marketId, netAmount);

        // 5. Calculate shares out using CPMM
        uint256 k = reserveYes * reserveNo;

        if (buyYes) {
            uint256 newNo = reserveNo + netAmount;
            uint256 newYes = (k + newNo - 1) / newNo; // round up to protect pool
            sharesOut = (reserveYes + netAmount) - newYes;
            reserveYes = newYes;
            reserveNo  = newNo;
            token.safeTransferFrom(address(this), msg.sender, yesId, sharesOut, "");
        } else {
            uint256 newYes = reserveYes + netAmount;
            uint256 newNo = (k + newYes - 1) / newYes;
            sharesOut = (reserveNo + netAmount) - newNo;
            reserveNo  = newNo;
            reserveYes = newYes;
            token.safeTransferFrom(address(this), msg.sender, noId, sharesOut, "");
        }

        emit SharesBought(msg.sender, buyYes, collateralAmount, fee, sharesOut);
    }

    /**
     * @notice Sell outcome tokens back for USDC.
     *         Uses quadratic formula to compute collateral out.
     *         Fee is deducted and sent to feeCollector.
     *
     * Math: User sends `s` tokens. Pool merges `c` complete sets into collateral.
     *   (R_a + s - c) * (R_b - c) = k   where a=selling side, b=other side
     *   Solving: c = [(a+b) - sqrt((a-b)^2 + 4k)] / 2
     *   where a = R_a + s, b = R_b
     */
    function sell(bool sellYes, uint256 sharesAmount)
        external
        whenNotPaused
        whenNotResolved
        returns (uint256 collateralOut)
    {
        require(initialized, "PronosAMM: not initialized");
        require(sharesAmount > 0, "PronosAMM: zero amount");

        uint256 k = reserveYes * reserveNo;
        uint256 a; // selling side reserve + shares
        uint256 b; // other side reserve

        if (sellYes) {
            token.safeTransferFrom(msg.sender, address(this), yesId, sharesAmount, "");
            a = reserveYes + sharesAmount;
            b = reserveNo;
        } else {
            token.safeTransferFrom(msg.sender, address(this), noId, sharesAmount, "");
            a = reserveNo + sharesAmount;
            b = reserveYes;
        }

        // Solve quadratic: c = [(a+b) - sqrt((a-b)^2 + 4k)] / 2
        uint256 diff = a > b ? a - b : b - a;
        uint256 discriminant = diff * diff + 4 * k;
        uint256 sqrtDisc = _sqrt(discriminant);
        uint256 c = (a + b - sqrtDisc) / 2;

        require(c > 0, "PronosAMM: insufficient output");

        // Calculate fee on collateral out (fee based on the side being sold)
        uint256 fee = calculateFee(c, !sellYes); // selling YES = effectively buying NO
        collateralOut = c - fee;

        // Update reserves
        if (sellYes) {
            reserveYes = a - c;
            reserveNo  = b - c;
        } else {
            reserveNo  = a - c;
            reserveYes = b - c;
        }

        // Burn `c` complete sets to release collateral
        token.burnPair(address(this), marketId, c);

        // Send fee to collector
        if (fee > 0) {
            require(collateral.transfer(feeCollector, fee), "PronosAMM: fee transfer failed");
            totalFeesCollected += fee;
        }

        // Send collateral to seller
        require(collateral.transfer(msg.sender, collateralOut), "PronosAMM: transfer failed");

        emit SharesSold(msg.sender, sellYes, sharesAmount, collateralOut, fee);
    }

    // ─── View functions ──────────────────────────────────────────────────────

    /// @notice Current price of YES token (scaled to 1e6, i.e. 500000 = $0.50)
    function priceYes() external view returns (uint256) {
        if (reserveYes + reserveNo == 0) return 500_000;
        return (reserveNo * 1e6) / (reserveYes + reserveNo);
    }

    /// @notice Current price of NO token (scaled to 1e6)
    function priceNo() external view returns (uint256) {
        if (reserveYes + reserveNo == 0) return 500_000;
        return (reserveYes * 1e6) / (reserveYes + reserveNo);
    }

    /// @notice Current fee percentage in basis points.
    function currentFeeBps(bool) external pure returns (uint256) {
        return FEE_BPS;
    }

    /// @notice Estimate shares out for a given collateral input (after fees)
    function estimateBuy(bool buyYes, uint256 collateralAmount) external view returns (uint256) {
        uint256 fee = calculateFee(collateralAmount, buyYes);
        uint256 netAmount = collateralAmount - fee;
        uint256 k = reserveYes * reserveNo;

        if (buyYes) {
            uint256 newNo = reserveNo + netAmount;
            uint256 newYes = (k + newNo - 1) / newNo;
            return (reserveYes + netAmount) - newYes;
        } else {
            uint256 newYes = reserveYes + netAmount;
            uint256 newNo = (k + newYes - 1) / newYes;
            return (reserveNo + netAmount) - newNo;
        }
    }

    /// @notice Estimate collateral out for selling shares (after fees)
    function estimateSell(bool sellYes, uint256 sharesAmount) external view returns (uint256) {
        uint256 k = reserveYes * reserveNo;
        uint256 a;
        uint256 b;

        if (sellYes) {
            a = reserveYes + sharesAmount;
            b = reserveNo;
        } else {
            a = reserveNo + sharesAmount;
            b = reserveYes;
        }

        uint256 diff = a > b ? a - b : b - a;
        uint256 discriminant = diff * diff + 4 * k;
        uint256 sqrtDisc = _sqrt(discriminant);
        uint256 c = (a + b - sqrtDisc) / 2;

        uint256 fee = calculateFee(c, !sellYes);
        return c - fee;
    }

    // ─── Resolution & Redemption ─────────────────────────────────────────────

    function resolve(uint8 _outcome) external onlyFactory {
        require(!resolved, "PronosAMM: already resolved");
        require(_outcome == 1 || _outcome == 2, "PronosAMM: invalid outcome");
        resolved = true;
        outcome = _outcome;
        emit MarketResolved(marketId, _outcome);
    }

    /// @notice Redeem winning tokens for USDC (1 token = 1 USDC).
    function redeem(uint256 amount) external {
        require(resolved, "PronosAMM: not resolved");
        require(amount > 0, "PronosAMM: zero amount");

        uint256 winningTokenId = outcome == 1 ? yesId : noId;
        token.burn(msg.sender, winningTokenId, amount);
        require(collateral.transfer(msg.sender, amount), "PronosAMM: transfer failed");

        emit WinningsRedeemed(msg.sender, amount, amount);
    }

    // ─── Admin (via factory) ─────────────────────────────────────────────────

    function setPaused(bool _paused) external onlyFactory {
        paused = _paused;
        emit MarketPaused(_paused);
    }

    function setFeeCollector(address _feeCollector) external onlyFactory {
        require(_feeCollector != address(0), "PronosAMM: zero address");
        feeCollector = _feeCollector;
    }

    // ─── Internal: Babylonian square root ────────────────────────────────────

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        y = x;
        uint256 z = (x + 1) / 2;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
