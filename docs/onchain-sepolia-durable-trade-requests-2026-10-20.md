# Durable trade requests and wallet nonce coordination

Date: 2026-10-20. Branch: `onchain-sepolia`.

Implementation: checked locally. The separately requested release covers the isolated preview migration, branch-only flag activation, deployment and read-only readiness. Release evidence is recorded separately after deployment. This document describes the implementation and release procedure, not proof of a completed live trading rehearsal. Pointbreak, contracts, the current token and current cycle are unchanged. The existing AMM remains the execution model; a future CLOB is a separate decision.

## Request and transaction lifecycle

When enabled, protocol buy, sell and redeem require a client-generated `requestId` or matching `Idempotency-Key` header. Keys belong to the authenticated wallet on chain 421614. Reusing a key with another action, amount, market or accepted price protection returns a conflict. The server stores the accepted input and freezes the prepared plan, including the pool and minimum output. A retry never refreshes that plan into a different trade.

The database records the request before execution, reserves an unsigned transaction and nonce before requesting a signature, then persists the verified signed bytes and hash before broadcasting. Collateral approval, share approval and the economic trade have separate durable steps. A database lease and fencing token serialize each wallet; database uniqueness prevents reuse of a recorded nonce and permits only one unresolved transaction per wallet. Independent wallets can proceed concurrently.

A retry checks the saved hash and may rebroadcast only the exact saved bytes. It never allocates a replacement nonce for a signed transaction. A receipt can complete recovery after a market closes, the season ends or the original HTTP response is lost. New signatures still check current market/season eligibility. Approval-only recovery settles the approval first, then validates the still-unsigned trade. An unsigned request rejected after closure releases its unsigned reservation; already signed transactions are retained.

States distinguish `created`, `validated`, `pending`, `confirmed`, `reverted`, `rejected` and `needs_reconciliation`. A fresh request blocked by an existing unresolved wallet transaction is rejected rather than left as an executable queue entry. Successful retries replay the stored result. A rejected or reverted key remains terminal; a later intentional trade requires a new key. Confirmation uses the existing one-confirmation policy. Indexer ingestion remains separate.

## Browser recovery and privacy

Both the Points adapter and direct MVP protocol callers use a wallet-scoped browser journal. They persist the request key and accepted input before POST; unavailable browser storage stops submission. Retries retain the original input and output bounds, and concurrent identical clicks share the same submission. Account changes use separate journals, and POST checks the identity scope obtained from the authenticated server.

`GET /api/protocol/trade-request` is private and read-only:

- `action=identity` returns the session wallet's recovery scope.
- `action=pending` discovers an unfinished request for that owner, including its original accepted input, so another browser can resume it.
- `requestId=...` reports the owner's request state and distinguishes chain confirmation from indexed history.

These GETs never sign, fund, broadcast or modify rows. Responses exclude signed/unsigned transaction bytes, internal plans and database IDs. Signed bytes remain server-side and must be treated as sensitive capabilities, including in backups and operator tooling.

The Points preview shows a pending-trade notice with an explicit check/resume action, including when the market can no longer be traded from its detail view. Confirmation and indexing have separate messages. A lost success response is acknowledged from saved status without another trade. There is no new background retry worker: progress resumes through an explicit retry/POST; polling only reads status.

## Preview activation procedure

The feature is default-off. It requires all existing preview guards plus `ONCHAIN_DURABLE_TRADES_ENABLED=true`, chain 421614, an RPC URL and the pinned isolated Sepolia preview database. An enabled but invalid configuration fails closed. Normal flag-off execution remains available for the existing runtime.

For a separately authorized release:

1. Review and commit the source, then push `onchain-sepolia`.
2. Install the additive schema in the pinned isolated preview database before enabling the flag. The schema command prints SQL by default:

   ```sh
   cd /Users/Fran/pronos/frontend
   node api/scripts/onchain-sepolia-trade-schema.mjs
   ```

   Applying requires explicit `--apply --expected-host=<reviewed-direct-preview-host>`, the exact direct database host, `onchain-sepolia` Git branch and existing preview metadata. Load credentials privately; do not put connection strings in command history or logs. The apply command uses one database transaction and sends no chain transactions.
3. The migration explicitly revokes access from PUBLIC, `pronos_reader`, `sepolia_indexer` and `sepolia_standings`, overriding owner defaults that otherwise grant reader access. It grants the application role `pronos_writer` SELECT/INSERT/UPDATE/DELETE, including unsigned-reservation cleanup. Audit effective privileges on the three new tables before enabling the flag; indexer, standings-worker and public roles must not gain access through membership or default privileges.
4. Enable the flag only on the branch preview and deploy the reviewed SHA. Verify authenticated status/privacy, missing-key rejection, config discovery and both frontend bundles without submitting a trade.
5. Run a real buy/sell/redeem timeout/retry rehearsal only under separate authorization to spend ETH. The local tests below are not a live-chain rehearsal.

Rollback must preserve the ledger. Drain or reconcile unresolved signed requests before disabling coordination or restoring the legacy signing path; otherwise that path could bypass the outstanding nonce reservation. Do not delete request records to clear an uncertain transaction.

## Recovery limits

External wallet transactions cannot be controlled by the application lease. An external pending nonce prevents a new signature; consumption of a saved signed nonce without its receipt holds the wallet for reconciliation. A delayed receipt for the original hash can clear that state on retry. There is no automatic fee bump, replacement, cancellation or new-nonce replay. Persisted fixed-fee transactions that remain dropped or underpriced need an operator recovery procedure before the wallet can advance. Signing-lease expiry prevents a stale worker from persisting or broadcasting after another worker takes over.

The change preserves the current confirmation and indexer behavior; it does not introduce stronger chain-finality or reorg handling. A mined transaction whose expected event cannot be parsed remains reconcilable and is never executed again. This milestone does not change AMM pricing, contract settlement, token issuance, tournament resets or reward accounting.

## Local verification

All **100 distinct focused tests passed without skips**: the 99-test release regression and the added migration privilege test. The latter reproduces inherited reader grants, proves all three restricted roles cannot read the ledger and verifies application reservation cleanup. Integration tests execute the real schema in local PGlite, use deterministic public fixture keys and fake RPC providers, and make no network or live signing calls. Coverage includes:

- Lost success responses, RPC errors after acceptance, signer timeouts and restart recovery using the same persisted transaction.
- Approval/trade nonce order, concurrent duplicate requests, lease expiry and stale-worker fencing.
- External nonce consumption, lagging RPC nonce reads, wrong networks, changed input and account switches.
- Reverts, closed-market unsigned rejection, receipt-parser failure, owner-only status and confirmed/indexed reporting.
- Browser refresh, another browser's pending discovery, storage failure, original price bounds and HTTP 202 handling in both frontend callers.
- Existing quote fees, slippage guards, router destinations, delegation checks and automatic gas-funding behavior.

The combined request regression command, from `/Users/Fran/pronos/frontend`, is:

```sh
node --test api/_lib/trade-requests.integration.test.js api/protocol/trade-request-api.test.js api/_lib/onchain-trader-router.test.js api/_lib/onchain-sell-quote.test.js api/_lib/protocol-trade-guards.test.js api/_lib/onchain-fees.test.js api/points/onchain.test.js app/points/src/lib/tradeRequests.test.js app/points/src/lib/executionAdapter.test.js app/src/lib/protocolTradeRequests.test.js
node --test api/_lib/sepolia-user-gas.test.js api/_lib/sepolia-gas-funding.test.js
```

Both Points and MVP production builds passed into temporary directories. Existing dependency annotation, mixed static/dynamic import and large-chunk warnings remain. Tracked generated frontend assets and contracts are clean. No live readiness or funds-moving rehearsal is claimed by these local checks.
