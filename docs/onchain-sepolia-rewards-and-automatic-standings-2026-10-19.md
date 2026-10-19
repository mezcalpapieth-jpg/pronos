# Reward eligibility and automatic standings — 2026-10-19

Implemented locally on `onchain-sepolia`. No deployment, live migration, runtime activation, payout, signing, token change, cycle switch or ETH expenditure is part of this implementation. Pointbreak is untouched. The existing current-season configuration remains unchanged.

## Eligibility review

Eligibility consumes an immutable **final** season result, reusing its Points qualification and frozen ranking. It does not recalculate scores, import the Points prize schedule, set prize amounts or execute payments.

The operator exports isolated-preview evidence and reviews **every participant**. Evidence binds the original opening/late registration to the current account wallet/suborganization, account-block state and Points account-review status. It excludes email, phone, IP, credentials and risk narratives. Missing or mismatched identities and blocked or non-clear account reviews require a hold or exclusion; they cannot be approved by this workflow. Risk signals alone do not silently exclude a player.

Explicit decisions are `approve`, `hold` or `exclude`; holds/exclusions require a private reason. The effective status is `not_qualified` when the frozen Points qualification is false, otherwise `eligible`, `on_hold` or `ineligible`. Eligible placement filters the frozen ordering without changing the original ranks or scores. No eligible placement guarantees a prize.

The report binds reviewed result/evidence/decision hashes, reviewer, review time and the previous eligibility hash. Preview apply revalidates the stored closure, funded plan and fresh account/enrollment evidence. The operations lease serializes review publication. Reports are append-only; an exact retry is safe. Changed decisions require an explicit `supersedes` hash, and concurrent/stale reviews or expired leases are refused. Earlier reports remain available for audit.

Offline report preparation:

```sh
node frontend/api/scripts/onchain-sepolia-rewards.mjs \
  --input /private/path/cycle-and-frozen-result.json \
  --evidence /private/path/evidence.json \
  --review /private/path/decisions.json \
  --reviewed-result-hash RESULT_HASH \
  --reviewed-evidence-hash EVIDENCE_HASH \
  --reviewed-review-hash DECISIONS_HASH \
  --output /private/path/new-eligibility-report.json
```

The input is `{ "cycle": { "plan": ..., "plan_hash": ..., "status": "funded" }, "result": ... }`. The review format is:

```json
{
  "version": 1,
  "cycleId": "reviewed-future-cycle",
  "resultHash": "REVIEWED_RESULT_HASH",
  "evidenceHash": "REVIEWED_EVIDENCE_HASH",
  "reviewedBy": "admin-username",
  "reviewedAt": "2026-12-02T12:00:00.000Z",
  "supersedes": null,
  "decisions": [
    { "username": "example", "decision": "hold", "reason": "Identity review pending" }
  ]
}
```

Include one decision for every frozen participant. The example is a format illustration, not an actual cycle or decision. Hashes use the existing canonical `planHash` function. Files are created exclusively with mode 0600, so exports cannot overwrite reviewed artifacts.

Read-only evidence export uses `--export-evidence --cycle-id ID --expected-host ISOLATED_DIRECT_HOST --output NEW_PATH`, the explicit preview environment and the `onchain-sepolia` checkout. `--apply --expected-host ISOLATED_DIRECT_HOST` is a separate opt-in for publishing an already reviewed eligibility report. Both are destination-gated; neither sends transactions. No such live command was run here.

With the separate future preview flag `ONCHAIN_TOURNAMENT_REWARDS_ENABLED=true`, final/archived results include only the session participant's status, eligible placement, review time and report hash. Guests and other accounts cannot read someone else's eligibility. Reasons, reviewer and identity evidence remain private. The bilingual UI distinguishes eligibility from payment approval. `readyForRewards` stays **false** everywhere, including the frozen result. A later payout implementation must recheck current identity/risk state, approved prize budget and payment authorization; a published eligibility review is historical evidence, not a permanent payment permission.

## Scheduled provisional publication

`ops/onchain-sepolia-standings` is a **separate, default-off worker project**. Vercel cron invokes production deployment URLs, so this follows the existing dedicated-preview-worker pattern; it does not change the main application's production project or cron configuration. See [Vercel's cron documentation](https://vercel.com/docs/cron-jobs#how-cron-jobs-work).

A reviewed policy binds the future funded plan, complete canonical registry, market-context hash, starting block, confirmation depth (default 12, minimum 2), and five-minute publication interval. Build it offline from the reviewed registry and exported Points context:

```sh
node frontend/api/scripts/onchain-sepolia-automation.mjs \
  --registry /private/path/reviewed-registry.json \
  --context /private/path/reviewed-points-context.json \
  --reviewed-registry-hash REGISTRY_HASH \
  --reviewed-context-hash CONTEXT_HASH \
  --from-block FIRST_SEASON_BLOCK \
  --output /private/path/new-policy.json
```

Creating a policy does not activate it. The worker accepts no query-supplied policy, range or cycle override. It authenticates a dedicated bearer secret, verifies its project and committed `onchain-sepolia` source, rejects the main application project, pins the isolated Neon endpoint and `sepolia_standings` role, verifies HTTPS and actual RPC chain 421614, and refuses signing credentials.

Each scheduled minute resumes the outstanding job or starts a due capture. Database checkpoints preserve the same immutable manifest, hashed RPC responses and canonical anchor checks as the file-backed operator capture. A 330-second fenced lease prevents overlapping workers; the function allows 300 seconds, capture targets a 240-second deadline, individual RPC requests time out after 15 seconds, and a run performs at most 200 new capture reads. Paused, failed or incomplete work never publishes standings. Retries reuse valid reads, and transient failures preserve progress. An observed reorg resets the generation.

Opening funding and the complete non-reverted late-join ledger determine the generation. Pending joins wait; a changed ledger discards the old generation and captures again. Account ages for confirmed late participants are read automatically from the isolated database. The existing publication store rechecks enrollment under its own shared enrollment/closing lease, verifies canonical confirmation and rejects stale/conflicting blocks or final closures. Updated wallet balances are never used as a scoring shortcut.

Only a completed canonical capture with the reviewed market metadata is scored and appended to standings. Its publication records the policy hash and worker source SHA. Frozen results retain precedence in the API. The worker stops provisional publication at season end and does **not** automatically close the season, decide eligibility or pay rewards.

The five-minute interval is a target **after successful completion**, not a freshness guarantee. RPC/indexer lag, enrollment churn and large captures can delay publication. The existing UI labels captures older than 15 minutes as delayed. New factory markets or changed exposure/touch mappings require an updated reviewed policy; missing or unreviewed markets fail closed rather than disappear from rankings. This preserves the existing canonical-registry review boundary.

Each active checkpoint set is limited to 64 MiB of serialized database data. Checkpoint loading is bounded before allocation. Fenced cleanup removes abandoned generations and completed caches; published standings and their audit columns remain immutable. Larger captures fail with a safe job error and can use the existing private file-backed capture workflow. This is a resource ceiling, not a proven production throughput claim.

## Separate future activation

The additive future-tournament schema now includes eligibility reports, scheduler jobs/checkpoints and publication audit columns. It is still an explicit migration (`onchain-sepolia-tournament.mjs schema` prints it without applying); no application cold start runs it. Existing schema-owner migration permissions and app permissions remain separate from the worker's role.

After reviewing/committing source, `ops/onchain-sepolia-standings/prepare.mjs --policy PRIVATE_PATH --reviewed-policy-hash HASH --output NEW_PRIVATE_DIRECTORY` creates a deployable package from committed source only. It checks branch and relevant checkout cleanliness, embeds the source SHA and policy, and copies no environment files. It performs no deployment. Run dependency installation/build inside that package, then separately review the dedicated project and deployment. Do not link or deploy it to the main app or the existing indexer project.

For a separately authorized activation, provision a non-owner `sepolia_standings` login on the isolated preview branch, apply the future schema as owner and review `ops/onchain-sepolia-standings/schema.sql`. It grants read-only plan/market/context/coverage inputs, restricted enrollment/funding columns, append-only standings, job/lease writes and disposable-cache cleanup. It grants no Points balances/trades access, signed transaction bytes, wallet identities from `points_users`, eligibility decisions, closure writes, cycle updates or signing authority. The local PostgreSQL tests exercise the actual role grants.

The dedicated worker environment is:

- `DATABASE_URL`: isolated preview endpoint, role `sepolia_standings`.
- `ARB_RPC_URL`: HTTPS Arbitrum Sepolia RPC.
- `CHAIN_ID=421614`.
- `PREVIEW_STANDINGS_PROJECT_ID`: the dedicated project's ID; must match `VERCEL_PROJECT_ID`.
- `CRON_SECRET`: a new dedicated secret of at least 32 characters.
- `STANDINGS_POLICY_HASH`: the reviewed policy's hash.
- `ONCHAIN_STANDINGS_ENABLED=false` until separate activation review.

No credentials belong in source or command output. Future activation also requires an actually funded future plan, complete indexer coverage, reviewed registry/context and the application's separate future-season flags. Neither worker creation nor eligibility review changes the current token or active cycle.

Observe `sepolia_standings_jobs.status`, `updated_at`, `expires_at` and `next_run_at`, along with the latest standings capture timestamp and its `policy_hash`/`source_sha`. Job failures expose only a generic state; raw RPC/database errors are not returned or persisted. Disable the dedicated flag/project to stop scheduling; previously published/frozen results remain intact. A paused invocation is expected progress, not a partial leaderboard.

## Local verification

Tests cover canonical capture resumption, publication equality, enrollment changes, pending joins, canonical reorgs, metadata/indexer failures, competing and expired leases, strict role grants, frozen eligibility/qualification, complete decisions, held/blocked/mismatched accounts, stale evidence, superseded reviews, immutable reports, private APIs, bilingual rendering and offline exclusive exports. Both frontend builds target private temporary directories. The final test counts and large-capture results are recorded in the roadmap after verification.

Live deployment/readiness and an actual future-season rehearsal remain separate work. No current-season or production behavior was activated by these local checks.
