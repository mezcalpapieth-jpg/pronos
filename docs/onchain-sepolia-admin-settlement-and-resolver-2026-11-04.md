# Onchain admin settlement and resolver scheduling — 2026-11-04

Released from `onchain-sepolia` commit `63f613a6a0b9e07af98700bac122e37d0ba02070` to the isolated [preview](https://pronos-jtoe5db79-mezcalpapieth-jpgs-projects.vercel.app). The preview migration is applied and the dedicated read-only indexer is updated. **Admin settlement and resolver scheduling remain disabled.** No chain transaction, funding, ETH expenditure, token issuance or cycle change was performed; Pointbreak and the main production deployment remain unchanged. See the [release verification](./onchain-sepolia-settlement-preview-verification-2026-11-04.json).

Authenticated readiness returned `ok=true`, no warnings and zero launch blockers; operations returned `ok`. The existing router and gas funder passed their read-only probes. Settlement GET/POST returned `403 onchain_settlement_disabled`, legacy signing returned `409 use_onchain_admin_settlement`, and the unauthenticated resolver trigger returned `401`. History pagination/privacy checks and the served admin bundle passed. Real indexer cron runs carry the released source SHA. The resolver has no trigger secret or deployed active worker; its private standby package has an empty cron list.

Activation still needs separate authorization and preparation. The operations wallet holds `0.000403708278758 ETH`, below the new `0.001 ETH` remaining-reserve requirement plus planned gas. Owner, resolver and creator currently share that wallet: verify settlement selectors and serialize legacy creation or separate its wallet before activation. No top-up or live settlement rehearsal was attempted. CRE retains one existing review for its absent webhook secret; this release does not activate CRE or future-season behavior.

## Admin settlement

The new **Admin → Launch → Liquidación onchain** panel uses `/api/points/admin/onchain-settlement`, authenticated through the existing Points admin session. The server requires the isolated Arbitrum Sepolia preview, pinned preview database, durable trades, configured factories/collateral and a new default-off `ONCHAIN_ADMIN_SETTLEMENT_ENABLED=true` flag.

The panel supports these existing contract operations:

| Action | Required indexed state | Signer | Contract constraint |
| --- | --- | --- | --- |
| Resolve | active | explicit resolver | Valid outcome; factory resolver; successful simulation |
| Cancel | active or disputed | explicit owner | No payouts started; refunds require separate processing |
| Open dispute | resolved | explicit owner | Freezes further claims while disputed |
| Clear dispute | disputed | explicit owner | Retains the existing outcome |
| Correct resolution | disputed | explicit owner | No payouts started; valid replacement outcome |

Every action maps a **Points ID → protocol database ID → factory/contract ID/pool**. Chain, addresses, variant and exact ID must agree; numeric/string contract ID zero is valid. The configured V1 and V2 factories must be distinct. Parallel groups and child legs are refused for review. V1 application outcomes 0/1 become contract enum 1/2; V2 remains zero-based. The active collateral binding is checked against the factory before a new signature.

Old Points database-only resolution/correction/candidate handlers reject onchain rows before changing their balances or market state. On this preview, legacy protocol lifecycle/resolve/candidate confirmation endpoints reject signing and direct callers to the durable settlement endpoint. The old multiplexed auto-resolver also defers signing here. Other environments retain their existing routes.

The shared durable request engine saves intents, nonces and signed bytes before broadcast, and coordinates with other durable requests for the same wallet. Same-key retries recover the original transaction; changed inputs conflict. Confirmed receipt recovery bypasses mutable state/permission simulations and cannot create a replacement signature. Successful receipts must contain the matching factory lifecycle event, contract ID and requested outcome. Missing event evidence holds the request for reconciliation.

The browser saves the key before sending, keeps it across lost responses/refreshes, isolates it by admin identity, and offers continuation with that exact key. A confirmed transaction is displayed separately from indexing. The authoritative market state comes from the protocol indexer; settlement never optimistically rewrites Points or protocol status. Admin transaction history remains scoped to user trades/top-ups; settlement requests have their own panel.

## Bounds and signer preparation

New signatures use explicit `ONCHAIN_RESOLVER_ADDRESS`/`ONCHAIN_RESOLVER_SUBORG_ID` or `ONCHAIN_OWNER_ADDRESS`/`ONCHAIN_OWNER_SUBORG_ID`. There is no deployer fallback. The gas funder and incoming reserve address are rejected as settlement signers. No signer roles or Turnkey policies are created by this feature.

Fixed limits in source:

- Resolution/dispute/correction: 250,000 gas; cancellation: 350,000 gas.
- Maximum fee: 0.2 gwei, with Arbitrum Sepolia's RPC gas quote and existing fee headroom.
- Minimum remaining wallet reserve: 0.001 ETH beyond the planned maximum transaction cost.
- Conservative daily reservation: 0.005 ETH **per signer wallet**, counting non-rejected admin requests updated in the last 24 hours and all unresolved reservations. This is a reservation ceiling, not measured gas expenditure.

The resolver and owner may be the same operations wallet: its durable requests share a nonce lease and daily budget. Legacy market creation is outside this new coordinator. Before activation, confirm a distinct creator wallet or serialize creation against settlement; do not run concurrent legacy signing on the settlement wallet. Existing onchain simulation still enforces owner/resolver and payout restrictions.

## Dedicated resolver schedule

The separate worker in `ops/onchain-sepolia-resolver` has **no database, RPC or signing credentials**. A future active package calls one immutable preview deployment's `/api/cron/sepolia-resolve` every five minutes. Its default source configuration has no cron. A standby package cannot activate by flipping a flag: an active committed-source package is required as well.

The main preview endpoint additionally requires `ONCHAIN_RESOLVER_SCHEDULE_ENABLED=true`, a dedicated `ONCHAIN_RESOLVER_CRON_SECRET` of at least 32 characters, and an exact source-SHA header matching its deployment. Query/body overrides are rejected. The separate worker has its own distinct cron secret, validates its own dedicated project ID and source package, refuses redirects and rejects signing/database/RPC environment variables. Its target secret never reaches the browser.

Each run verifies chain 421614, takes a fenced 330-second global lease, resumes at most three existing scheduler requests first, and creates no new intents while a submitted request remains uncertain. Candidate selection is capped at 25 overdue active mapped roots on the configured factories. A run has a 180-second work deadline, 15-second evidence-read waits and at most three settlement attempts, including failed attempts. Wallet leases remain the authority at every nonce/sign/broadcast boundary.

Initial automatic scope reuses the existing source readers:

- `sports_api`: ESPN, football-data, MLB Stats and next-opponent with binary, draw3 or total-goals-over shapes.
- `chainlink_price`, `api_price`, `weather_api` readers, including their existing evidence/defer rules.
- Parallel/multiple-winner products, child legs, transcripts, charts, airport and other review-heavy resolver families remain manual. Incomplete evidence never becomes an inferred outcome.

Requests have deterministic market/factory/contract/outcome keys. The original resolver configuration/outcome-label hash and source evidence (observation time, score and reader metadata) are immutable in the private request payload/plan, including a crash before planning. A changed source configuration prevents a fresh signature; receipt recovery still reconciles an already submitted transaction. Score/reader metadata is retained for audit; this initial service does not patch display scores or mutate source configuration. Status/outcome updates belong to the indexer.

The admin panel shows the latest run status/time and request confirmation/indexing state. Run reports contain bounded, sanitized IDs/reasons, without signed bytes, private plans, credentials or raw provider errors. A failed evidence read leaves a deferred market, so operators must review overdue markets as well as worker errors.

## Indexing

Factory lifecycle events are applied in **block/log order across event types**. This prevents a scan containing resolution, dispute, correction and later dispute-clear events from ending in an incorrect state merely because RPC logs were fetched in separate groups. Both V1 and V2 use the shared ordered path. Cancellation refund events retain their existing separate processing; this feature does not submit refund batches or rewrite immutable trades/redemptions.

## Release and later activation procedure

The main preview release, additive migration, updated indexer and disabled-mode checks below are complete. A private standby package was prepared, without deploying a resolver project. Signer-policy preparation, active scheduling and the live rehearsal remain future steps. The checklist is retained for reproducible releases and later activation.

1. Review and commit the integrated source, including the pre-existing operations/history work; push only `onchain-sepolia` when authorized. Rebuild both apps. Record the exact source SHA.
2. Review the additive preview migration. With the direct pinned preview connection and isolated preview metadata, the explicit command is:

   ```sh
   node frontend/api/scripts/onchain-sepolia-settlement-schema.mjs --apply-preview
   ```

   It extends the existing durable action constraint and adds resolver run/lease tables. It never runs from a request. The dedicated reader/indexer/standings roles receive no access to the private resolver ledger. No production database or pooler connection is accepted.
3. Configure the explicit owner/resolver accounts and verify actual factory roles, collateral/pool bindings, Turnkey selectors, balances, nonce state and limits through read-only checks. Preserve the current token/cycle. Keep both new main-preview flags false during deployment/readiness checks.
4. Deploy the main preview and updated dedicated indexer from the reviewed source. Verify authenticated admin GET, legacy route guards, unchanged user trading, disabled resolver response, and event coverage without submitting transactions.
5. Prepare a **new private standby package** targeting the exact immutable deployment:

   ```sh
   node ops/onchain-sepolia-resolver/prepare.mjs \
     --output /private/tmp/pronos-resolver-standby-release \
     --target https://pronos-DEPLOYMENT-mezcalpapieth-jpgs-projects.vercel.app/api/cron/sepolia-resolve
   ```

   Replace `DEPLOYMENT` with the real deployment ID segment; this illustrative placeholder is not a deployable URL. Preparation requires clean committed `onchain-sepolia` worker/API/shared-library source and creates a new directory without copying `.env` files. It never deploys. Configure a separate Vercel project with `PREVIEW_RESOLVER_PROJECT_ID` matching its own ID; do not reuse the main app or indexer project. Check the authenticated disabled worker and empty cron.
6. **Only after separate authorization to spend bounded rehearsal gas**, enable the admin settlement flag and exercise V1/V2 resolution, timeout/same-key recovery, dispute/correction before any payout, cancellation and eventual indexing. Verify that attempted correction after a payout fails simulation. Cancellation alone does not complete refunds.
7. Review and prepare an active package with `--active`, set separate main trigger/worker cron secrets, enable the main schedule flag and worker flag, and deploy the dedicated active package. Observe actual scheduled runs and recovery. The worker must be repackaged when the target preview/source SHA changes. Disable the worker and main schedule flag to stop new automatic resolutions; reconcile submitted requests through the same durable keys.

## Local validation

The new tests use local PostgreSQL/WASM databases, deterministic public fixture keys, mocked RPC/signing and mounted React fixtures. Worker packaging is tested in a temporary Git repository, and does not deploy. Coverage includes exact zero-ID mapping, V1/V2 resolution, four owner actions, missing/mismatched chain mappings, fees/reserves/budgets, same-key recovery, source changes after a crash, Points mutation guards, HTTP authorization/redaction, source-pinned triggers, scheduler filtering/leases/attempt caps, worker isolation/standby packaging, mounted browser retry/account isolation and canonical lifecycle event indexing.

The disabled-mode release is verified; live settlement/scheduling rehearsal remains necessary before these capabilities can count as tournament launch evidence. See the [November readiness assessment](./onchain-sepolia-tournament-readiness-2026-11-04.md) for the remaining season provisioning, standings activation, refund execution and full-season rehearsal work.
