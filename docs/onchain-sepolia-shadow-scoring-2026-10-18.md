# Tournament registration and shadow scoring

This is an offline foundation for a future tournament. It is disconnected from the live Points/protocol leaderboard, funding, rewards and current cycle. The scoring command creates no tables, changes no configuration, and sends no blockchain transactions. The [late-joining/lifecycle follow-up](./onchain-sepolia-late-joining-2026-10-18.md) is included in the requested 2026-10-19 Preview code release; future-cycle activation remains disabled.

## Implemented

- Opening registrations derive from the reviewed immutable plan only when its funding record is `funded`. Only user recipients qualify; the operations allocation and skipped/missing wallets do not. The follow-up adds canonical late grants under the plan's separately budgeted reserve without changing its opening roster.
- The opening balance is the plan's equal grant. Wallet balances, ERC20/1155 transfers, faucet mints and arbitrary wallets never add scoring cash.
- Scores use integer six-decimal units: opening grant minus gross buys plus net sells and redemptions, plus the marked value of remaining event-derived holdings. PnL is equity minus the opening grant. Fees are not subtracted twice; redeeming a winning claim converts its marked value to cash without adding a second win.
- Markets must match the cycle's chain, collateral and factories. Marks must match the pinned snapshot block/hash. Event replay deduplicates by chain/transaction/log; inconsistent hashes, conflicting identities or log positions, unbacked sales/redemptions and purchases beyond scoring cash stop the calculation.
- Binary and multi-outcome active/resolved markets are supported. The follow-up also values canceled positions at remaining gross cost basis, credits actual verified refunds once and applies corrected final winners. Open disputes and invalid lifecycle sequences still refuse scoring.

## Operator command

```sh
node frontend/api/scripts/onchain-sepolia-score.mjs \
  --input /private/path/canonical-cycle-snapshot.json \
  --reviewed-plan-hash <reviewed-64-character-sha256>
```

The private input contains `cycle: {plan, plan_hash, status}`, `fromBlock`, `asOf: {blockNumber, blockHash, timestamp}`, `markets` and `events`. The command only reads that file and prints the report. It loads no environment and has no database, signing or broadcast capability. Treat the report as private: it includes usernames and wallet addresses.

Each market supplies `chainId`, `pool`, `factory`, `collateral`, integer-string `marketId`, `outcomeCount`, `registeredBlock`, `status`, `markBlock`, `markBlockHash`, and either six-decimal integer-string `pricesUnits` or a resolved `winner` index. Each trade/redemption supplies `chainId`, `pool`, `wallet`, `side`, `blockNumber`, `blockHash`, `logIndex`, `txHash`, canonical block `timestamp`, `outcomeIndex`, `sharesUnits` and `collateralUnits`. V1 redemption outcome can be null because its resolved winner determines the side.

## Required before activation

The calculator trusts its operator-supplied canonical snapshot. It does **not** prove RPC log authenticity, complete indexer coverage, market membership in the on-chain factory registry, historical prices, funding finality or timestamp-to-block correspondence. Its output explicitly remains `mode: shadow` and `readyForRewards: false`; it must not authorize payouts or replace the live leaderboard.

Use the read-only canonical adapter below to verify those facts and produce a reproducible snapshot hash. Existing `trades`/`redemptions` tables do not contain every required field: their insertion timestamps are not canonical block timestamps. The local lifecycle adapter derives refund burn attribution from exact RPC receipts. Do not guess those fields or treat arbitrary share transfers as purchases. A reorg requires rebuilding the snapshot. [External-transfer reconciliation](./onchain-sepolia-transfer-reconciliation-2026-10-19.md) is now implemented locally for shadow captures; post-end settlement, rewards, archived-cycle UI and live cancellation/correction rehearsals remain separate roadmap work.

Validation: 13 focused tests cover grant provenance, foreign transfers/wallets/markets, fee handling, partial redemptions, binary and multi-outcome marks, replay/conflicting logs, capital/holding limits, cutoff/hash checks, exact large integer math, and the actual offline CLI.

## Canonical adapter follow-up

The [read-only snapshot adapter](./onchain-sepolia-canonical-snapshots-2026-10-18.md) supplies bounded RPC-backed input, reviewed factory registrations, exact funding proofs and immutable private artifacts. Full-scale resumable capture and late-join/refund/correction support are released on `onchain-sepolia`. External-transfer reconciliation extends the Preview operator code with actual/eligible ledgers and historical balance checks. The raw offline calculator still accepts operator-supplied input and is not a payout authorization tool; legacy inputs explicitly report transfers as uncaptured. Live activation and reward requirements remain open.
