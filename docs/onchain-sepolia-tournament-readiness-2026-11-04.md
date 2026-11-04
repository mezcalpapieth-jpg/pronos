# Onchain tournament readiness — 2026-11-04

The trading and tournament foundations are largely implemented, but the next onchain season is **not ready to open to users yet**. The remaining work combines specific integration gaps with deployment, season configuration and a complete live rehearsal. Passing the local suite does not establish launch readiness.

This assessment uses the current `onchain-sepolia` source, recorded October release/rehearsal evidence and read-only Vercel checks on November 4. No transaction, deployment, database migration, funding, token issuance or cycle change was performed for this review.

## Pointbreak parity completed locally

Fetched `origin/pointbreak` through `9312b8c12a275636ef18fb956f9232d6670fecb8` and cherry-picked its nine new commits onto `onchain-sepolia`, starting from `e4bb6cfe13a73d34eef52b8b2083798a6f1afbc9`.

| Pointbreak source | Onchain commit | Change |
| --- | --- | --- |
| `5f3a6cdf` | `9cbfaf21` | Complete, president-only Mananera transcripts |
| `6b56d5fe` | `2db63a40` | Portfolio, risk signals and resolution fixes |
| `a81e2724` | `2f054814` | Transcript recovery and evidence review |
| `7bdcbb59` | `8e7abb03` | Pointbreak tournament extension |
| `3c0125ab` | `32834b83` | Postponed games and banner dismissal |
| `1071ee1b` | `4dc006f9` | Expired countdown handling |
| `6c837f55` | `0233c1fb` | Browser risk evidence |
| `cbf79a28` | `8e17faac` | Claims after the Points tournament cutoff |
| `9312b8c1` | `aacafee5` | Phone privacy copy |

Conflict resolutions retain the Sepolia execution-mode guards, six-decimal sell precision, net/gross fee behavior, pending-trade recovery and separation from Points balances. The imported extension banner is restricted to Points execution. The imported November 1 Points date does not configure a future onchain season; those dates come from its reviewed plan.

Two SQL fixtures were adjusted after integration: redemption fixtures declare the execution mode, and sports resolution tests cover the new MLB candidate while continuing to exclude an onchain market from the Points resolver. No runtime behavior was changed by those follow-up fixture adjustments.

The source commit containing the extension also contains generated Pointbreak assets. The source was rebuilt successfully into temporary directories; a future preview release must rebuild both applications from the integrated source rather than treat the imported static files as Sepolia release proof.

The 32 pre-existing modified/untracked files, including the unfinished admin operations/history work, were preserved. Pointbreak itself was not edited. These cherry-picks have not been pushed or deployed by this review.

## What is implemented, and what is actually live

| Area | Source / recorded evidence | Readiness limit |
| --- | --- | --- |
| Trading contracts and adapter | Arbitrum Sepolia V1 binary/V2 multi-outcome AMMs, MXNP, stable router, Points frontend adapter and execution guards | Historical live trading evidence; this review did not recheck current roles, reserves or contracts |
| Wallet authorization | Owner-approved delegation to a stable router covers later pools | A fresh tournament router requires one new owner consent; permission is not copied between seasons |
| Gas sponsorship | Demand-based starter gas, activity-based top-ups, leases and rolling limits | Recheck treasury reserve, signer permissions and current budget before activation |
| Durable trades | Stored requests, wallet nonce coordination, retries and indexed reconciliation | October 20 live retry rehearsal covered one V1 binary pool through the API; V2/browser retry rehearsal remains |
| Season funding and late joining | Reviewed, resumable new-token funding plan, bounded issuance and idempotent late enrollment | Future-season and late-join flags are currently off |
| Capture and scoring | Resumable canonical capture, transfer eligibility, refund/correction accounting, shared Points qualification/conviction/inactivity rules and final closing | Tested locally; no complete live future-season run established |
| Standings and eligibility | Provisional publication, frozen results/archive, explicit eligibility review | Dedicated worker last recorded in standby; active publication not verified |
| Admin operations/history | Read-only queue, indexer and gas health plus trading/top-up history and explorer links | Present as pre-existing uncommitted work; not on the deployed preview |

The latest main preview returned by Vercel on November 4 is READY at source `e4bb6cfe13a73d34eef52b8b2083798a6f1afbc9`:

`https://pronos-3fx17u6b9-mezcalpapieth-jpgs-projects.vercel.app`

Its public `/api/points/onchain?action=config` returned HTTP 200 with `enabled=true`, `chainId=421614`, `symbol=MXNP`, `durableTrades=true`, `tournamentSeason=false` and `lateJoining=false`. This is configuration evidence, not a fresh authenticated readiness, database or chain-health check.

The standings project lookup by its recorded name and ID returned 404 through the current connector; a matching project search returned no results. Its current state could not be verified. This does not prove deletion. The last recorded October 20 release had no policy or cron and was disabled; see [worker configuration](./onchain-sepolia-standings-worker-2026-10-20.md).

## Work required before opening the tournament

### 1. Make the normal admin lifecycle settle onchain

This is the clearest remaining code integration gap. `PointsAdmin.jsx` sends Resolve to `/api/points/admin/resolve-market` through a plain fetch wrapper. That handler selects and updates Points rows without checking execution mode or submitting a chain settlement. The separate `/api/protocol/admin/resolve-market` handler resolves through Turnkey and leaves status confirmation to the indexer. Its input is a **protocol database ID**, so redirecting the existing Points ID without mapping is insufficient.

Cancellation has a different failure mode: the Points cancellation service checks execution mode and rejects onchain rows, but the normal Points admin flow does not provide the corresponding protocol operation. Refund/correction scoring support already exists; it does not make the admin action execute the contract transaction.

Required outcome: resolve/cancel/dispute/correct actions either use an explicitly supported chain-aware path or reject before any database-only change. Define which actions the deployed contracts support, map IDs and parent/leg outcomes correctly, show pending/confirmed/indexed state, and retain manual evidence review. Verify receipts and indexed results before declaring the market settled. Do not rewrite immutable trades to correct accounting.

Source: [Points admin](../frontend/app/points/src/pages/PointsAdmin.jsx), [Points resolution](../frontend/api/points/admin/resolve-market.js), [protocol resolution](../frontend/api/protocol/admin/resolve-market.js), [Points cancellation guard](../frontend/api/_lib/points-cancel-market.js).

### 2. Operate resolutions on the isolated tournament environment

An onchain auto-resolver already exists and shares source readers with Points. However, its scheduled call lives in the main application's indexer multiplex. The dedicated Sepolia preview indexer deliberately bypasses that multiplex and has no signer credentials. Its successful event scans therefore do not prove scheduled market resolution.

The protocol resolver also explicitly defers parallel/leg configurations with `protocol_parallel_not_supported`. New Pointbreak source support must be checked against the protocol candidate selection and outcome mapping; source parity alone does not guarantee lifecycle parity.

Required outcome: an isolated, bounded resolver schedule with appropriate permissions and gas limits, or a documented staffed manual settlement process for every offered market type. Exercise supported binary and V2 resolutions, postponed games and insufficient evidence; unsupported parallel/multiple-winner products must have an explicit supported path or be excluded from the launch market list.

Source: [protocol resolver](../frontend/api/cron/protocol-auto-resolve.js), [main indexer scheduler](../frontend/api/indexer.js), [dedicated preview indexer](../ops/onchain-sepolia-indexer/README.md).

### 3. Review and provision the actual next season

The chosen reset strategy is a fresh token per tournament. Its factories and router are immutably bound to collateral, so the current tooling expects a **new token, V1/V2 factories/share tokens and router**, not just another mint of the existing MXNP. The current 50 million MXNP cannot fund a different token. None of this was deployed during this review.

Review dates/cutoff, initial roster, per-user grant (default 500 MXNP), market seed budget, late-join reserve, maximum issuance and gas budget. At 600 initial users, grants alone would be 300,000 MXNP of the new token; add the reviewed market liquidity and late-join reserve. This is a supply calculation, not an ETH deployment-cost estimate.

Required outcome: reviewed plan/hash, verified fresh contract bindings, resumable confirmed funding, aligned server/browser/indexer configuration and a controlled activation. Verify the prior season's claims/archive still work after switching the active deployment. Returning users must be able to authorize the new router once. Keep the current token and cycle unchanged until that later action is explicitly authorized.

Source: [plan and deployment verification](../frontend/api/_lib/sepolia-tournament.js), [cycle runbook](./onchain-sepolia-tournament-cycles-2026-10-18.md).

### 4. Activate standings and handle markets added during the season

The worker requires a funded plan, complete reviewed market registry/context and a committed policy package. Flipping a flag on the standby package is insufficient. The policy pins the pool registry and market metadata hash. Late participants are supported dynamically, but newly approved markets require an explicit registry/policy update workflow; they cannot silently enter the reviewed standings universe.

Required outcome: confirm the dedicated project and restricted role, release an active reviewed package, observe scheduled publications and recovery after interruption, and exercise the registry update procedure when a market is added. Measure freshness under realistic trading volume. The configured five-minute delay follows completion; it is not proof that a full capture always finishes every five minutes.

Source: [standings automation](../frontend/api/_lib/sepolia-tournament-automation.js), [worker runbook](./onchain-sepolia-standings-worker-2026-10-20.md).

### 5. Release monitoring and rehearse a complete season

Release the existing local operations/history views, then verify them against the isolated preview's real records. Confirm current signer permissions, gas reserve/limits, nonce conflicts, indexer coverage and lag, worker failures and the owner recovery procedure. The read-only views do not automatically page staff or recover transactions; assign an operator and response process.

Run a bounded live rehearsal covering:

- Several normal browser accounts, initial owner consent, zero-ETH starter funding, an inactive account and an active user's later top-up.
- V1 and V2 buys/sells/redemptions with timeout, concurrent same-key retries and browser refresh; one economic transaction per accepted request.
- A late join after trading starts, duplicate join attempts, external collateral/share transfers and eligible portions of later trades.
- Resolution, cancellation/refund/correction, timed trading cutoff and post-cutoff claims.
- Market additions and provisional publication, interrupted/resumed full capture, final cutoff/finality, repeat-safe closing, eligibility review and the prior-season archive/claims.

Reconcile receipts, indexed events, wallet movements and final scores. Historical October V1 retry evidence and local fixtures do not replace this full-season acceptance run. Any live rehearsal spending requires a separate bounded authorization.

### 6. Confirm advertised rules and rewards

Core scoring reuses Points rules. The onchain rules explicitly exclude liquidity rewards, parlays, stock PnL and wallet rewards; confirm the launch UI and advertised rules match that supported scope. If prizes are offered, approve their budget, eligibility/disqualification process, recipient review and payment method. The result/eligibility payload deliberately keeps `readyForRewards=false`; published standings do not authorize a payout. A reviewed manual prize process can be sufficient; an automated onchain prize contract is not inherently required.

Source: [shared season scoring rules](../frontend/api/_lib/sepolia-tournament-final.js), [eligibility review](../frontend/api/_lib/sepolia-tournament-rewards.js).

## Recommended sequence

1. Implement chain-aware Points admin settlement and server-side execution guards, with tests. Define resolver coverage and scheduling in the same pass.
2. Release parity plus the existing read-only admin views to the isolated preview and verify exact-source readiness without transactions.
3. Review the actual season plan, dynamic market policy and supported launch products before provisioning a new stack or funding anything.
4. Separately authorize the necessary Sepolia transactions, activate the dedicated workers and rehearse the full lifecycle with explicit budgets.
5. Open enrollment only after the acceptance run reconciles and the operator/reward process is agreed.

An order book/CLOB, real-money deposits/withdrawals and mainnet treasury/liquidity operations are separate future-product work. They are not prerequisites for this scoped Sepolia AMM tournament.

## Verification performed on November 4

- **576 checks passed, zero failures and zero skips**, across 75 test files. Coverage includes incoming Pointbreak behavior, execution-mode isolation, local PostgreSQL redemption/gas/lease queries, durable trades, router/fee behavior, transfer eligibility, closing, rewards/publication and existing local admin views.
- The capture suite completed its month-length fixture and a fixture with **600 registered users and 101 binary markets**. These are local functional fixtures, not a live throughput or RPC-capacity benchmark.
- Points and MVP production builds passed into temporary output directories. Existing dependency annotation, mixed static/dynamic import and large-chunk warnings remain.
- The local dependency installation was incomplete. It was repaired without tracked manifest changes, and a clean dependency installation then passed. The ignored local lockfile was repaired; no lockfile was added to source control.
- Vercel checks were read-only. No fresh admin readiness session, database inspection, signer permission probe, ETH balance audit or chain rehearsal was performed.
- Cherry-pick commit messages retain the source hashes. The original local files were preserved separately before integration. No push or deployment was performed; Pointbreak, the current token and the current cycle were untouched.
