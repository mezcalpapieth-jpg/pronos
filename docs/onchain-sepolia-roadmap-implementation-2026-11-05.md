# Onchain Sepolia: refunds through full-season rehearsal

Date: 2026-11-05. Branch: `onchain-sepolia`.

This records the local implementation before its commit, not a deployment or launch approval. Work was completed in order: cancellation refunds, automatic resolution, season preparation, then standings and full-season rehearsal. No live database, runtime setting, wallet, token, cycle, contract, deployment or Git ref was changed during that implementation pass. No Sepolia ETH was spent. The verification JSON preserves that pre-commit snapshot.

## 1. Cancellation refunds

Canceled V1 and V2 markets now have a review-and-confirm flow in the existing onchain settlement panel.

- The server calculates each payout from the holder's current native contract cost basis and full remaining share balances at one canonical block. Browser-supplied payout amounts are forbidden.
- A review binds the market mapping, factory, pool, holders, burn amounts, payouts and block hash. Changes to balances, cost basis or the canonical anchor require a fresh review.
- Batches contain at most five holders. The panel can page through indexed traders or accept explicitly reviewed wallet addresses. Indexed-trader discovery does not enumerate every ERC1155 transfer recipient.
- Gifts without native cost basis do not receive a payout. A holder with both native cost basis and additional shares receives only that native basis; the full reviewed balance is burned under the existing contract rules.
- Pool shortfalls block execution. The flow does not mint tokens, replenish liquidity, or grant the signer permissions.
- The owner wallet uses the same durable request and wallet nonce coordinator as trades and settlement. A timeout resumes the original key and signed transaction. Successful receipts must contain exactly the reviewed factory payout events.
- Admin status distinguishes a confirmed transaction from indexed payouts. The factory checkpoint and one exact indexed payout per reviewed recipient are required before reporting `indexed`.
- The legacy direct-refund endpoint is blocked in this preview to prevent bypassing the durable path.

Endpoints: `GET/POST /api/points/admin/onchain-refunds`. Preview is a read-only POST; payment requires an explicit `operation: execute`, reviewed hash, reason and durable request ID. Existing buy/sell/redeem formulas and contracts are unchanged.

**Release dependency:** apply the preview-only settlement migration again to extend the durable action constraint with `admin_cancel_refund`. The existing explicit migration command imports the updated migration. It was not applied to a deployed database during this work.

## 2. Automatic resolution

The existing separate resolver worker remains default-off. Its queue now rotates beyond the first 25 ended markets, including when earlier markets need manual review or lack final evidence. Pending signed requests recover before new intents; existing lease, attempt, fee and wallet-budget limits still apply.

The admin panel can inspect the same resolver evidence without enabling scheduling:

```text
GET /api/points/admin/onchain-resolution-preview
```

This admin-only endpoint reads at most five candidates per inspection, with source timeouts and a bounded deadline. It writes no resolver run or trade request and receives no signer. Results distinguish ready, manual and deferred markets. This inspection is a partial queue view; the worker traverses the complete queue over successive invocations.

Automatic source coverage is unchanged: supported sports configurations, price and weather sources use the existing shared resolver. Unsupported or review-heavy markets remain manual. The feature does not claim universal automatic resolution.

**Release dependency:** deploy and verify the exact source, review source coverage and signer readiness, then separately authorize scheduling and gas spending. No worker was deployed, enabled or scheduled here.

## 3. Season preparation before deployment

The new offline budget draft needs no deployed token, database or signer:

```sh
node frontend/api/scripts/onchain-sepolia-tournament.mjs draft \
  --input=/private/tmp/season-input.json \
  --out=/private/tmp/season-draft.json
```

The input includes a future cycle ID/label, UTC start/end dates, expected participants, late-join capacity, allocation, issuance cap, and each market's liquidity, close time and resolution coverage. Optional gas assumptions must explicitly state active users, trading frequency and measured costs. Missing measurements and uncovered manual markets remain blockers.

The draft separately reports opening grants, late-join reserve, market liquidity, estimated gas consumption and wallet float. Idle accounts receive no gas allocation in its model. For illustration only, 600 opening users plus capacity for 100 late joiners at 500 MXNP each, with 1,000 MXNP of market liquidity, require 351,000 MXNP. These are test assumptions, not selected next-season settings or a measured production gas forecast.

Private output files are created exclusively and contain a review hash. A later `plan` command can use `--draft=FILE --draft-hash=HASH` to require that its roster count, dates, allocation, late-join reserve, liquidity and issuance cap match the reviewed draft. The deployed stack and wallets still undergo the existing independent verification before funding.

The draft always reports `readyToLaunch: false`. A fresh token/factories/router, a confirmed wallet snapshot, reviewed standings policy, authorized live rehearsal and prize/operator review are still required for a new season. No dates, token, reserve, deployment or current cycle were selected or changed here.

## 4. Standings and full-season rehearsal

### Discover and review the complete market registry

The read-only discovery command verifies both cycle factories against a confirmed chain anchor, indexed Points mappings, canonical creation receipts and complete factory market counts:

```sh
node frontend/api/scripts/onchain-sepolia-automation.mjs \
  --mode=discover --cycle-id=REVIEWED_CYCLE \
  --reviewed-plan-hash=REVIEWED_PLAN_HASH \
  --output=/private/tmp/registry-proposal.json
```

It requires explicit `ONCHAIN_SNAPSHOT_DATABASE_URL` and `ONCHAIN_SNAPSHOT_RPC_URL` for the isolated preview. It does not load `.env`, sign, deploy or activate. The proposal contains the canonical `registry`, its hash and its anchor; the registry is then reviewed and supplied to the existing capture/context/policy flow. Missing mappings, incomplete indexing, duplicate markets or reorgs fail closed.

### Add markets during a season

The policy command accepts `--previous-policy`, `--previous-context`, `--reviewed-previous-hash` and `--reason` in addition to the reviewed next registry/context. A revision may append verified markets; it cannot remove a prior market, change its creation proof or scoring rules, or alter the scoring window, confirmation depth or original capture start block. The new policy records the previous policy hash and reason.

A changed policy changes the worker generation, so any incomplete capture restarts with the complete registry rather than combining checkpoints from different market sets. The worker still requires separate packaging, deployment and activation. No standings policy or worker runtime was changed here.

### Reproducible serial acceptance run

```sh
node frontend/api/scripts/onchain-sepolia-rehearsal.mjs \
  --output=/private/tmp/new-sepolia-rehearsal-report.json
```

The runner requires the `onchain-sepolia` checkout, scrubs credentials from child environments, executes groups in series, stops on a failure and checks that HEAD and the local Pointbreak ref remain unchanged. It uses local PGlite databases, deterministic RPC fixtures and Foundry's offline EVM. It never forks a live chain or invokes a broadcast, migration, deployment or funding command. The JSON report explicitly distinguishes local acceptance from live launch verification.

The combined season fixture covers two accounts, a late grant, external funds excluded proportionally from eligible trades, V1 buy/sell/cancel/refund, V2 buy/dispute/correction/redeem, interrupted and resumed canonical capture, final scoring, immutable closing, eligibility review and public archive privacy. Separate existing tests cover gas funding, delegation/readiness, nonce recovery and the worker lifecycle.

## Verification and remaining release work

The final serial acceptance results are recorded in [the local verification report](./onchain-sepolia-roadmap-local-verification-2026-11-05.json), including hashes of the uncommitted implementation files. All groups passed with no skipped tests:

| Serial group | Passed |
| --- | ---: |
| Refunds, durable nonces, admin API and UI | 60 |
| Automatic resolution and worker | 15 |
| Season preparation, funding, joining and gas | 57 |
| Standings, registry and worker | 28 |
| Full-season capture, accounting, scoring, eligibility and readiness | 122 |
| Offline Solidity contracts | 137 |
| **Serial acceptance total** | **419** |

Another 13 router trading and lifecycle/indexing regression checks passed, for **432 total checks**. The Points frontend production build also passed, writing only to a temporary output directory. Dependency annotation, chunk size and mixed-import warnings remain; they did not fail the build.

Implementation is complete for this local pass. Preview release still requires applying the explicit preview migration, deploying the exact reviewed source and performing authenticated read-only checks. Live refund and automatic-resolution rehearsals, fresh-season provisioning/funding and standings activation remain separate operations requiring the corresponding authorization and gas. This local fixture run is not evidence that those live operations occurred.

The current token/cycle and Pointbreak remain unchanged. This report's evidence covers the implementation pass before the subsequent commit/push request; it records no deployment or live activation.
