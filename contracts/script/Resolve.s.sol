// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PronoBet.sol";

/**
 * @title Resolve
 * @notice Admin script to resolve the market after the match.
 *
 * Outcomes:
 *   1 = México gana
 *   2 = Empate
 *   3 = Sudáfrica gana
 *
 * Run command (example — Mexico wins):
 *   OUTCOME=1 forge script script/Resolve.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 *
 * IMPORTANT: This is permanent. Double-check the result before broadcasting.
 */
contract Resolve is Script {
    function run() external {
        uint256 deployerKey   = vm.envUint("PRIVATE_KEY");
        address pronosBetAddr = vm.envAddress("PRONOS_BET_ADDRESS");
        uint8   outcome       = uint8(vm.envUint("OUTCOME"));

        require(outcome >= 1 && outcome <= 3, "OUTCOME must be 1, 2 or 3");

        PronoBet pronoBet = PronoBet(pronosBetAddr);

        string[4] memory labels = ["", "MEXICO GANA", "EMPATE", "SUDAFRICA GANA"];

        console.log("=== PRONOS RESOLVE ===");
        console.log("Contract:", pronosBetAddr);
        console.log("Outcome:", outcome, labels[outcome]);
        console.log("Current result (0 = pending):", pronoBet.result());
        console.log("Already resolved?", pronoBet.resolved());
        console.log("Total pool (USDC raw):", pronoBet.totalPool());

        require(!pronoBet.resolved(), "Market already resolved!");

        console.log("");
        console.log("!! BROADCASTING RESOLUTION — this is PERMANENT !!");
        console.log("");

        vm.startBroadcast(deployerKey);
        pronoBet.resolve(outcome);
        vm.stopBroadcast();

        console.log("=== RESOLVED ===");
        console.log("Result set to:", pronoBet.result(), labels[pronoBet.result()]);
        console.log("Users can now call claimWinnings() on the frontend.");
    }
}
