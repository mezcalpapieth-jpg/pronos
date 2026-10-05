// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TournamentMXNP
 * @notice Testnet-only tournament collateral for Points on-chain cycles.
 *         Unlike MockMXNB, this token has no public faucet: an owner/operator
 *         mints the exact reset allocation for eligible tournament wallets.
 */
contract TournamentMXNP is ERC20 {
    uint8 private constant _DECIMALS = 6;

    address public owner;

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "TournamentMXNP: not owner");
        _;
    }

    constructor(address initialOwner) ERC20("Tournament MXNP", "MXNP") {
        require(initialOwner != address(0), "TournamentMXNP: zero owner");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "TournamentMXNP: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        require(to != address(0), "TournamentMXNP: zero recipient");
        _mint(to, amount);
    }

    function batchMint(address[] calldata recipients, uint256[] calldata amounts) external onlyOwner {
        require(recipients.length == amounts.length, "TournamentMXNP: length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "TournamentMXNP: zero recipient");
            _mint(recipients[i], amounts[i]);
        }
    }
}
