# Pronos × Hyperliquid call

## Decision to make

Can Pronos route selected HIP-4 markets with measurable builder revenue and reliable depth for its users? A separate decision is whether Outcome would list a Pronos-branded Liga MX pilot under its existing venue. Routing requires a qualified builder account. The 500,000 HYPE venue stake applies to operating a venue. [Builder requirements](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) · [Venue activation and delegation](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions)

## Questions for Hyperliquid and Outcome.xyz

1. **Test access and revenue proof.** Can you send 110 mock USDC to the Pronos builder and 30 to the test trader as HyperCore testnet spot USDC, and point us to a stable two-sided test market? The [preflight record](pronos-preflight.json) has both public addresses. The builder needs Standard mode and at least 100 mock USDC of perps account value. The official faucet requires prior mainnet funding on the same address. Ask for the exact testnet market, both asset IDs, and an independently verifiable tagged buy and sell. [Builder requirements](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) · [Testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet)
2. **Fee mechanics and attribution.** Can Pronos use its own builder code on your markets while users retain your liquidity rewards? Which buy, sell, or complementary fills can miss a best-effort builder charge? How are minimum quote balance, rounding, multi-fill orders, and fee reconciliation handled? What rate and fee disclosure do you recommend given your published zero builder fee? [HIP-4 builder fees](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#builder-codes) · [Outcome fees](https://github.com/Outcome-xyz/mintlify-docs/blob/main/fees.mdx) · [Outcome liquidity rewards](https://github.com/Outcome-xyz/mintlify-docs/blob/main/outcome-liquidity-rewards.mdx)
3. **Executable depth and user access.** Which existing sports markets have dependable bid and ask depth within 1 and 2 percentage points, including near kickoff? Can you share snapshots and fill rates for 10, 25, and 100 USDC orders, and confirm what happens on partial fills and closes below the venue’s order minimum? What would the deposit, withdrawal, and wallet approval flows look like for a Mexico-based user? [Market data endpoints](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot) · [Order errors](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/error-responses)
4. **Liga MX pilot.** Can we list one regular-time fixture under `out` with your approved sports template and an agreed official result source? Who lists, settles, supplies two-way quotes, and handles postponements, disputes, and operational incidents? What deployer fee scale and partner split would you offer, how would we verify the split, and what minimum volume or market-making commitments apply? Confirm production SDK licensing or use of the direct API. [Templates, fee scales, and sub-deployer permissions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions) · [Outcome SDK license](https://github.com/Outcome-xyz/hip4/blob/main/LICENSE)

## Test acceptance

Approve 25 bps from the trader’s main wallet (`maxFeeRate: "0.25%"`), confirm `maxBuilderFee` returns `250`, then run a price-bounded tagged buy and sell on HyperCore testnet with room above the quote minimum on both sides. Preserve the order and trade IDs, fill notional, `feeToken`, and `builderFee` from `userFillsByTime`. Compare the sum of builder fees with the isolated builder account’s `referral.builderRewards` and USDC `tokenToState` deltas. The total `fee` already includes `builderFee`. The reconciled builder balance is the acceptance criterion. [Order and approval API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint) · [Fill and referral API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)

Public third-party testnet fills show the mechanism on both sides. A buy of 22 shares at 0.505 on `#265930` recorded 0.0001111 mock USDC of builder fee (trade `742657672152812`, 0.1 bps). A sell of 23 shares at 0.45 on `#112400` recorded 0.0025875 mock USDC of builder fee (trade `825695623242810`, 2.5 bps). Pronos-tagged fills and the Pronos builder account’s corresponding fee accrual still need to be verified. [HyperCore testnet API](https://api.hyperliquid-testnet.xyz/info)

## Economics at MXN 1 million in matched volume

The native scenario assumes a 0.40% contribution after variable costs, less MXN 250 in fixed costs. The HIP-4 sensitivities use the effective rate earned across eligible Pronos-routed fills. These rates absorb missed attribution and best-effort collection. All figures are illustrative and use equal fixed costs to isolate the revenue difference. [Pronos transition simulation](/Users/Fran/pronos/docs/pronos-clob-first-transition-simulation-2026-11-10.md)

| Route | Contribution before fixed costs | Net at MXN 250 fixed | Matched volume to reach MXN 3,750 net |
| --- | ---: | ---: | ---: |
| Native CLOB at 40 bps net variable | MXN 4,000 | MXN 3,750 | MXN 1.0M |
| HIP-4 at 10 bps effective | MXN 1,000 | MXN 750 | MXN 4.0M |
| HIP-4 at 22.5 bps effective (90% of 25) | MXN 2,250 | MXN 2,000 | MXN 1.78M |
| HIP-4 at 25 bps effective | MXN 2,500 | MXN 2,250 | MXN 1.6M |

Use `eligible Pronos-routed volume × observed effective builder rate − Pronos routing costs` for the pilot comparison. Apply any contracted deployer revenue share only to eligible fee-paying volume on partner-listed markets. Measure onboarding and funding costs, fills and slippage, plus maker commitments before evaluating profitability. [Deployer fee scale](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#deployer-fee-scale)

At MXN 70,000, the native assumptions yield MXN 30 net and HIP-4 at 22.5 effective bps yields MXN 157.50 before routing costs. HIP-4 beats the native result at equal volume if its incremental costs are below MXN 127.50. Routing avoids funding a Pronos CPMM, but does not guarantee higher contribution. An independent-maker native CLOB also need not put Pronos treasury inventory at risk.

Treat MXN 1 million as **actual, attributable fill notional in a rolling 30-day window per market**, with a consistent count of each execution once. Require repeatable two-sided depth, enough users likely to follow Pronos to its own book, and a better expected contribution after maker and operating costs before graduating. Route new markets to the chosen venue; existing HIP-4 positions remain there until closed or settled.
