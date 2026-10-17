// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MarketFactory.sol";
import "./MarketFactoryV2.sol";

interface IPoolIdentity {
    function factory() external view returns (address);
    function marketId() external view returns (uint256);
}

/// @notice Fixed, non-upgradeable Sepolia trading scope. Every call trades for
/// msg.sender and pays that same wallet. No arbitrary calls, recipients, token
/// transfers or admin entry points. Funds go directly between wallet and pool.
contract PronosTradingRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant VERSION = 1;
    MarketFactory public immutable factoryV1;
    MarketFactoryV2 public immutable factoryV2;
    IERC20 public immutable collateral;
    PronosToken public immutable tokenV1;
    PronosTokenV2 public immutable tokenV2;

    constructor(address v1, address v2) {
        require(block.chainid == 421614, "Router: Sepolia only");
        require(v1 != v2 && v1.code.length > 0 && v2.code.length > 0, "Router: factories");
        factoryV1 = MarketFactory(v1);
        factoryV2 = MarketFactoryV2(v2);
        collateral = factoryV1.collateral();
        require(address(collateral) == address(factoryV2.collateral()), "Router: collateral mismatch");
        tokenV1 = factoryV1.token();
        tokenV2 = factoryV2.token();
        require(address(tokenV1) != address(tokenV2), "Router: share tokens");
    }

    /// @dev A pool claiming a trusted factory is insufficient: the factory's
    /// own registry must point back to that exact pool. No mutable allowlist.
    function _market(address pool, bool trading) internal view returns (bool binary, uint256 id) {
        address factory = IPoolIdentity(pool).factory();
        id = IPoolIdentity(pool).marketId();
        address registered;
        uint256 endTime;
        bool active;
        if (factory == address(factoryV1)) {
            require(factoryV1.tradingRouter() == address(this), "Router: not bound");
            (registered, , , endTime, , active) = factoryV1.getMarket(id);
            binary = true;
        } else {
            require(factory == address(factoryV2), "Router: untrusted factory");
            require(factoryV2.tradingRouter() == address(this), "Router: not bound");
            (registered, , , endTime, , , active) = factoryV2.getMarket(id);
        }
        require(registered == pool, "Router: unregistered pool");
        if (trading) require(active && block.timestamp < endTime, "Router: market closed");
    }

    function marketRoute(address pool) external view returns (bool binary, uint256 marketId) {
        return _market(pool, false);
    }

    function buy(address pool, uint8 outcomeIndex, uint256 amount, uint256 minSharesOut)
        external nonReentrant returns (uint256 sharesOut)
    {
        require(amount > 0 && minSharesOut > 0, "Router: amount or guard");
        (bool binary, ) = _market(pool, true);
        if (binary) require(outcomeIndex < 2, "Router: outcome");
        uint256 beforeBalance = collateral.balanceOf(pool);
        collateral.safeTransferFrom(msg.sender, pool, amount);
        require(collateral.balanceOf(pool) - beforeBalance == amount, "Router: transfer amount");
        return binary
            ? PronosAMM(pool).buyRouted(msg.sender, outcomeIndex == 0, amount, minSharesOut)
            : PronosAMMMulti(pool).buyRouted(msg.sender, outcomeIndex, amount, minSharesOut);
    }

    function sell(address pool, uint8 outcomeIndex, uint256 amount, uint256 minCollateralOut)
        external nonReentrant returns (uint256 collateralOut)
    {
        require(amount > 0 && minCollateralOut > 0, "Router: amount or guard");
        (bool binary, uint256 id) = _market(pool, true);
        if (binary) {
            require(outcomeIndex < 2, "Router: outcome");
            uint256 tokenId = outcomeIndex == 0 ? tokenV1.yesTokenId(id) : tokenV1.noTokenId(id);
            tokenV1.safeTransferFrom(msg.sender, pool, tokenId, amount, "");
            return PronosAMM(pool).sellRouted(msg.sender, outcomeIndex == 0, amount, minCollateralOut);
        }
        tokenV2.safeTransferFrom(msg.sender, pool, tokenV2.tokenId(id, outcomeIndex), amount, "");
        return PronosAMMMulti(pool).sellRouted(msg.sender, outcomeIndex, amount, minCollateralOut);
    }

    function redeem(address pool, uint256 amount) external nonReentrant {
        require(amount > 0, "Router: amount");
        (bool binary, ) = _market(pool, false);
        if (binary) PronosAMM(pool).redeemRouted(msg.sender, amount);
        else PronosAMMMulti(pool).redeemRouted(msg.sender, amount);
    }
}
