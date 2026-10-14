# Ballon d'Or liquidity review

Date: 2026-10-14. Market: **317676**, men's Ballon d'Or 2026.
Scope: Pointbreak, off-chain Points (MXNP), not the real-MXNB/on-chain exchange.
Production inspection was read-only. No funding was applied to the live market.

## Finding

The reported jump is real and reproducible with the existing unified nine-outcome
fixed-product AMM. It is not a parallel-binary market or a last-fill chart error.
Several outcome reserves are now very small relative to a 100 MXNP order. The
pool has lots of inventory in some outcomes but very little effective depth
between the leading contenders. Historical volume and the sum of reserves do
not measure that marginal trading depth.

Observed reserve snapshot, in outcome order:

```json
[319.139211,11.707936,2619.071733,2619.071733,2619.071733,115.646882,2619.071733,3346.351733,3346.351733]
```

A 100 MXNP AMM buy of Harry Kane reproduces **8.7064% to 90.0918%**.
The latest inspected actual fill, 25587 at 2026-10-14 21:11:19 UTC, bought Mbappe
for 100 MXNP and moved **12.9244% to 85.9990%**. Quoting its pre-trade reserves
reproduces its 202.816950 shares and 4.353700 MXNP fee.

For outcome i, the invariant is the product of reserves. Net collateral adds one
complete set across all outcomes; the selected reserve then falls to preserve
that invariant. Marginal prices are normalized inverse reserves. Thin reserves
can therefore cause very large moves even in a nine-outcome market.

## Implemented change

Admin > Edit market > **Liquidez del AMM** now supports an explicit, previewed
system liquidity contribution to active Points unified markets. It supports
binary and 3-20-outcome pools, but refuses parallel parents, child markets,
on-chain markets, and closed/expired/archived markets.

The contribution scales current reserves proportionally. It does not reset them
to the original seed or to equal probabilities. If F is the new system funding
and M is the largest current reserve:

```text
added[i] = floor_to_6_decimals(reserve[i] * F / M)
newReserve[i] = reserve[i] + added[i]
retainedSystemShares[i] = F - added[i]
```

This is complete-set funding with excess outcome shares retained by the system
funder. Each outcome's added plus retained shares equals the same F backing.
It is not arbitrary inventory creation without a corresponding funding record.
The proportional approach follows the funding mechanism in the primary
[Gnosis fixed-product market-maker contract](https://github.com/gnosis/conditional-tokens-market-makers/blob/master/contracts/FixedProductMarketMaker.sol).

The contribution is explicitly **system-underwritten virtual MXNP**, recorded in
`points_market_funding`. It is not a real MXNB deposit, a debit from a user's
wallet, or a tradable user position. Real-money LP funding would need actual
collateral custody, LP ownership, and settlement accounting; this endpoint
deliberately does not enable it.

## Recommended sizing for this snapshot

The preview finds the smallest whole-MXNP contribution that keeps a reference
**100 MXNP AMM buy within five percentage points for every outcome**, using the
same quote math and fees as trading. The reference excludes resting book orders;
actual orders still use the existing best-price book/AMM router.

For the inspected snapshot, the recommendation is **90,873 MXNP**, approximately
**28.1558x** the current reserve depth. Existing probabilities stay unchanged.

| Outcome | Current probability | After 100 MXNP buy, current pool | After 100 MXNP buy, funded pool |
| --- | ---: | ---: | ---: |
| Lamine Yamal | 3.15% | 79.74% | 5.17% |
| Kylian Mbappe | 86.00% | 96.57% | 86.82% |
| Erling Haaland | 0.38% | 34.71% | 0.64% |
| Ousmane Dembele | 0.38% | 34.71% | 0.64% |
| Jude Bellingham | 0.38% | 34.71% | 0.64% |
| Harry Kane | 8.71% | 90.09% | 13.71% |
| Vitinha | 0.38% | 34.71% | 0.64% |
| Rodri | 0.30% | 29.45% | 0.50% |
| Other | 0.30% | 29.45% | 0.50% |

This is a sizing target, **not a permanent price-impact cap**. Larger orders or
later one-sided trading can still move prices substantially. Repeat the preview
against current reserves before funding; do not hardcode the snapshot amount.
More depth also makes genuine price discovery slower and increases the system's
virtual funding commitment. It should be an explicit market-level decision.

## What changes and what stays unchanged

- Changes: AMM inventory, execution depth, future buy/sell quotes, funding audit,
  and an unchanged-price snapshot recording the reserve change.
- Unchanged: current probabilities within micro-unit rounding, users' share
  counts, balances, cost bases, realized PnL, trade history, original seed values,
  resting orders, and resolution rules.
- Existing holdings can become easier to liquidate with less slippage. That is
  an intended consequence of liquidity funding, not a change to shares owned.
- There is no automatic funding, pool repricing, curve replacement, conversion
  to parallel markets, or historical balance correction.

## Operational safeguards

Funding requires existing admin authentication/CSRF checks, a simulated amount,
an explicit confirmation, and a unique retry key. The server locks the market
using the same row lock as trading and rejects stale reserve previews. Reserve
updates, the complete funding audit, and the price snapshot commit atomically.
Retries cannot apply the same funding twice. Per-contribution and per-reserve
limits are 10,000,000 MXNP; rounding that would materially change odds is refused.

After a separately approved deployment, open Edit market, inspect the proposed
funding, click **Simular**, compare every outcome, then confirm and add liquidity.
The metadata Save button does not apply funding. If a trade intervenes, simulate
again. Applying the displayed amount is a separate live admin operation.

## Verification

- Exact reproduction of the reported 100-unit jump and observed latest fill.
- Proportional funding, complete-set accounting, normalized probabilities, and
  minimal recommendation sizing across all outcomes.
- Immediate buy/sell round trips after funding across binary/multi-outcome pools
  cannot return more than the purchase amount less the buy fee.
- SQL integration tests verify rollback, retry safety, stale previews, market
  restrictions, unchanged holdings/balances/seeds, and API authentication guards.
- Browser QA exercised the real component and API handler against an isolated
  in-memory Postgres database, including funding confirmation and a single audit
  row. Desktop, 390px, and 320px layouts were inspected without page overflow.
- All 140 focused/regression tests passed. Points production build completed
  successfully. Existing trading/router,
  limit-order, creation/editing, and schema tests were also run.

Delivery is a source commit/push on `pointbreak` only. No production promotion,
production migration, or live liquidity addition was performed.
