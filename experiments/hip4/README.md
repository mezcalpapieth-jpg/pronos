# Pronos HIP-4 testnet fee probe

This standalone CLI routes one buy and one sell to an existing HyperCore testnet USDC market. It uses the official MIT Hyperliquid Python SDK for signatures and the documented numeric HIP-4 asset IDs. It has no connection to the Pronos Sepolia deployment or web app, and no mainnet endpoint or mode. A Pronos builder code is the address on the order plus the approved rate; no venue deployment or HYPE stake is needed to route.

## Install and fund

```sh
cd experiments/hip4
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python probe.py status
```

Run `probe.py init-wallets` on a new checkout to create a fresh testnet-only pair. It prints only the addresses, writes private keys to a Git-ignored local file with mode `0600`, and never overwrites it. The original pair is available only in the original worktree. Save that file in private storage if you need the same addresses after removing the worktree. Do not reuse mainnet keys or transfer real funds to these addresses.

The current testnet builder is `0x040fe3673b6bded15d949eefccf3509a2284cd04`; the test trader is `0x53454f7449d447067663c3e2bc21b027b277d71c`. On November 10, 2026, the public API reported zero balances and zero fee approval. Ask a funded testnet operator to transfer 110 mock USDC to the builder and 30 mock USDC to the trader, both as HyperCore testnet spot USDC. The extra builder balance is a buffer; a new account may incur activation cost. The [official testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) requires prior mainnet deposit on the same address.

```sh
.venv/bin/python probe.py fund-builder-perps
.venv/bin/python probe.py approve
.venv/bin/python probe.py status
```

The builder needs Standard abstraction and 100 mock USDC in perps account value; `fund-builder-perps` moves 100 from the builder's spot balance. The trader holds USDC in spot and signs the builder fee approval from its main testnet wallet. Confirm `approvedTenthsOfBps` is `250`, meaning 25 bps (`0.25%`).

## Take and reconcile two fills

1. Use `markets` and `book OUTCOME SIDE` to select a live USDC outcome, far from settlement, with independent bids and asks. Choose bounds and an integer size that can cross on both sides for 10–25 mock USDC per leg. These are probe limits; live order minimums may differ. Fresh quotes can still move between observation and execution.
2. Submit a single immediate-or-cancel buy with `order RUN buy OUTCOME SIDE BUY_LIMIT --size SHARES --exit-floor SELL_LIMIT`. Run `audit RUN` until the API returns the order ID and fills. The CLI saves the unsigned intent and client order ID before submission. If the request times out or the result is ambiguous, audit that order ID. Do not submit another buy.
3. Submit `order RUN sell OUTCOME SIDE SELL_LIMIT`. It can only sell the size observed in the confirmed terminal buy and requires an available position. Run `audit RUN` again and keep its JSON output. An IOC can partially fill; `bothSidesCreditedAndFlat: false` means the probe failed its acceptance criteria. Inspect any open balance manually in testnet and use a separate manual cleanup if needed. Keep both probe wallets idle during reconciliation.
4. Confirm the observed `builderFee` for each side and the combined USDC builder reward delta. `totalTraderFeesUSDC` includes the builder fee. The audit keeps actual fill IDs, raw fees, and the difference between expected and collected fees visible. An exchange response alone does not establish fee accrual.

See the [live wallet preflight](pronos-preflight.json). On the initial live check the CLI successfully read testnet accounts, approval, and book depth. No Pronos order or approval was sent while the wallets were unfunded. [Public fee evidence](public-fee-evidence.json) shows independent testnet buy and sell fills with builder fees; those fees did not go to Pronos. See the [call brief](CALL.md) for the commercial decision and what to ask Hyperliquid.

```sh
.venv/bin/python -m unittest discover -s . -p 'test_*.py'
```

[Asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids) · [Builder requirements](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes) · [HIP-4 buy-side fees](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/hip-4-deployer-actions#builder-codes) · [Orders and approvals](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
