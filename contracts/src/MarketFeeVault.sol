// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Holds one factory's earned fees separately from its market backing.
contract MarketFeeVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable collateral;
    address public immutable factory;
    mapping(uint256 => uint256) public distributedByMarket;
    mapping(bytes32 => bool) public distributedBatches;

    event FeeBatchDistributed(
        bytes32 indexed batchId, uint256 indexed marketId, uint256 treasury, uint256 liquidity, uint256 emergency
    );

    constructor(IERC20 token) {
        collateral = token;
        factory = msg.sender;
    }

    function distribute(
        uint256 marketId, bytes32 batchId, uint256 amount, uint256 collected,
        address treasury, address liquidity, address emergency
    ) external {
        require(msg.sender == factory, "FeeVault: not factory");
        require(batchId != bytes32(0) && !distributedBatches[batchId], "FeeVault: invalid or used batch");
        require(amount > 0 && distributedByMarket[marketId] + amount <= collected, "FeeVault: exceeds earned fees");
        require(treasury != address(this) && liquidity != address(this) && emergency != address(this), "FeeVault: self recipient");

        distributedBatches[batchId] = true;
        distributedByMarket[marketId] += amount;
        uint256 toTreasury = amount * 70 / 100;
        uint256 toLiquidity = amount * 20 / 100;
        uint256 toEmergency = amount - toTreasury - toLiquidity;
        if (toTreasury != 0) collateral.safeTransfer(treasury, toTreasury);
        if (toLiquidity != 0) collateral.safeTransfer(liquidity, toLiquidity);
        collateral.safeTransfer(emergency, toEmergency);
        emit FeeBatchDistributed(batchId, marketId, toTreasury, toLiquidity, toEmergency);
    }
}
