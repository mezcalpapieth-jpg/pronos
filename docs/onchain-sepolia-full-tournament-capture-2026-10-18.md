# Resumable full-tournament shadow capture

Implemented on `onchain-sepolia` after the snapshot adapter release `89450fd981bdfcae56710f9454a7944dc82eb679`. It changes only operator capture and its tests. Exact release verification is recorded separately in the roadmap. Pointbreak, production, the current token/cycle, trading contracts and APIs remain unchanged. No ETH, transaction, migration, mint, funding or activation is needed to implement or test this tool.

## Capture and verification

`frontend/api/scripts/onchain-sepolia-capture.mjs` wraps the existing read-only snapshot pipeline with a private, resumable response cache. It still requires the complete, independently reviewed funded plan and cycle-specific factory registry, exact confirmed mint receipts, historical deployment bindings, canonical receipt/log evidence and indexer coverage. It produces the same canonical shadow artifact as the bounded adapter for equivalent inputs.

The manifest binds the plan/registry hashes, cycle, first/cutoff blocks, exact funding transaction references, fixed capture limits and cutoff block hash. Each invocation independently checks the live chain and confirmed cutoff before using saved responses and checks them again before returning, including when paused or a later read fails. A changed anchor, review, cutoff or funding reference stops reuse. Saved data has hashed request/response metadata; corruption stops capture. These hashes detect accidental corruption, not malicious local edits.

Successful RPC responses and decisions to split oversized log queries are saved before advancing. A per-run quota pauses without a scoring artifact; rerunning the same command reuses those reads. Provider errors leave successful checkpoints available for retry. Known log-size/range limits and responses with at least 1,000 rows split into smaller block ranges, then smaller address groups if needed. An unsplittable single-pool/single-block limit fails. Authentication, rate-limit and network errors are not treated as evidence to split a query.

Logs use contiguous fixed 2,000-block pages shared by groups of up to 25 pools from the same factory. Boundary pages can include extra blocks, but only each pool's requested creation-to-cutoff interval enters the canonical builder. Capped parent responses are discarded; only complete child results feed scoring. The RPC must provide complete log responses below its advertised limits: silent truncation below the threshold cannot be detected. Choose a provider whose documented limits are compatible with this threshold, or change and review the fixed capture configuration before use.

The live cutoff hash commits to its ancestors. Under that unchanged anchor, saved per-block reads are reused, including the builder's final block checks; they are not independently re-fetched from RPC on every resume. This is a trusted-RPC/private-operator-cache workflow, not a consensus or receipt-trie proof. The canonical builder still verifies receipt/log membership, timestamps, historical marks and all existing accounting constraints. Unsupported cancellations, disputes, corrections or refunds still stop the capture.

| Limit | Bounded snapshot command | Resumable capture command |
| --- | --- | --- |
| Block span, including pool creation | 2,000,000 | 40,000,000 |
| Reviewed markets | 100 | 1,000 |
| Returned scoring/lifecycle logs | 50,000 | 500,000 |
| Logical builder read budget | 10,000 | 25,000,000 |
| New data reads per invocation | No resumable quota | Default 500; configurable 1–5,000 |

Successful or paused runs also perform five unmetered chain/cutoff control checks. Requests rejected by a provider consume the data-read quota too. A combined page is limited to 50,000 logs and a receipt to 50,000 logs; these bounds fail rather than truncate. Capturing a full month is supported within the limits, but the maximum block/market/log combination is a hard ceiling, not a measured performance guarantee. Repeated runs traverse saved data again, so local disk reads and scoring cost grow with history even when no new RPC reads are needed.

## Operator command for a future funded cycle

Use the private request and two reviewed hashes described in the [canonical snapshot guide](./onchain-sepolia-canonical-snapshots-2026-10-18.md). The command loads no `.env` file. Supply `ONCHAIN_SNAPSHOT_DATABASE_URL` explicitly for the pinned isolated Preview endpoint, preferably with a SELECT-only role, and an HTTPS `ONCHAIN_SNAPSHOT_RPC_URL`. Database queries read only the cycle plan/status, confirmed batch references and factory checkpoints. No stored signed transaction or signing credential is read.

```sh
node frontend/api/scripts/onchain-sepolia-capture.mjs \
  --input /private/path/reviewed-request.json \
  --output /private/path/new-canonical-snapshot.json \
  --checkpoint /private/path/cycle-cutoff-capture \
  --reviewed-plan-hash <reviewed-plan-sha256> \
  --reviewed-registry-hash <reviewed-registry-sha256> \
  --max-requests 500
```

Keep request, checkpoint and output outside Git in a private location. The checkpoint root and shards require `0700`; files use `0600`. Existing directories/files with group/world permissions and direct symlinks are refused. Use an operator-controlled parent directory as well. The output and cache contain usernames, wallet addresses and plan suborganization mappings. Standard output contains only progress, hashes, counts and the public cutoff reference.

- `status: paused` exits successfully and creates no output artifact. Repeat the same command; the quota may be changed between runs.
- `status: complete` writes the final artifact exclusively with `0600`. An existing output file is never overwritten. The artifact stays `mode: shadow` and `readyForRewards: false`.
- Other errors exit unsuccessfully. Correct a transient RPC error and retry the same checkpoint. A genuinely changed registry, funding set or cutoff needs a newly reviewed request and a new checkpoint directory.
- An exclusive `capture.lock` prevents two processes using one checkpoint. Normal completion, pauses and failures release it. After a hard kill, inspect its PID and confirm that process is no longer running before removing only that abandoned lock. Never remove a live process's lock. Do not automatically steal a lock based on elapsed time. Private `.tmp-*` files left by a crash are ignored; completed cache files are published only after their temporary file has been flushed.

Current future-cycle tables are still unapplied and no future token was deployed/funded. This command cannot produce a live future-cycle artifact until that separate workflow is explicitly activated. Do not point it at the current mixed technical factories to simulate a funded tournament.

## Validation and remaining roadmap

All **55 focused tests passed without skips**, including the local PostgreSQL funding recovery suite and 11 capture test groups. The capture groups cover deterministic equivalence with the existing adapter, one-read quotas including persisted split decisions, private files, interruption/resume, changed input and cache corruption, reorgs and chain changes, transient RPC recovery, capped/error log splitting, unsplittable limits, locks/hard bounds and the actual injected SELECT-only operator pipeline with CLI help/refusal checks.

Scale fixtures separately exercise a month-length 10,300,100-block cutoff across both pool types, and 600 registered users with 102 markets (101 binary plus one multi-outcome). These use simulated canonical RPC data with real ABI encoding. They are not a live tournament or a 500,000-event stress test.

Next: late-registration eligibility and issuance limits, cancellation/refund/correction accounting and transfer reconciliation; then post-end settlement, archived-cycle routing/presentation and independently reviewed reward eligibility. Database persistence for operational registrations/snapshots remains separate. Capture does not publish a leaderboard or authorize payouts.
