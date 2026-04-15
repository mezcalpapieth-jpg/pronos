// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title PronosTokenV2
 * @notice ERC-1155 conditional tokens for multi-outcome Pronos markets.
 *         Token IDs use marketId * TOKEN_STRIDE + outcomeIndex so v2 markets
 *         can safely support more than two outcomes without colliding.
 */
contract PronosTokenV2 is ERC1155 {
    uint256 public constant TOKEN_STRIDE = 256;
    uint8 public constant MAX_OUTCOMES = 8;

    address public owner;
    mapping(address => bool) public minters;

    uint256 public nextMarketId;
    mapping(uint256 => uint8) public outcomeCounts;

    event MarketRegistered(uint256 indexed marketId, uint8 outcomeCount);
    event MinterSet(address indexed minter, bool allowed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "PronosTokenV2: not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "PronosTokenV2: not minter");
        _;
    }

    constructor() ERC1155("") {
        owner = msg.sender;
    }

    function tokenId(uint256 marketId, uint8 outcomeIndex) public pure returns (uint256) {
        return marketId * TOKEN_STRIDE + outcomeIndex;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PronosTokenV2: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function registerMarket(uint8 outcomeCount) external onlyMinter returns (uint256 marketId) {
        require(outcomeCount >= 2, "PronosTokenV2: too few outcomes");
        require(outcomeCount <= MAX_OUTCOMES, "PronosTokenV2: too many outcomes");
        marketId = nextMarketId;
        nextMarketId++;
        outcomeCounts[marketId] = outcomeCount;
        emit MarketRegistered(marketId, outcomeCount);
    }

    function mintCompleteSet(address to, uint256 marketId, uint256 amount) external onlyMinter {
        uint8 count = outcomeCounts[marketId];
        require(count >= 2, "PronosTokenV2: unknown market");
        for (uint8 i = 0; i < count; i++) {
            _mint(to, tokenId(marketId, i), amount, "");
        }
    }

    function burnCompleteSet(address from, uint256 marketId, uint256 amount) external onlyMinter {
        uint8 count = outcomeCounts[marketId];
        require(count >= 2, "PronosTokenV2: unknown market");
        for (uint8 i = 0; i < count; i++) {
            _burn(from, tokenId(marketId, i), amount);
        }
    }

    function burn(address from, uint256 id, uint256 amount) external onlyMinter {
        _burn(from, id, amount);
    }
}
