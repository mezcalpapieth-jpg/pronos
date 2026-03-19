/**
 * check-market.ts
 * ───────────────
 * Reads the current state of the PronoBet contract and prints a summary.
 *
 * Usage:
 *   cd scripts && npm run check
 *   — or —
 *   npx ts-node check-market.ts
 */

import {
  publicClient,
  PRONOS_BET_ADDRESS,
  PRONOS_BET_ABI,
  OUTCOME_LABELS,
  formatUSDC,
} from "./config";

async function main() {
  console.log("\n========================================");
  console.log("  PRONOS · México vs Sudáfrica · WC2026");
  console.log("========================================\n");

  console.log("Contract:", PRONOS_BET_ADDRESS);

  const [
    bettingOpen,
    resolved,
    result,
    totalPool,
    mexicoPool,
    drawPool,
    saPool,
  ] = await publicClient.readContract({
    address: PRONOS_BET_ADDRESS,
    abi:     PRONOS_BET_ABI,
    functionName: "getMarketState",
  }) as [boolean, boolean, number, bigint, bigint, bigint, bigint];

  const [mexicoPct, drawPct, saPct] = await publicClient.readContract({
    address: PRONOS_BET_ADDRESS,
    abi:     PRONOS_BET_ABI,
    functionName: "getOdds",
  }) as [bigint, bigint, bigint];

  console.log("Status:");
  console.log("  Betting open:", bettingOpen ? "✅ YES" : "🔴 CLOSED");
  console.log("  Resolved:    ", resolved    ? "✅ YES" : "⏳ NO");
  if (resolved) {
    console.log("  Result:      ", OUTCOME_LABELS[result]);
  }

  console.log("\nPool breakdown:");
  console.log("  Total:        ", formatUSDC(totalPool));
  console.log(
    `  México (${(Number(mexicoPct) / 100).toFixed(1)}%): `,
    formatUSDC(mexicoPool)
  );
  console.log(
    `  Empate (${(Number(drawPct) / 100).toFixed(1)}%):  `,
    formatUSDC(drawPool)
  );
  console.log(
    `  Sudáfrica (${(Number(saPct) / 100).toFixed(1)}%):`,
    formatUSDC(saPool)
  );

  console.log("\nImplied odds (parimutuel, after 2% fee):");
  const fee = 0.98;
  const mxOdds = Number(mexicoPct) > 0 ? (10_000 / Number(mexicoPct) * fee).toFixed(2) : "∞";
  const drOdds = Number(drawPct)   > 0 ? (10_000 / Number(drawPct)   * fee).toFixed(2) : "∞";
  const saOdds = Number(saPct)     > 0 ? (10_000 / Number(saPct)     * fee).toFixed(2) : "∞";
  console.log(`  🇲🇽 México:    ${mxOdds}x`);
  console.log(`  🤝 Empate:     ${drOdds}x`);
  console.log(`  🇿🇦 Sudáfrica: ${saOdds}x`);

  console.log("\n========================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
