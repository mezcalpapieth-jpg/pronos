# Points liquidity defaults: 25% reduction

The user confirmed a **25% reduction of the current defaults**, replacing the
earlier proposed 60% reduction. This is not a blanket 100k/50k target.

## New opening reserve floors

Amounts are MXNP per outcome reserve, not total collateral or total reserves.
Parallel markets use the binary amount for each side of each tradable child.

| Pool | Previous sports | New sports | Previous non-sports | New non-sports |
| --- | ---: | ---: | ---: | ---: |
| Binary / parallel binary child | 5,000 | 3,750 | 2,500 | 1,875 |
| Unified 3-option | 10,000 | 7,500 | 5,000 | 3,750 |
| Unified 4+ options | 20,000 | 15,000 | 10,000 | 7,500 |

The shared default feeds new manual creation, newly generated Points markets,
and approval-time floors for pending rows. Uniform opening probabilities remain
unchanged. Non-sports remain half of sports, independent of a trophy or date.
Explicit larger pending seeds and asymmetric pricing are preserved rather than
treated as permission to overwrite custom settings. Regeneration supplies the
new defaults for automatically generated pending specs.

Daily and minute Bitcoin/ETH windows use 1,875 per side, including windows
without a trophy. Untouched, pre-created pending rolling windows with either
previous automatic seed (1,000 or 2,500 per side) adopt the current default only
when activated. Active pools, traded or positioned windows, mismatched reserves,
and other custom seeds are not reset.

## Unchanged

- No live pool reserves, current odds, balances, share quantities, or trades are edited.
- Ballon d'Or already has 100,000 MXNP net additional system funding; the original
  250,000 funding receipt records the earlier 150,000 withdrawal separately.
- Existing trophy-market funding is not withdrawn or scaled down.
- On-chain liquidity and the stock branch are unchanged.
- No production deployment is part of this change.

This supersedes only the future-default amounts in
[the October 15 rollout](liquidity-rollout-2026-10-15.md), not its live funding receipts.

## Verification

- 60 focused defaults, generator, approval, admin, and rolling-crypto tests passed.
- 112 AMM, funding, routing, pricing, and limit-order regression tests passed.
- Points production build passed, writing only to a temporary output directory.
- `git diff --check` passed. Validation made no live database writes or deployment.
