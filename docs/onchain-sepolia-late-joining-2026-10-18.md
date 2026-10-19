# Late joining, starter gas and lifecycle accounting

Prepared on `onchain-sepolia` after capture release `f27acc1d2050ddf1fd30b361bbd8e2f8050ed163`, for the requested Preview release on 2026-10-19. Release scope is code deployment and read-only readiness verification. Future-cycle late joining remains disabled pending its separate plan, migration, signer and activation review. Pointbreak, production, the active cycle, existing MXNP supply and live environment settings remain unchanged. No ETH, broadcast transaction, live migration or new token is required for this release.

## Joining during a future tournament

Any authenticated Pronos account with a unique username, EVM wallet and Turnkey suborganization can receive the same opening allocation during the cycle window. There is no opening-roster allowlist for late entrants. A previously skipped account becomes eligible once its wallet is ready. An initially funded account cannot receive a second allocation.

Future plan creation accepts `--late-join-reserve-mxnp=N`. A positive reserve creates a version-2 immutable plan with `lateJoining: open_during_cycle`. Existing version-1 plans and their hashes remain valid. Issuance is:

```text
initial users × equal allocation + market liquidity + late-join reserve
  <= reviewed total issuance cap
```

The reserve is pre-minted to operations in the opening batches alongside liquidity, with its budget recorded separately in the plan. Late grants transfer existing cycle tokens; they never invoke mint authority or change total supply. Operations must retain that reserve rather than consume it as seed liquidity. The ledger enforces the reserve's total allocation ceiling, and transfer simulation detects insufficient available tokens. If exhausted, funding pauses instead of silently raising issuance or giving a smaller grant. Size the reserve for expected growth before reviewing the immutable plan.

`POST /api/points/tournament-join` derives identity from the session, never from a client-supplied wallet. When explicitly enabled, authenticated on-chain balance views perform that registration before displaying spendable tokens, so a zero balance cannot prevent the first purchase. Each mounted account view remembers successful registration; account switches create a new reader. Pending/failed registration withholds the balance and retries on the existing refresh interval. The normal protocol buy endpoint also prepares registration before buying. A new payment returns pending; the next attempt reconciles it after two confirmations and then proceeds. Public config advertises the capability only when explicitly configured. GET configuration/balance/portfolio and signup themselves do not transfer tokens or gas.

The explicit future migration adds `sepolia_tournament_joins`. Unique cycle/username, cycle/wallet and cycle/suborg constraints prevent duplicate grants. The operations lease, nonce checks, atomic identity/window/budget guard and signed payload saved before broadcast protect overlapping requests and response loss. A pending signature is always resumed with the same bytes, even after the cycle ends. If another operations transaction consumed its nonce without a receipt, the service stops for investigation. It never replaces that payment automatically. No signed transaction, private roster or provider error is returned by the API.

Activation is separate and was **not performed**:

1. Review a future v2 plan with sufficient liquidity and late reserve within its issuance cap. Complete the existing fresh-token/factory/router deployment and initial funding workflow only when authorized.
2. Apply the exported tournament migration to the isolated preview and assign the application role its required access. Ensure the snapshot reader can read join audit columns. Never run it against Pointbreak's database.
3. Review the future runtime handoff, operations wallet/suborganization and its Turnkey permission for that exact token's `transfer`. The handoff defaults `ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED=false`.
4. Configure `ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID` for the reviewed operations signer and enable `ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED=true` only on the branch Preview. Cycle ID and deployed token/factory/router/operations bindings must match the funded plan.
5. Rehearse a newly created account and repeated attempts, then verify the canonical grant, grant count, gas tier and scoring boundary. A live rehearsal spends test ETH and was deferred here.

The route refuses production, other branches/chains, another database host, unconfigured funding, ambiguous identity and mismatched runtime bindings. It cannot authorize a user to trade; the normal owner-approved router delegation still applies.

## Starter gas and active-user top-ups

Gas remains on demand before a valid authenticated buy/sell/redeem, after checking owner-approved delegation and actual trading eligibility. Quotes, page views, signup and failed authorization cannot obtain ETH.

| Policy | Value |
| --- | --- |
| Starter target | 0.00005 ETH, raised if the bounded trade/approval fee estimate requires more |
| Trade gas estimate buffer | 125% of the existing bounded gas-unit estimate at the fee quote |
| Starter lifetime transfer ceiling until activity | 0.0002 ETH per wallet/suborg identity |
| Active-user refill threshold / target | 0.0002 / 0.0005 ETH, subject to estimated required gas |
| Existing cooldown | 5 minutes |
| Rolling daily wallet/suborg cap | 0.002 ETH |
| Rolling global daily cap, including transfer fee ceilings | 0.1 ETH |
| Retained gas-wallet reserve | 0.01 ETH |

At the test fixture's 0.04-gwei fee and 720,000-unit limit, the buffered requirement is 0.000036 ETH. The runtime uses the current bounded estimate instead of assuming the small target always covers the first trade. At the existing maximum fee and 720,000-unit limit, required funding is 0.00018 ETH. The lifetime cap prevents idle wallets repeatedly draining the faucet by waiting out cooldowns. A failed transaction/request does not promote the wallet. Existing budgets, persisted-signature recovery and dedicated funder constraints remain in force.

Promotion requires a successful canonical receipt with at least two confirmations containing a positive buy/sell/redemption event for that wallet from a pool verified through a configured factory's on-chain market registry. Indexed `trades`/`redemptions` are bounded candidate hints; the service independently checks the receipt, actor, pool and block hash. Native transfers, token approvals, page visits, arbitrary nonces and request counters do not qualify. Indexer lag may delay promotion; it cannot manufacture activity. RPC/database failures do not grant an unverified larger allowance. Already sufficiently funded wallets retain the existing fast path.

No gas migration is needed: lifetime starter usage is conservatively derived from the existing transfer ledger, across wallet/suborg matches. The admin gas-readiness summary includes starter amounts. The two tiers take effect when this code reaches the Preview under its existing automatic-gas flag. Deployment/readiness checks do not request a trade or gas transfer; a live first-trade/top-up rehearsal remains deferred.

## Canonical registrations and capture

The snapshot command first fixes an already-final cutoff before querying registrations. It reads only public audit fields from the future join ledger and refuses unresolved payments; reconcile those payments first. Canonical receipt, transfer calldata, sender, recipient, amount, chain, zero native value, timestamp and block hash prove each late grant. A cutoff reorg stops capture. A grant after the cutoff is excluded, and a delayed transfer at/after tournament end adds no registration to scoring.

Late registrations are separate from the immutable opening roster. A user's equal opening scoring cash becomes available at the grant's exact block/log position. Earlier trades cannot retroactively spend that allocation. Duplicate identities and reserve overruns refuse scoring. The capture manifest binds late-join references; a changed set requires a new checkpoint context. Existing checkpoints from the earlier format are deliberately refused rather than reused under changed accounting. The command performs three additional read-only cutoff controls before its existing capture controls/quotas.

## Cancellation refunds and resolution corrections

Trading contracts and dispatcher calculations are unchanged. The shadow adapter now validates the complete sorted lifecycle, including events for unregistered wallets:

- Canceled positions carry remaining gross purchase cost basis. Sells remove proportional basis using the contracts' integer rounding.
- Each refund uses the actual payout from `CancelRefunded` and exact same-receipt ERC1155 burns by that pool. V1 uses market ID × 2; V2 uses market ID × 256. Repeated-outcome burns retain their sequence to preserve rounding.
- Payout must not exceed removed cost basis. Partial/full refunds remove the corresponding shares and add cash once. A smaller payout records the actual loss. Zero-payout empty refunds are no-ops.
- For canceled markets, final registered-user share balances and cost basis must reconcile against historical contract reads. An external movement that changes that reconstruction stops the snapshot.
- Dispute/clear sequences and correction-plus-resolution event pairs are checked in order. A correction is valued using the final winner once. Any prior redemption anywhere in the pool forbids cancellation/correction. Open disputes stop scoring pending review.

The accounting is shadow-only and remains `readyForRewards: false`. General external-transfer reconciliation, post-end settlement snapshots, archived-cycle UI/routing, independently reviewed rewards and a live cancellation/correction rehearsal remain separate work. The current portfolio/indexer UI is not claimed to expose this shadow cancellation accounting.

## Verification

Local tests use fake RPCs with real ABI encoding/offline signatures and PostgreSQL/WASM (PGlite), never the live chain/database. They cover one-time funding, concurrent attempts, receipt loss/recovery, budget/identity/window/lease guards, version-1 compatibility, canonical late registration, pending-join refusal, starter lifetime limits, activity promotion, partial/underpaid refunds, burn attribution/rounding, both token ID formats and correction/dispute/payout restrictions. Frontend coverage verifies registration before balance loading, retry behavior, account isolation and disabled previews/production. Across focused runs, **190 distinct tests passed without skips**. Both frontend builds passed. The release evidence and roadmap distinguish the deployed capture SHA from this local continuation.
