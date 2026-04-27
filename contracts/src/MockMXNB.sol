// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockMXNB
 * @notice Test-only ERC-20 that mimics Bitso/Juno MXNB on Arbitrum Sepolia.
 *         Real MXNB is mainnet-only; this token lets us exercise the full
 *         buy/sell/redeem/seed flow with MXNB-branded collateral on testnet.
 *
 * Decimals: 6 (matches USDC convention; the Pronos backend's
 *           COLLATERAL_DECIMALS = 6 expects this).
 *
 * Faucet: anyone can call faucet() to receive 1,000 MXNB. No rate limit
 *         (testnet only — replace with real MXNB on mainnet, no faucet).
 *         faucetTo(address, amount) lets the deployer top up specific
 *         wallets with arbitrary amounts during seed/setup.
 *
 * SECURITY: this contract has unlimited public mint via faucet().
 *           NEVER deploy on mainnet. Replace ONCHAIN_COLLATERAL_ADDRESS
 *           with the real Bitso MXNB address before flipping mainnet on.
 */
contract MockMXNB is ERC20 {
    uint8 private constant _DECIMALS = 6;
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10**_DECIMALS; // 1,000 MXNB

    constructor() ERC20("Mock MXNB (Testnet)", "MXNB") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /**
     * @notice Mint 1,000 MXNB to the caller. Anyone can call. Testnet only.
     */
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    /**
     * @notice Mint a custom amount to a specific address. Useful for the
     *         deployer to seed many test wallets in one tx (or to fund
     *         the deployer wallet itself before calling factory.createMarket).
     */
    function faucetTo(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
