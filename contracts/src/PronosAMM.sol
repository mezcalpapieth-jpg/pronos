// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PronosToken.sol";

/**
 * @title PronosAMM
 * @notice CPMM (x*y=k) automated market maker for a single binary market.
 *
 * Dynamic fee formula: fee% = 5 * (1 - P) where P is the probability of the
 * side being bought. This means fees are higher when markets are uncertain
 * and lower when they're decisive:
 *   At 50/50: 2.5%
 *   At 90/10: 0.5%
 *   At 99/1:  0.05%
 *
 * Fees are deducted BEFORE entering the pool and sent to the fee collector.
 * They never touch the AMM reserves.
 */
contract PronosAMM is ERC1155Holder, ReentrancyGuard {
    // ─── State ────────────────────────────────────────────────────────────────

    PronosToken public immutable token;
    // Generic ERC-20 collateral. On Arbitrum One this is MXNB
    // (0xF197FFC28c23E0309B5559e7a166f2c6164C80aA). On testnets use
    // MockMXNB with the same 6-decimal convention.
    IERC20      public immutable collateral;
    address     public immutable factory;

    uint256 public immutable marketId;
    uint256 public immutable yesId;
    uint256 public immutable noId;

    uint256 public reserveYes;
    uint256 public reserveNo;

    address public feeCollector;
    uint256 public totalFeesCollected;

    bool public initialized;
    bool public paused;
    bool public resolved;
    uint8 public outcome; // 0=unresolved, 1=YES, 2=NO

    /// @notice block.timestamp at which resolve() was called. 0 while
    /// the market is open. Used by recoverDust() to enforce the
    /// post-resolution grace period during which holders can redeem
    /// before any residual liquidity gets swept.
    uint256 public resolvedAt;

    /// @notice Window after resolution before the factory can sweep
    /// leftover collateral. Long enough that any user with a winning
    /// position has time to redeem; short enough that the protocol
    /// recovers seed promptly. Constant rather than configurable —
    /// keeps the trust story simple.
    uint256 public constant RECOVER_GRACE_PERIOD = 30 days;

    // ─── Events ──────────────────────────────────────────────────────────────

    event LiquidityAdded(address indexed provider, uint256 amount);
    event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut);
    event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event WinningsRedeemed(address indexed user, uint256 shares, uint256 payout);
    event MarketPaused(bool paused);
    /// @notice Emitted when the factory sweeps the AMM's leftover
    /// collateral after resolution + grace period. `amount` is the
    /// collateral transferred — equal to the AMM's winning-token
    /// reserve at sweep time, which is exactly the seed minus any
    /// CPMM convexity drag absorbed by trading.
    event DustRecovered(address indexed recipient, uint256 amount);

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

    // ─── Dynamic Fee Calculation ─────────────────────────────────────────────

    /**
     * @notice Calculate dynamic fee: fee% = 5 * (1 - P)
     *         P = probability of the side being bought (0 to 1, scaled to 1e6)
     *         Returns fee amount in collateral units.
     *
     *         fee = amount * 5 * (1e6 - P) / (100 * 1e6)
     *             = amount * 5 * (1e6 - P) / 1e8
     */
    function calculateFee(uint256 amount, bool buyYes) public view returns (uint256) {
        uint256 totalReserves = reserveYes + reserveNo;
        if (totalReserves == 0) return (amount * 25) / 1000; // 2.5% default at 50/50

        // P = probability of the side being bought (scaled to 1e6)
        uint256 p;
        if (buyYes) {
            p = (reserveNo * 1e6) / totalReserves; // price of YES
        } else {
            p = (reserveYes * 1e6) / totalReserves; // price of NO
        }

        // fee = amount * 5 * (1e6 - p) / 1e8
        // At P=0.5: fee = amount * 5 * 500000 / 1e8 = amount * 0.025 = 2.5%
        // At P=0.9: fee = amount * 5 * 100000 / 1e8 = amount * 0.005 = 0.5%
        // At P=0.99: fee = amount * 5 * 10000 / 1e8 = amount * 0.0005 = 0.05%
        uint256 fee = (amount * 5 * (1e6 - p)) / 1e8;

        // Minimum fee of 1 unit to avoid zero-fee trades
        if (fee == 0 && amount > 0) fee = 1;
        return fee;
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
     * @notice Buy outcome tokens with collateral.
     *         Fee is deducted first and sent to feeCollector.
     *         Remaining collateral enters the pool.
     */
    function buy(bool buyYes, uint256 collateralAmount)
        external
        nonReentrant
        whenNotPaused
        whenNotResolved
        returns (uint256 sharesOut)
    {
        require(initialized, "PronosAMM: not initialized");
        require(collateralAmount > 0, "PronosAMM: zero amount");

        // 1. Calculate and deduct fee BEFORE pool
        uint256 fee = calculateFee(collateralAmount, buyYes);
        uint256 netAmount = collateralAmount - fee;
        // Guard against dust trades where the entire amount is fee. With
        // the round-up minimum-fee-of-1 in calculateFee, very small inputs
        // can land at fee == amount, leaving netAmount == 0 — the pool
        // would then mint a 0-pair, transfer 0 shares, but still consume
        // the user's collateral as a fee. Reject explicitly so the user
        // doesn't lose dust to a no-op trade.
        require(netAmount > 0, "PronosAMM: amount below fee");

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
     * @notice Sell outcome tokens back for collateral.
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
        nonReentrant
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
        //
        // Round-direction matters here: _sqrt returns FLOOR, which makes
        // (a+b - sqrt) round UP, which makes c round UP, which means the
        // pool pays out slightly more than the exact CPMM solution and k
        // slowly leaks. To pin k as monotonic-non-decreasing across sells
        // (verified by the fuzz test in test/PronosAMMFuzz.t.sol), we
        // promote sqrt to its CEILING so the subtraction goes the other
        // way and c rounds DOWN. The pool keeps the rounding crumb;
        // sellers receive at most 1 wei less than the exact solution
        // (negligible at 6-decimal collateral scale).
        uint256 diff = a > b ? a - b : b - a;
        uint256 discriminant = diff * diff + 4 * k;
        uint256 sqrtDisc = _sqrt(discriminant);
        if (sqrtDisc * sqrtDisc < discriminant) {
            sqrtDisc += 1; // promote floor to ceil
        }
        require(a + b >= sqrtDisc, "PronosAMM: insufficient output");
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

    /// @notice Current dynamic fee percentage (scaled to 1e4, e.g. 250 = 2.5%)
    function currentFeeBps(bool buyYes) external view returns (uint256) {
        uint256 totalReserves = reserveYes + reserveNo;
        if (totalReserves == 0) return 250;
        uint256 p;
        if (buyYes) {
            p = (reserveNo * 1e6) / totalReserves;
        } else {
            p = (reserveYes * 1e6) / totalReserves;
        }
        // feeBps = 500 * (1e6 - p) / 1e6
        return (500 * (1e6 - p)) / 1e6;
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
        // Match sell()'s ceil-of-sqrt rounding so the estimate exactly
        // matches the on-chain payout. See sell() for the full rationale.
        if (sqrtDisc * sqrtDisc < discriminant) {
            sqrtDisc += 1;
        }
        if (a + b < sqrtDisc) return 0;
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
        resolvedAt = block.timestamp;
        emit MarketResolved(marketId, _outcome);
    }

    /// @notice Sweep the AMM's leftover collateral after resolution +
    /// grace period. Designed for the protocol to recover the seed
    /// liquidity it provided at market creation, minus whatever
    /// convexity drag trading inflicted.
    ///
    /// Mechanism: at resolution the AMM still holds `reserveYes` (or
    /// `reserveNo`, depending on outcome) of winning tokens that
    /// nobody can redeem because the AMM is itself the holder. After
    /// the grace period, this burns the AMM's own winning tokens and
    /// transfers an equal amount of collateral to the recipient.
    /// User-held winning tokens stay intact — every user who hasn't
    /// redeemed yet can still call `redeem()` because we only
    /// transfer collateral 1:1 with the burned reserve, preserving
    /// the `outstanding_winning_tokens == collateral_balance`
    /// invariant.
    ///
    /// Idempotent: subsequent calls after the reserve is drained are
    /// no-ops (no revert).
    function recoverDust(address recipient) external onlyFactory nonReentrant {
        require(resolved, "PronosAMM: not resolved");
        require(block.timestamp >= resolvedAt + RECOVER_GRACE_PERIOD, "PronosAMM: grace period not over");
        require(recipient != address(0), "PronosAMM: zero recipient");

        uint256 winningTokenId = outcome == 1 ? yesId : noId;
        uint256 ammWinningBalance = token.balanceOf(address(this), winningTokenId);
        if (ammWinningBalance == 0) {
            // Already swept (or never had a reserve, which shouldn't
            // happen post-initialize). Return cleanly so the caller
            // doesn't have to special-case idempotent sweeps.
            return;
        }

        token.burn(address(this), winningTokenId, ammWinningBalance);
        require(collateral.transfer(recipient, ammWinningBalance), "PronosAMM: transfer failed");

        emit DustRecovered(recipient, ammWinningBalance);
    }

    /// @notice Push-redeem: factory pays out a holder's winnings
    /// without the holder needing to send a tx. The AMM burns
    /// `amount` of the holder's winning tokens and transfers 1:1
    /// collateral to that same holder. Caller (factory) pays gas.
    ///
    /// Designed for the post-resolution wind-down cron: after the
    /// 30-day grace period for self-claim, the protocol sweeps each
    /// remaining winner so nobody is stranded forever holding
    /// unredeemed tokens. The collateral always lands at `holder` —
    /// no theft vector even though anyone-via-factory can invoke.
    function redeemOnBehalf(address holder, uint256 amount) external onlyFactory nonReentrant {
        require(resolved, "PronosAMM: not resolved");
        require(amount > 0, "PronosAMM: zero amount");
        require(holder != address(0), "PronosAMM: zero holder");

        uint256 winningTokenId = outcome == 1 ? yesId : noId;
        token.burn(holder, winningTokenId, amount);
        require(collateral.transfer(holder, amount), "PronosAMM: transfer failed");

        emit WinningsRedeemed(holder, amount, amount);
    }

    /// @notice Redeem winning tokens for collateral (1 token = 1 collateral unit).
    function redeem(uint256 amount) external nonReentrant {
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
