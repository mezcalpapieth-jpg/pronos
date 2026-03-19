/**
 * close-betting.ts
 * ────────────────
 * Closes betting before kickoff. Run ~15 minutes before the match starts.
 *
 * Usage:
 *   cd scripts && npm run close
 *   — or —
 *   npx ts-node close-betting.ts
 */

import {
  publicClient,
  walletClient,
  account,
  PRONOS_BET_ADDRESS,
  PRONOS_BET_ABI,
  formatUSDC,
} from "./config";

async function main() {
  console.log("\n=== PRONOS · CLOSE BETTING ===\n");
  console.log("Admin wallet:", account.address);
  console.log("Contract:    ", PRONOS_BET_ADDRESS);

  // Read current state
  const [bettingOpen, resolved, , totalPool] = await publicClient.readContract({
    address: PRONOS_BET_ADDRESS,
    abi:     PRONOS_BET_ABI,
    functionName: "getMarketState",
  }) as [boolean, boolean, number, bigint, bigint, bigint, bigint];

  console.log("\nCurrent state:");
  console.log("  Betting open:", bettingOpen);
  console.log("  Resolved:    ", resolved);
  console.log("  Total pool:  ", formatUSDC(totalPool));

  if (!bettingOpen) {
    console.log("\n⚠️  Betting is already closed. Nothing to do.");
    return;
  }

  if (resolved) {
    console.log("\n⚠️  Market already resolved. Nothing to do.");
    return;
  }

  console.log("\nClosing betting...");

  const hash = await walletClient.writeContract({
    address: PRONOS_BET_ADDRESS,
    abi:     PRONOS_BET_ABI,
    functionName: "closeBetting",
  });

  console.log("  Tx hash:", hash);
  console.log("  Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("\n✅ Betting closed!");
  console.log("  Block:", receipt.blockNumber.toString());
  console.log("  Status:", receipt.status);
  console.log("\n  No more bets can be placed.");
  console.log("  Run resolve-market.ts after the match ends.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
