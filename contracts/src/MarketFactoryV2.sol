// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./PronosTokenV2.sol";
import "./PronosAMMMulti.sol";

/**
 * @title MarketFactoryV2
 * @notice Creates and manages Pronos multi-outcome markets.
 */
contract MarketFactoryV2 {
    PronosTokenV2 public immutable token;
    IERC20 public immutable collateral;

    address public owner;
    address public resolver;

    address public treasury;
    address public liquidityReserve;
    address public emergencyReserve;
    address public feeCollector;

    struct Market {
        address pool;
        string question;
        string category;
        uint256 endTime;
        string resolutionSource;
        uint8 outcomeCount;
        bool active;
    }

    Market[] public markets;
    mapping(uint256 => string[]) private marketOutcomes;

    event MarketCreated(
        uint256 indexed marketId,
        address pool,
        string question,
        string category,
        uint256 endTime,
        string resolutionSource,
        string[] outcomes
    );
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event MarketPaused(uint256 indexed marketId, bool paused);
    event FeesDistributed(uint256 treasury, uint256 liquidity, uint256 emergency);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event ResolverUpdated(address indexed oldResolver, address indexed newResolver);

    modifier onlyOwner() {
        require(msg.sender == owner, "MarketFactoryV2: not owner");
        _;
    }

    modifier onlyResolver() {
        require(msg.sender == resolver || msg.sender == owner, "MarketFactoryV2: not resolver");
        _;
    }

    constructor(
        address _token,
        address _collateral,
        address _treasury,
        address _liquidityReserve,
        address _emergencyReserve
    ) {
        token = PronosTokenV2(_token);
        collateral = IERC20(_collateral);
        owner = msg.sender;
        resolver = msg.sender;
        treasury = _treasury;
        liquidityReserve = _liquidityReserve;
        emergencyReserve = _emergencyReserve;
        feeCollector = _treasury;
    }

    function createMarket(
        string calldata question,
        string calldata category,
        uint256 endTime,
        string calldata resolutionSource,
        string[] calldata outcomes,
        uint256 seedAmount
    ) external onlyOwner returns (uint256 marketId) {
        require(endTime > block.timestamp, "MarketFactoryV2: end time in past");
        require(outcomes.length >= 2, "MarketFactoryV2: too few outcomes");
        require(outcomes.length <= token.MAX_OUTCOMES(), "MarketFactoryV2: too many outcomes");
        require(seedAmount > 0, "MarketFactoryV2: zero seed");

        for (uint256 i = 0; i < outcomes.length; i++) {
            require(bytes(outcomes[i]).length > 0, "MarketFactoryV2: empty outcome");
        }

        marketId = token.registerMarket(uint8(outcomes.length));

        PronosAMMMulti pool = new PronosAMMMulti(
            address(token),
            address(collateral),
            marketId,
            uint8(outcomes.length),
            feeCollector
        );

        token.setMinter(address(pool), true);

        require(collateral.transferFrom(msg.sender, address(this), seedAmount), "MarketFactoryV2: seed transfer failed");
        require(collateral.approve(address(pool), seedAmount), "MarketFactoryV2: approve failed");
        pool.initialize(address(this), seedAmount);

        markets.push(Market({
            pool: address(pool),
            question: question,
            category: category,
            endTime: endTime,
            resolutionSource: resolutionSource,
            outcomeCount: uint8(outcomes.length),
            active: true
        }));

        for (uint256 i = 0; i < outcomes.length; i++) {
            marketOutcomes[marketId].push(outcomes[i]);
        }

        emit MarketCreated(marketId, address(pool), question, category, endTime, resolutionSource, outcomes);
    }

    function resolveMarket(uint256 marketId, uint8 outcome) external onlyResolver {
        require(marketId < markets.length, "MarketFactoryV2: invalid market");
        Market storage m = markets[marketId];
        require(m.active, "MarketFactoryV2: not active");
        require(outcome < m.outcomeCount, "MarketFactoryV2: invalid outcome");

        PronosAMMMulti(m.pool).resolve(outcome);
        m.active = false;

        emit MarketResolved(marketId, outcome);
    }

    function pauseMarket(uint256 marketId, bool paused) external onlyOwner {
        require(marketId < markets.length, "MarketFactoryV2: invalid market");
        PronosAMMMulti(markets[marketId].pool).setPaused(paused);
        emit MarketPaused(marketId, paused);
    }

    function distributeFees() external onlyOwner {
        uint256 total = collateral.balanceOf(feeCollector);
        require(total > 0, "MarketFactoryV2: no fees");

        uint256 toTreasury = (total * 70) / 100;
        uint256 toLiquidity = (total * 20) / 100;
        uint256 toEmergency = total - toTreasury - toLiquidity;

        require(collateral.transferFrom(feeCollector, treasury, toTreasury), "MarketFactoryV2: treasury failed");
        require(collateral.transferFrom(feeCollector, liquidityReserve, toLiquidity), "MarketFactoryV2: liquidity failed");
        require(collateral.transferFrom(feeCollector, emergencyReserve, toEmergency), "MarketFactoryV2: emergency failed");

        emit FeesDistributed(toTreasury, toLiquidity, toEmergency);
    }

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function getOutcomes(uint256 marketId) external view returns (string[] memory) {
        require(marketId < markets.length, "MarketFactoryV2: invalid market");
        return marketOutcomes[marketId];
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
            uint8 outcomeCount,
            bool active
        )
    {
        require(marketId < markets.length, "MarketFactoryV2: invalid market");
        Market storage m = markets[marketId];
        return (
            m.pool,
            m.question,
            m.category,
            m.endTime,
            m.resolutionSource,
            m.outcomeCount,
            m.active
        );
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MarketFactoryV2: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setResolver(address newResolver) external onlyOwner {
        require(newResolver != address(0), "MarketFactoryV2: zero address");
        emit ResolverUpdated(resolver, newResolver);
        resolver = newResolver;
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "MarketFactoryV2: zero address");
        feeCollector = _feeCollector;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "MarketFactoryV2: zero address");
        treasury = _treasury;
    }

    function setLiquidityReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactoryV2: zero address");
        liquidityReserve = _reserve;
    }

    function setEmergencyReserve(address _reserve) external onlyOwner {
        require(_reserve != address(0), "MarketFactoryV2: zero address");
        emergencyReserve = _reserve;
    }
}
