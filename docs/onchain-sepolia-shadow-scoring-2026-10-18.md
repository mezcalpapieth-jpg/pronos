# Tournament registration and shadow scoring

This is an offline foundation for a future tournament. It is disconnected from the live Points/protocol leaderboard, funding, rewards and current cycle. It creates no tables, changes no configuration, and sends no blockchain transactions.

## Implemented

- Registrations derive from the reviewed immutable plan only when its funding record is `funded`. Only user recipients qualify; the operations allocation and skipped/missing wallets do not.
- The opening balance is the plan's equal grant. Wallet balances, ERC20/1155 transfers, faucet mints and arbitrary wallets never add scoring cash.
- Scores use integer six-decimal units: opening grant minus gross buys plus net sells and redemptions, plus the marked value of remaining event-derived holdings. PnL is equity minus the opening grant. Fees are not subtracted twice; redeeming a winning claim converts its marked value to cash without adding a second win.
- Markets must match the cycle's chain, collateral and factories. Marks must match the pinned snapshot block/hash. Event replay deduplicates by chain/transaction/log; inconsistent hashes, conflicting identities or log positions, unbacked sales/redemptions and purchases beyond scoring cash stop the calculation.
- Binary and multi-outcome active/resolved markets are supported. Cancellations and disputes refuse scoring until their refund/burn and correction accounting is implemented.

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

Next, build the read-only indexer adapter that verifies those facts and persists cycle/market registration and a reproducible snapshot hash. Existing `trades`/`redemptions` tables do not contain every required field: their insertion timestamps are not canonical block timestamps, and cancellation burn attribution remains incomplete. Do not guess those fields or treat arbitrary share transfers as purchases. A reorg requires rebuilding the snapshot. Late signups need separately reviewed registration/funding limits. Rewards, archived-cycle UI and cancellation/correction rehearsals remain separate roadmap work.

Validation: 13 focused tests cover grant provenance, foreign transfers/wallets/markets, fee handling, partial redemptions, binary and multi-outcome marks, replay/conflicting logs, capital/holding limits, cutoff/hash checks, exact large integer math, and the actual offline CLI.

## Canonical adapter follow-up

The [read-only snapshot adapter](./onchain-sepolia-canonical-snapshots-2026-10-18.md) now supplies bounded RPC-backed input, reviewed factory registrations, exact funding proofs and immutable private artifacts. The raw offline calculator still accepts operator-supplied input and is not a payout authorization tool. Full-scale resumable capture, unsupported lifecycle accounting and activation requirements in the adapter runbook remain open. This follow-up is local and is not included in the parity Preview at `129b65d`.
