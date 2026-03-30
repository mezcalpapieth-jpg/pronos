// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PronosToken.sol";
import "./PronosAMM.sol";

/**
 * @title MarketFactory
 * @notice Creates and manages Pronos prediction markets.
 *         Owner (Safe multisig) can create markets, resolve them, and manage fees.
 *
 * Revenue distribution:
 *   70% treasury, 20% liquidity reserve, 10% emergency reserve
 */
contract MarketFactory {
    // ─── State ────────────────────────────────────────────────────────────────

    PronosToken public immutable token;
    IERC20      public immutable collateral; // USDC

    address public owner;       // Safe multisig
    address public resolver;    // Can be same as owner or separate multisig (2/3)

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
    event FeesDistributed(uint256 treasury, uint256 liquidity, uint256 emergency);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MarketFactory: not owner");
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
     * @param seedAmount USDC amount to seed as initial liquidity
     * @return marketId  The new market's ID
     */
    function createMarket(
        string calldata question,
        string calldata category,
        uint256 endTime,
        string calldata resolutionSource,
        uint256 seedAmount
    ) external onlyOwner returns (uint256 marketId) {
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

        // Transfer seed USDC from owner to this contract, then approve pool
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

    // ─── Fee Distribution (70/20/10) ─────────────────────────────────────────

    /**
     * @notice Distribute fees from feeCollector wallet (70/20/10 split).
     *         Requires feeCollector to have approved this contract.
     */
    function distributeFees() external onlyOwner {
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

    function setResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "MarketFactory: zero address");
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "MarketFactory: zero address");
        feeCollector = _feeCollector;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "MarketFactory: zero address");
        treasury = _treasury;
    }

    function setLiquidityReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactory: zero address");
        liquidityReserve = _reserve;
    }

    function setEmergencyReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactory: zero address");
        emergencyReserve = _reserve;
    }
}
