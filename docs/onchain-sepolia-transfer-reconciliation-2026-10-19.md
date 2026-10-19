# External transfer reconciliation

Implemented on `onchain-sepolia` for future funded tournaments. This extends the read-only shadow snapshot/capture pipeline. Its Preview release does not change the trading contracts, live leaderboard, current token, current cycle, runtime settings or database. No transaction, signature, ETH spending or migration is required.

## Scoring policy

The user-approved policy excludes incoming transfers and scores only the eligible portion of later trades. Each registered wallet has separate actual and eligible cash/share balances. Its verified equal opening grant or canonical late grant is the only entry of eligible capital.

- Incoming MXNP and ERC1155 gifts increase actual holdings and remain excluded from score, including transfers between two registered participants.
- Outgoing transfers reduce eligible holdings proportionally. Returning the assets does not restore their eligibility. Self transfers and zero amounts have no scoring effect.
- Buys allocate new eligible shares according to the eligible fraction of cash immediately before the purchase. Gross buy cash is debited once. Sales and redemptions credit the eligible fraction of actual net proceeds; excluded proceeds remain outside the score when reused.
- Integer debits round up and eligible credits round down to prevent fractional units from manufacturing score. Protocol cost-basis reductions preserve contract floor rounding. All amounts use integer six-decimal units.
- Activity before a late grant is replayed for actual balances and cost basis but creates no eligible position or event count. Existing externally funded holdings remain excluded after registration.

Example: a wallet with 500 eligible MXNP receives another 500 MXNP externally. A subsequent 100-MXNP buy uses 50 eligible MXNP and credits half of the purchased shares to scoring. Later sale/redemption proceeds follow that eligible fraction. Sending eligible assets to a second participant reduces the sender's score and does not increase the recipient's score.

## Cancellation and cost basis

The contracts do not move purchase cost basis with ERC1155 transfers. The adapter therefore replays actual contract basis separately from scoring basis. Buys add gross basis; sales and ordered cancellation burns reduce actual basis using the holder's actual share balance. Redemption burns shares without reducing contract basis, matching both deployed contract implementations.

A canceled position's eligible value is capped by both its remaining eligible purchase basis and the eligible fraction of its actual refundable basis. Zero held/eligible shares have zero value even when the contract retains basis. Refunds credit only the eligible fraction of the actual payout, with ordered burn attribution and exact integer rounding. Transferring shares away and receiving them back cannot recover scoring basis. An underpaid refund records its proportional eligible loss.

## Canonical capture and verification

The adapter now scans all collateral `Transfer` and share-token `TransferSingle`/`TransferBatch` events from the earliest reviewed mint/market creation through the pinned cutoff. Because the fresh owner-minted token has no burn function, the exact reviewed mint receipts plus exact total supply establish issuance provenance. Complete factory registration establishes the known share ID ranges. Pre-start transfers after minting are included.

Each returned asset log is checked against its successful canonical receipt and block hash, deduplicated and replayed in block/log/item order. Batch item order and duplicate IDs are preserved. Known receipts must also have complete transfer-log coverage. Economic events consume only their exact user cash/share legs; other transfers in the receipt remain external. Missing or ambiguous legs, unknown nonzero share IDs and user transfers interleaved inside a protocol action require review rather than guessed attribution.

At the cutoff, the adapter checks historical ERC20 cash for every registrant and historical ERC1155 holdings for every registered wallet/outcome, including empty positions. ERC1155 reads use batches of at most 256 account/ID pairs. Every touched position's actual pool cost basis is also checked. A mismatch stops output; it is never converted into an eligible balance adjustment.

These checks use a trusted complete historical RPC, not a cryptographic completeness proof. An RPC that silently omits an entire net-zero transfer round trip outside all known receipts cannot be detected by ending balances alone. Existing hash, receipt, resource-budget, lifecycle and reorg checks remain mandatory.

## Operator usage and artifacts

The [snapshot](./onchain-sepolia-canonical-snapshots-2026-10-18.md) and [resumable capture](./onchain-sepolia-full-tournament-capture-2026-10-18.md) commands are unchanged. Use a newly reviewed future funded cycle; current mixed technical factories are not a tournament fixture. No live run is possible until that separate cycle workflow is authorized.

New snapshot artifacts have `version: 2`. `snapshot.assetLedger` records the canonical movements and grant anchors. Score rows include eligible `cashUnits`, `actualCashUnits` and `excludedCashUnits`; eligible and actual positions are separately available. `scores.transferReconciliation` identifies the policy, exact external movements, event count and whether the adapter completed historical balance verification. The reproducible snapshot hash covers those fields.

Capture manifests use identity version 2 and transfer reconciliation version 1. **Use a new private checkpoint directory**: old manifests refuse reuse with `capture_context_mismatch`. The same per-run quota and interruption/resume behavior apply, and asset log pages participate in the saved cache and hard budgets. Expanded batch movements also have a hard count limit.

The offline scoring command can recompute the saved `snapshot` object without network access. It never claims fresh historical RPC verification. Legacy inputs without `assetLedger` remain available for calculator fixtures and explicitly report `policy: not_captured` and `historicalBalancesVerified: false`.

All artifacts remain private, `mode: shadow` and `readyForRewards: false`. Publishing tournament scores, post-end settlement, archived-cycle presentation, reward eligibility and live future-cycle activation remain separate roadmap work. Release verification records the exact pushed commit, Preview deployment and read-only readiness separately; shipping the operator code does not activate a future cycle or run a live capture.

## Local validation

Tests use simulated canonical RPC receipts with real ABI encoding and local PostgreSQL/WASM, without live chain/database access. New cases cover incoming/outgoing gifts, participant-to-participant transfers, mixed eligible/excluded trading, both contract versions' redemptions, diluted cancellation claims, retained contract basis, duplicate batch IDs, self/zero transfers, same-receipt actions, missing/forged/hidden logs, historical balance mismatches, pre-start movements, grant/hash conflicts and micro-unit rounding. Capture coverage includes old-manifest refusal, resumable quotas and the existing month-length and 600-user/102-market profiles.

Release validation: **all 72 tournament tests passed in one full run**, with zero failures or skips, including the month-length capture and local PostgreSQL/WASM tests. The 600-user fixture replaced its old funding logs along with its plan so the new global log-position checks validate a consistent history. Both Points and MVP frontend builds also passed; generated outputs were restored and excluded from the commit. Trading contracts are unchanged and require no deployment.
