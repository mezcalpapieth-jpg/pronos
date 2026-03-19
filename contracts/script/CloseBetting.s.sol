// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PronoBet.sol";

/**
 * @title CloseBetting
 * @notice Admin script to close betting before kickoff.
 *         Run this ~15 minutes before the match starts.
 *
 * Run command:
 *   forge script script/CloseBetting.s.sol \
 *     --rpc-url $BASE_SEPOLIA_RPC \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     -vvvv
 */
contract CloseBetting is Script {
    function run() external {
        uint256 deployerKey   = vm.envUint("PRIVATE_KEY");
        address pronosBetAddr = vm.envAddress("PRONOS_BET_ADDRESS");

        PronoBet pronoBet = PronoBet(pronosBetAddr);

        console.log("=== CLOSE BETTING ===");
        console.log("Contract:", pronosBetAddr);
        console.log("Betting currently open?", pronoBet.bettingOpen());
        console.log("Total pool:", pronoBet.totalPool());

        vm.startBroadcast(deployerKey);
        pronoBet.closeBetting();
        vm.stopBroadcast();

        console.log("Betting closed. No more bets accepted.");
    }
}
