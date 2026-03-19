// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PronoBet.sol";

/**
 * @title Deploy
 * @notice Deploys PronoBet to Base Sepolia (or Base mainnet).
 *
 * Run command:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     -vvvv
 *
 * After running, copy the deployed address into ../deployments.json
 */
contract Deploy is Script {
    // Base Sepolia USDC
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Base Mainnet USDC
    address constant USDC_BASE_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        console.log("=== PRONOS DEPLOY ===");
        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        // Pick USDC address based on chain
        address usdc = block.chainid == 8453
            ? USDC_BASE_MAINNET
            : USDC_BASE_SEPOLIA;

        console.log("USDC:", usdc);

        vm.startBroadcast(deployerKey);

        PronoBet pronoBet = new PronoBet(usdc, deployer);

        vm.stopBroadcast();

        console.log("");
        console.log("=== DEPLOYED ===");
        console.log("PronoBet:", address(pronoBet));
        console.log("Owner:", pronoBet.owner());
        console.log("USDC:", address(pronoBet.usdc()));
        console.log("Betting open:", pronoBet.bettingOpen());
        console.log("");
        console.log(">> Add to deployments.json:");
        console.log(
            string.concat(
                '{ "PronoBet": "',
                vm.toString(address(pronoBet)),
                '", "USDC": "',
                vm.toString(usdc),
                '", "chainId": ',
                vm.toString(block.chainid),
                ' }'
            )
        );
    }
}
