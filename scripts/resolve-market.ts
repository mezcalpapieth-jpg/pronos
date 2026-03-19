/**
 * resolve-market.ts
 * ─────────────────
 * Resolves the PronoBet market after the match ends.
 *
 * ⚠️  THIS IS PERMANENT — double check the result before running.
 *
 * Usage:
 *   OUTCOME=1 npx ts-node resolve-market.ts   ← México gana
 *   OUTCOME=2 npx ts-node resolve-market.ts   ← Empate
 *   OUTCOME=3 npx ts-node resolve-market.ts   ← Sudáfrica gana
 *
 * Or set OUTCOME in your .env file.
 */

import {
  publicClient,
  walletClient,
  account,
  PRONOS_BET_ADDRESS,
  PRONOS_BET_ABI,
  OUTCOME_LABELS,
  formatUSDC,
} from "./config";

async function main() {
  console.log("\n=== PRONOS · RESOLVE MARKET ===\n");

  // ── Read outcome from env ──────────────────────────────────────────────────
  const outcomeStr = process.env.OUTCOME;
  if (!outcomeStr) {
    console.error("ERROR: Set OUTCOME env var:");
    console.error("  OUTCOME=1  →  México gana");
    console.error("  OUTCOME=2  →  Empate");
    console.error("  OUTCOME=3  →  Sudáfrica gana");
    process.exit(1);
  }

  const outcome = parseInt(outcomeStr, 10) as 1 | 2 | 3;
  if (![1, 2, 3].includes(outcome)) {
    console.error("ERROR: OUTCOME must be 1, 2, or 3");
    process.exit(1);
  }

  console.log("Admin wallet:", account.address);
  console.log("Contract:    ", PRONOS_BET_ADDRESS);
  console.log("Outcome:     ", outcome, OUTCOME_LABELS[outcome]);

  // ── Read current state ────────────────────────────────────────────────────
  const [bettingOpen, resolved, currentResult, totalPool, mxPool, drPool, saPool] =
    await publicClient.readContract({
      address: PRONOS_BET_ADDRESS,
      abi:     PRONOS_BET_ABI,
      functionName: "getMarketState",
    }) as [boolean, boolean, number, bigint, bigint, bigint, bigint];

  console.log("\nMarket state:");
  console.log("  Betting open:", bettingOpen);
  console.log("  Resolved:    ", resolved);
  console.log("  Total pool:  ", formatUSDC(totalPool));
  console.log("  México pool: ", formatUSDC(mxPool));
  console.log("  Empate pool: ", formatUSDC(drPool));
  console.log("  SA pool:     ", formatUSDC(saPool));

  if (resolved) {
    console.log("\n❌ Market already resolved. Result:", OUTCOME_LABELS[currentResult]);
    process.exit(1);
  }

  // ── Fee + payout preview ──────────────────────────────────────────────────
  const feeRaw      = (totalPool * BigInt(200)) / BigInt(10_000);
  const netPool     = totalPool - feeRaw;
  const winningPool =
    outcome === 1 ? mxPool :
    outcome === 2 ? drPool : saPool;

  console.log("\nPayout preview:");
  console.log("  Protocol fee (2%):  ", formatUSDC(feeRaw));
  console.log("  Net to winners:     ", formatUSDC(netPool));
  console.log("  Winning pool:       ", formatUSDC(winningPool));

  if (winningPool === BigInt(0)) {
    console.log("\n⚠️  WARNING: No bets on this outcome. Winners pool is 0.");
    console.log("   Losers' USDC stays in contract — collectFee() or emergencyWithdraw().");
  }

  // ── Confirm ───────────────────────────────────────────────────────────────
  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│  ⚠️   THIS CANNOT BE UNDONE                 │");
  console.log(`│  Setting result to: ${OUTCOME_LABELS[outcome].padEnd(23)}│`);
  console.log("└─────────────────────────────────────────────┘");
  console.log("\nBroadcasting in 5 seconds... (Ctrl+C to cancel)\n");

  await new Promise((r) => setTimeout(r, 5000));

  // ── Broadcast ─────────────────────────────────────────────────────────────
  console.log("Broadcasting...");

  const hash = await walletClient.writeContract({
    address: PRONOS_BET_ADDRESS,
    abi:     PRONOS_BET_ABI,
    functionName: "resolve",
    args:    [outcome],
  });

  console.log("Tx hash:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log("\n✅ MARKET RESOLVED!");
  console.log("  Result:", OUTCOME_LABELS[outcome]);
  console.log("  Block: ", receipt.blockNumber.toString());
  console.log("  Status:", receipt.status);
  console.log("\n  Users can now claim winnings at pronos.io");
  console.log("  Run: OUTCOME=", outcome, "npx ts-node collect-fee.ts\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
