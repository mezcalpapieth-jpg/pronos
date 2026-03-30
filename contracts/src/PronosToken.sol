// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title PronosToken
 * @notice ERC-1155 conditional tokens for Pronos prediction markets.
 *         Each market has two token IDs: YES = marketId*2, NO = marketId*2+1.
 *         Only authorized minters (AMM pools) can mint/burn.
 */
contract PronosToken is ERC1155 {
    address public owner;
    mapping(address => bool) public minters;

    uint256 public nextMarketId;

    event MarketRegistered(uint256 indexed marketId);
    event MinterSet(address indexed minter, bool allowed);

    modifier onlyOwner() {
        require(msg.sender == owner, "PronosToken: not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender], "PronosToken: not minter");
        _;
    }

    constructor() ERC1155("") {
        owner = msg.sender;
    }

    // ─── Token ID helpers ────────────────────────────────────────────────────

    function yesTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2;
    }

    function noTokenId(uint256 marketId) public pure returns (uint256) {
        return marketId * 2 + 1;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PronosToken: zero address");
        owner = newOwner;
    }

    /// @notice Register a new market, returns its ID.
    function registerMarket() external onlyMinter returns (uint256 marketId) {
        marketId = nextMarketId;
        nextMarketId++;
        emit MarketRegistered(marketId);
    }

    // ─── Mint / Burn (only authorized minters) ──────────────────────────────

    /// @notice Split collateral into YES + NO tokens (1:1).
    function mintPair(address to, uint256 marketId, uint256 amount) external onlyMinter {
        _mint(to, yesTokenId(marketId), amount, "");
        _mint(to, noTokenId(marketId), amount, "");
    }

    /// @notice Merge YES + NO tokens back into collateral (1:1).
    function burnPair(address from, uint256 marketId, uint256 amount) external onlyMinter {
        _burn(from, yesTokenId(marketId), amount);
        _burn(from, noTokenId(marketId), amount);
    }

    /// @notice Burn winning tokens for redemption.
    function burn(address from, uint256 tokenId, uint256 amount) external onlyMinter {
        _burn(from, tokenId, amount);
    }
}
