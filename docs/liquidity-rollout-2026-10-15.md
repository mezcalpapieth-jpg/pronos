# Trophy-only Points liquidity rollout

Applied October 15, 2026 Europe/Rome (October 14, 23:40:39-23:42:59 UTC).

## Approved scope and result

Only active, unexpired, off-chain Points pools with a tournament trophy on the
market or its parallel parent were eligible. Both pool and parent settlement
must fall inside the current tournament scoring window. Parallel containers
were not funded; their tradable binary children were.

| Scope | Pools | Added system liquidity (MXNP) |
| --- | ---: | ---: |
| Sports: full calculated top-up | 27 | 165,412 |
| Non-sports: half calculated top-up | 35 | 159,161 |
| Total | 62 | 324,573 |

All 62 planned pools were funded; none were skipped. This is below the approved
333,349.50 MXNP maximum after enforcing the user's additional trophy-only filter.
Non-trophy Bitcoin market 345574 was excluded. Ballon d'Or 317676, resolved
Roma-Madrid 349649, and other closed/resolved/non-tournament markets were untouched.

## Funding and checks

Funding scales each reserve proportionally by `1 + collateral / max(reserves)`.
Every collateral unit mints a complete outcome set; inventory not placed in the
pool is retained by the system and recorded in the funding receipt. This is
system MXNP liquidity, not a customer balance credit or a real-money deposit.

- All 195 before/after outcome prices matched within 0.000001 rounding.
- Entire user balances and positions hashes were identical before and after.
- Trade count stayed at 21,929 during the operation and verification.
- Market metadata excluding reserves was identical before and after.
- Protected markets 317676, 345574 and 349649 had exactly unchanged reserves.
- All 62 pools had matching audit receipts and reserve/price snapshots.
- Every receipt was independently verified as trophy-qualified.

The full recommendation tests every outcome at both buy sizes. At the funded
snapshot, the largest sports impact was 4.9999 percentage points for 500 MXNP
and 10 points for 1,000 MXNP. Non-sports deliberately received half the funding:
worst-outcome impacts ranged from 7.9384-9.5534 points for 500 MXNP and
14.5015-19.9672 points for 1,000 MXNP. Future trading can change depth again.

## Durable audit

Receipts are stored in `points_market_funding`, under operator
`codex:user-approved-trophy-half-nonsports`. Each has a unique request UUID,
collateral, before/after reserves and prices, and retained system shares.
The same UUID can be replayed without duplicate funding.

```sql
SELECT market_id, request_id, collateral, result, created_at
FROM points_market_funding
WHERE admin_username = 'codex:user-approved-trophy-half-nonsports'
ORDER BY market_id;
```

Local execution artifacts (temporary, not the durable audit):

- `/private/tmp/pronos-trophy-liquidity-half-nonsports-2026-10-15.json`
- `/private/tmp/pronos-trophy-liquidity-half-nonsports-2026-10-15.json.results.json`

Do not create and apply another fresh half-funding plan as a retry: that would
be a new funding operation. Only reuse the saved UUIDs for recovery.

## Local code, not deployed

Pointbreak changes add both stress targets to funding recommendations and Admin,
support funding valid parallel binary legs, and provide a guarded, resumable
rollout CLI. No AMM curve, fee formula or hybrid order-routing logic changed.

Future Points approvals and generated openings use these uniform per-outcome
reserve floors, independently of trophies and tournament dates:

| Pool type | Sports | Non-sports |
| --- | ---: | ---: |
| Binary / each parallel binary leg | 5,000 | 2,500 |
| Unified 3-option | 10,000 | 5,000 |
| Unified 4+ option | 20,000 | 10,000 |

The pending queue and approval share these defaults, including legacy pending
rows. Larger explicit seeds and custom nonuniform pricing are retained. Manual
creation shows the type-specific default while preserving admin-entered values.

Rolling Bitcoin/ETH windows bypass approval but use the same non-sports default:
2,500 per side, even without a trophy. Previously pre-created pending windows
with the exact old 1,000-per-side default adopt the new seed on activation only
if they have no trades or positions. Existing active pools are not reseeded.
The user explicitly chose future Bitcoin markets only: current pool 345574 was
not funded or otherwise modified in this follow-up.

Protocol/on-chain generation is unchanged. These future-default changes remain
local only until separately shipped and deployed.

Verification: 182 focused tests passed; Points production build succeeded;
`git diff --check` passed. Funding controls were checked at desktop and mobile
sizes with a local mock API, including confirmation reset on amount changes.
The actual creation form was checked with a local-only harness: automatic
category/outcome/AMM defaults, custom-input preservation, no mobile horizontal
overflow, and no browser console warnings or errors. Creation was disabled.
No code was committed, pushed or deployed, and the stock branch was untouched.
