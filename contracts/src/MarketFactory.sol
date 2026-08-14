// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PronosToken.sol";
import "./PronosAMM.sol";

/**
 * @title MarketFactory
 * @notice Creates and manages Pronos prediction markets.
 *         Owner (Safe multisig) manages admin powers, while a separate
 *         marketCreator can create markets without making every create
 *         action a multisig transaction.
 *
 * Revenue distribution:
 *   70% treasury, 20% liquidity reserve, 10% emergency reserve
 */
contract MarketFactory is ReentrancyGuard {
    // ─── State ────────────────────────────────────────────────────────────────

    PronosToken public immutable token;
    // Generic ERC-20 collateral. Arbitrum One: MXNB. Testnet:
    // MockMXNB. The contract doesn't care which token it is — only
    // the deploy script and environment do.
    IERC20      public immutable collateral;

    address public owner;         // Safe multisig
    address public marketCreator; // Turnkey ops wallet for automatic market creation
    address public resolver;      // Turnkey resolver, CRE adapter, or owner fallback

    // Revenue distribution addresses
    address public treasury;         // receives 70% of fees
    address public liquidityReserve; // receives 20% of fees
    address public emergencyReserve; // receives 10% of fees
    address public feeCollector;     // intermediate wallet that collects all fees

    struct Market {
        address   pool;           // PronosAMM address
        string    question;       // "Will Mexico win?"
        string    category;       // "deportes", "politica", etc.
        uint256   endTime;        // When betting closes
        string    resolutionSource; // "FIFA official results"
        bool      active;
    }

    Market[] public markets;

    // ─── Events ──────────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address pool,
        string question,
        string category,
        uint256 endTime
    );
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event MarketPaused(uint256 indexed marketId, bool paused);
    event MarketCanceled(uint256 indexed marketId);
    event ResolutionDisputeOpened(uint256 indexed marketId);
    event ResolutionDisputeCleared(uint256 indexed marketId);
    event MarketResolutionCorrected(uint256 indexed marketId, uint8 oldOutcome, uint8 newOutcome);
    event CancelRefundPushed(uint256 indexed marketId, address indexed holder, uint256 payout);
    event MarketRefundFunded(uint256 indexed marketId, uint256 amount);
    event FeesDistributed(uint256 treasury, uint256 liquidity, uint256 emergency);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event MarketCreatorUpdated(address indexed oldCreator, address indexed newCreator);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event LiquidityReserveUpdated(address indexed oldReserve, address indexed newReserve);
    event EmergencyReserveUpdated(address indexed oldReserve, address indexed newReserve);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MarketFactory: not owner");
        _;
    }

    modifier onlyMarketCreator() {
        require(msg.sender == marketCreator || msg.sender == owner, "MarketFactory: not creator");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver || msg.sender == owner, "MarketFactory: not resolver");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address _token,
        address _collateral,
        address _treasury,
        address _liquidityReserve,
        address _emergencyReserve
    ) {
        token             = PronosToken(_token);
        collateral        = IERC20(_collateral);
        owner             = msg.sender;
        marketCreator     = msg.sender;
        resolver          = msg.sender;
        treasury          = _treasury;
        liquidityReserve  = _liquidityReserve;
        emergencyReserve  = _emergencyReserve;
        feeCollector      = _treasury; // default: fees go to treasury
    }

    // ─── Market Creation ─────────────────────────────────────────────────────

    /**
     * @notice Create a new binary prediction market and seed it with liquidity.
     * @param question  The question (e.g. "Will Mexico beat SA?")
     * @param category  Category tag (e.g. "deportes")
     * @param endTime   Unix timestamp when betting closes
     * @param resolutionSource  How the outcome will be determined
     * @param seedAmount collateral amount to seed as initial liquidity
     * @return marketId  The new market's ID
     */
    function createMarket(
        string calldata question,
        string calldata category,
        uint256 endTime,
        string calldata resolutionSource,
        uint256 seedAmount
    ) external onlyMarketCreator returns (uint256 marketId) {
        require(endTime > block.timestamp, "MarketFactory: end time in past");
        require(seedAmount > 0, "MarketFactory: zero seed");

        // Register market in token contract
        marketId = token.registerMarket();

        // Deploy AMM pool
        PronosAMM pool = new PronosAMM(
            address(token),
            address(collateral),
            marketId,
            feeCollector
        );

        // Authorize pool as minter
        token.setMinter(address(pool), true);

        // Transfer seed collateral from owner to this contract, then approve pool
        require(collateral.transferFrom(msg.sender, address(this), seedAmount), "MarketFactory: seed transfer failed");
        require(collateral.approve(address(pool), seedAmount), "MarketFactory: approve failed");

        // Initialize pool with seed liquidity
        pool.initialize(address(this), seedAmount);

        // Store market data
        markets.push(Market({
            pool: address(pool),
            question: question,
            category: category,
            endTime: endTime,
            resolutionSource: resolutionSource,
            active: true
        }));

        emit MarketCreated(marketId, address(pool), question, category, endTime);
    }

    // ─── Market Management ───────────────────────────────────────────────────

    function resolveMarket(uint256 marketId, uint8 outcome) external onlyResolver {
        require(marketId < markets.length, "MarketFactory: invalid market");
        Market storage m = markets[marketId];
        require(m.active, "MarketFactory: not active");

        PronosAMM(m.pool).resolve(outcome);
        m.active = false;

        emit MarketResolved(marketId, outcome);
    }

    function pauseMarket(uint256 marketId, bool paused) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        PronosAMM(markets[marketId].pool).setPaused(paused);
        emit MarketPaused(marketId, paused);
    }

    function cancelMarket(uint256 marketId) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        Market storage m = markets[marketId];
        PronosAMM(m.pool).cancel();
        m.active = false;
        emit MarketCanceled(marketId);
    }

    function openResolutionDispute(uint256 marketId) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        PronosAMM(markets[marketId].pool).openResolutionDispute();
        emit ResolutionDisputeOpened(marketId);
    }

    function clearResolutionDispute(uint256 marketId) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        PronosAMM(markets[marketId].pool).clearResolutionDispute();
        emit ResolutionDisputeCleared(marketId);
    }

    function correctResolution(uint256 marketId, uint8 newOutcome) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        PronosAMM pool = PronosAMM(markets[marketId].pool);
        uint8 oldOutcome = pool.outcome();
        pool.correctResolution(newOutcome);
        emit MarketResolutionCorrected(marketId, oldOutcome, newOutcome);
        emit MarketResolved(marketId, newOutcome);
    }

    function fundMarketRefunds(uint256 marketId, uint256 amount) external onlyOwner nonReentrant {
        require(marketId < markets.length, "MarketFactory: invalid market");
        require(amount > 0, "MarketFactory: zero amount");
        require(collateral.transferFrom(msg.sender, markets[marketId].pool, amount), "MarketFactory: transfer failed");
        emit MarketRefundFunded(marketId, amount);
    }

    /**
     * @notice Sweep a resolved market's leftover collateral to the
     *         given recipient (typically treasury or liquidity reserve).
     *
     * The AMM's RECOVER_GRACE_PERIOD (30 days post-resolution) must
     * have elapsed before this succeeds — gives winning holders a
     * full month to redeem before the protocol recovers the residual.
     *
     * Idempotent: a second call after the AMM's reserve is drained
     * is a no-op (no revert), so a "sweep all resolved markets"
     * helper script can run blindly.
     */
    function sweepDust(uint256 marketId, address recipient) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        require(recipient != address(0), "MarketFactory: zero recipient");
        PronosAMM(markets[marketId].pool).recoverDust(recipient);
        emit DustSwept(marketId, recipient);
    }

    /// @notice Emitted on each successful sweep — useful for indexers
    /// reconciling treasury inflows back to specific markets.
    event DustSwept(uint256 indexed marketId, address indexed recipient);

    /**
     * @notice Batch push-redeem on a resolved market — pays each
     *         (holder, amount) pair without requiring holders to
     *         send their own tx. Designed for an off-chain cron
     *         that wakes up after the grace period and settles
     *         everyone still holding winning tokens.
     *
     * The protocol pays gas. Each redemption emits the same
     * WinningsRedeemed event as a self-claim so the indexer
     * doesn't need a separate code path.
     *
     * Sized for ~100 holders per tx; chunk above that.
     */
    function pushRedeem(
        uint256 marketId,
        address[] calldata holders,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        require(holders.length == amounts.length, "MarketFactory: length mismatch");
        require(holders.length > 0, "MarketFactory: empty batch");

        PronosAMM pool = PronosAMM(markets[marketId].pool);
        for (uint256 i = 0; i < holders.length; i++) {
            pool.redeemOnBehalf(holders[i], amounts[i]);
        }
    }

    function pushCancelRefund(
        uint256 marketId,
        address[] calldata holders,
        uint8[][] calldata outcomeIndexes,
        uint256[][] calldata burnAmounts,
        uint256[] calldata payouts
    ) external onlyOwner {
        require(marketId < markets.length, "MarketFactory: invalid market");
        require(holders.length == outcomeIndexes.length, "MarketFactory: length mismatch");
        require(holders.length == burnAmounts.length, "MarketFactory: length mismatch");
        require(holders.length == payouts.length, "MarketFactory: length mismatch");
        require(holders.length > 0, "MarketFactory: empty batch");

        PronosAMM pool = PronosAMM(markets[marketId].pool);
        for (uint256 i = 0; i < holders.length; i++) {
            pool.refundOnBehalf(holders[i], outcomeIndexes[i], burnAmounts[i], payouts[i]);
            emit CancelRefundPushed(marketId, holders[i], payouts[i]);
        }
    }

    // ─── Fee Distribution (70/20/10) ─────────────────────────────────────────

    /**
     * @notice Distribute fees from feeCollector wallet (70/20/10 split).
     *
     * Setup requirement (one-time, before first call):
     *     feeCollector must call collateral.approve(factoryAddress,
     *     uint256.max) so the factory can pull-and-distribute fees on
     *     each call. If feeCollector is a Safe multisig, sign that
     *     approve as the first transaction after setting feeCollector.
     *     Without it, distributeFees() reverts with "MarketFactory:
     *     treasury failed" (the underlying transferFrom fails on
     *     missing allowance).
     *
     * Distribution math: floor-truncates treasury and liquidity to
     *     keep them at exactly 70% / 20% of integer total. The
     *     emergency reserve receives `total - treasury - liquidity`,
     *     which absorbs the rounding remainder. No fees evaporate to
     *     rounding (verified by testFuzz_distributeFees_no_dust).
     */
    function distributeFees() external onlyOwner nonReentrant {
        uint256 total = collateral.balanceOf(feeCollector);
        require(total > 0, "MarketFactory: no fees");

        uint256 toTreasury  = (total * 70) / 100;
        uint256 toLiquidity = (total * 20) / 100;
        uint256 toEmergency = total - toTreasury - toLiquidity;

        // Pull from feeCollector and distribute
        require(collateral.transferFrom(feeCollector, treasury, toTreasury), "MarketFactory: treasury failed");
        require(collateral.transferFrom(feeCollector, liquidityReserve, toLiquidity), "MarketFactory: liquidity failed");
        require(collateral.transferFrom(feeCollector, emergencyReserve, toEmergency), "MarketFactory: emergency failed");

        emit FeesDistributed(toTreasury, toLiquidity, toEmergency);
    }

    // ─── View Functions ──────────────────────────────────────────────────────

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarket(uint256 marketId)
        external
        view
        returns (
            address pool,
            string memory question,
            string memory category,
            uint256 endTime,
            string memory resolutionSource,
            bool active
        )
    {
        require(marketId < markets.length, "MarketFactory: invalid market");
        Market storage m = markets[marketId];
        return (m.pool, m.question, m.category, m.endTime, m.resolutionSource, m.active);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MarketFactory: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setMarketCreator(address newCreator) external onlyOwner {
        require(newCreator != address(0), "MarketFactory: zero address");
        emit MarketCreatorUpdated(marketCreator, newCreator);
        marketCreator = newCreator;
    }

    function setResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "MarketFactory: zero address");
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "MarketFactory: zero address");
        emit FeeCollectorUpdated(feeCollector, _feeCollector);
        feeCollector = _feeCollector;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "MarketFactory: zero address");
        emit TreasuryUpdated(treasury, _treasury);
        treasury = _treasury;
    }

    function setLiquidityReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactory: zero address");
        emit LiquidityReserveUpdated(liquidityReserve, _reserve);
        liquidityReserve = _reserve;
    }

    function setEmergencyReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactory: zero address");
        emit EmergencyReserveUpdated(emergencyReserve, _reserve);
        emergencyReserve = _reserve;
    }
}
