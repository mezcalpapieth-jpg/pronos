// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PronoBet.sol";

contract Deploy is Script {
    address constant USDC_SEPOLIA  = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant USDC_MAINNET  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        vm.startBroadcast();

        address usdc = block.chainid == 8453 ? USDC_MAINNET : USDC_SEPOLIA;
        PronoBet pronoBet = new PronoBet(usdc, msg.sender);

        vm.stopBroadcast();

        console.log("PronoBet deployed:", address(pronoBet));
    }
}
