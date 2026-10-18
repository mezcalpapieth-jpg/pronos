# Read-only tournament snapshot adapter

Committed and pushed as `89450fd981bdfcae56710f9454a7944dc82eb679`; its exact-source Preview `dpl_GWTMWSE6EWQ5YTsmGzxYo1nUc7HZ` is READY. This is an operator-only shadow tool for a possible future tournament; the current token, cycle, trading APIs, indexer, leaderboard and rewards are unchanged. See the [release evidence](./onchain-sepolia-snapshot-preview-verification-2026-10-18.json). The subsequent [resumable full-tournament capture](./onchain-sepolia-full-tournament-capture-2026-10-18.md) is local continuation work and is not included in that release.

## Verification and output

`frontend/api/_lib/sepolia-tournament-snapshot.js` accepts the reviewed funded plan, a separately reviewed market registry, confirmed mint transaction hashes, a first-cycle block and a pricing cutoff. It uses only read methods on the supplied RPC provider and a read-only indexer-coverage callback.

- Requires Arbitrum Sepolia, at least two confirmations for the cutoff, and a first-cycle block whose predecessor is before the exact plan start. Event timestamps come from canonical RPC blocks, never database insertion timestamps.
- Verifies every planned mint batch against its successful canonical receipt, exact owner/chain/token/value/calldata and exact ordered allocation logs. All funding must predate the cycle start and be final by the cutoff. Token decimals and total supply must match the plan.
- Checks the pinned router runtime hash and bindings, factory collateral/share/router bindings, share ownership, factory market-array membership, pool immutables and creation receipts. Multi-outcome counts must agree across creation, factory and pool. Both indexer checkpoints must cover the cutoff.
- The reviewed registry must include **every** market in both cycle-specific factories at the cutoff. Missing/new markets, duplicated pools, foreign factories or an unreviewed registry change stop the run. These future factories must be dedicated to tournament markets; this command does not silently exclude technical pools.
- Scans relevant pool logs from creation through the cutoff in contiguous batches, verifies successful receipts and block hashes, reads prices/state at the same historical block, and rechecks all referenced block hashes before returning. Gross buys, net sells and winning redemptions feed the existing integer-unit shadow calculator. Replayed identical RPC logs deduplicate.
- Current or historical cancellations, disputes (including cleared disputes), corrections and refund events stop the run. Resolved state must agree with exactly one resolution event. Unsupported lifecycle accounting cannot be hidden by restoring an active state.

The private artifact includes the normalized registry and its hash, funding receipt references, canonical scoring input, shadow scores and a deterministic SHA-256 `snapshotHash`. It always says `mode: shadow` and `readyForRewards: false`. Scores are not written to an API, database leaderboard or payout queue.

The RPC remains a trusted source: this is not an independent consensus/receipt-trie proof. Contiguous RPC log queries supply history; an indexer checkpoint alone does not prove historical completeness. RPC errors, resource limits and observed inconsistencies fail the entire run without producing a partial report.

## Operator command for a future funded cycle

The command loads no `.env` file and requires explicit `ONCHAIN_SNAPSHOT_DATABASE_URL` and `ONCHAIN_SNAPSHOT_RPC_URL`. Use credentials supplied securely by the operator, preferably a SELECT-only role. The database host must be the existing isolated `ep-delicate-glitter-amp7yrkv` Preview endpoint (direct or pooled); RPC must be HTTPS. Production database hosts are refused. No environment settings are changed by the command.

Create a private request file containing:

```json
{
  "cycleId": "future-reviewed-cycle",
  "fromBlock": 100,
  "asOfBlock": 200,
  "registry": {
    "version": 1,
    "cycleId": "future-reviewed-cycle",
    "planHash": "<reviewed plan SHA-256>",
    "markets": [
      {
        "factory": "<cycle factory address>",
        "pool": "<registered pool address>",
        "marketId": "0",
        "creationTxHash": "<creation transaction hash>",
        "creationLogIndex": 0
      }
    ]
  }
}
```

The example block numbers are placeholders. Review the exact market list and compute its canonical digest using `planHash(tournamentMarketRegistry(request.registry))` from the tournament/snapshot modules. This normalizes addresses and sorts factory/market IDs. Review the plan independently too; computing a hash does not substitute for reviewing its contents.

```sh
node frontend/api/scripts/onchain-sepolia-snapshot.mjs \
  --input /private/path/reviewed-request.json \
  --output /private/path/new-canonical-snapshot.json \
  --reviewed-plan-hash <reviewed-plan-sha256> \
  --reviewed-registry-hash <reviewed-registry-sha256>
```

The command SELECTs the cycle plan/status, confirmed batch IDs/transaction hashes and factory checkpoints. It never reads stored signed transactions or signing credentials. The artifact is created with mode `0600`, using exclusive creation so an existing report is not overwritten. Standard output contains only hashes/counts. The file contains usernames, wallet addresses and plan suborganization mappings: keep it private and out of Git. The nested `snapshot` is compatible with the existing offline scoring command.

## Validation and remaining work

**44 focused tests passed with zero skips**, including the local PostgreSQL funding suite and 13 new snapshot test groups. The new tests cover deterministic V1/V2 marks and redemptions, exact funding provenance, incomplete registry/indexer coverage, boundary/finality checks, historical pinned calls, forged/removed/reverted logs, reorgs, lifecycle refusals, replay/resource limits and the complete injected operator pipeline. The pipeline tests both Neon response shapes, SELECT-only queries, private file permissions and refusal to overwrite an artifact; CLI help/refusal are exercised in child processes.

No future token has been deployed/funded, and the tournament tables remain unapplied. There is therefore no live funded-cycle snapshot or fresh trading rehearsal claimed here. Current live verification covers the snapshot Preview and its existing contracts/configuration separately.

Capture is intentionally bounded to 100 markets, a 2,000,000-block interval (including creation), 50,000 returned scoring/lifecycle logs and 10,000 RPC requests. A longer or busier tournament needs reviewed resumable capture/checkpoints before activation; this version refuses rather than truncates. Cutoffs after the cycle end, late registrations, cancellations/refunds/corrections, external-transfer reconciliation, archived-cycle routing/UI and reward eligibility/payouts remain separate work. Persisting operational registration/snapshot records in a database is also deferred; this implementation persists immutable private artifacts only. No schema migration is required for the adapter itself, beyond the existing future-cycle plan/funding schema when that workflow is eventually activated.
