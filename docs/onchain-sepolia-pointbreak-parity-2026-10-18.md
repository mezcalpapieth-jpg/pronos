# Pointbreak parity on onchain-sepolia — 2026-10-18

All 39 missing Pointbreak commits through `e71de9cf34fb1a454018b69da93bb0d9c3355aaf`
were cherry-picked into `onchain-sepolia`, starting from
`f8fbfab584fa75eacde747b65baf68c75cd14d72`. Each cherry-pick records its source
SHA in the commit message. The final source commit maps to Sepolia commit `2703a4f9`.

The integration includes market display and chart fixes, generators and official
resolvers, pricing and liquidity tooling, tournament scoring and claims, and the
Points stock simulator. No Pointbreak commits or files were modified.

## Sepolia integration decisions

- Keep the existing execution adapter, token balance display, quote/slippage
  protection, owner delegation, router, gas funding and tournament reset preparation.
- Keep stocks, Points tournament navigation and Points earnings views in Points
  mode. Stock positions and PnL do not enter the on-chain portfolio.
- Preserve execution guards when Pointbreak moves redemption into a shared
  helper. Automatic Points collections exclude on-chain positions.
- Reject on-chain markets in Points cancellation and early-No settlement, and
  exclude them from the Points auto-resolver. Protocol settlement continues
  through its existing path.
- Show pending-market seed amounts for the selected approval destination.
  Pointbreak's revised Points liquidity defaults do not silently alter the
  on-chain seed display or saved seeds.

## Verification

- 141 selected test files: 857 passed, zero failures, two optional SQL checks
  skipped because their local engine path was unset.
- Those optional Sepolia SQL suites were then run with the local PGlite engine:
  25 tests passed, zero failures or skips, including their supporting unit tests.
- MVP and Points production builds passed into temporary output directories;
  Vite reported its existing large-chunk warnings.
- All 39 source SHA trailers accounted for. Pointbreak refs and nine unrelated
  untracked market-export documents remained unchanged.
- Contract sources and the existing Sepolia runtime, router, delegation and gas
  configuration files remained unchanged. No database migration, live data write,
  deployment or chain transaction was performed; no ETH was spent and the current
  token and cycle were not changed.

This checkpoint is committed locally. Push, preview deployment and live readiness
verification remain separate release steps.
