# Pronos HIP-4 testnet fee probe

This standalone CLI measures HIP-4 book depth and can route one buy and one sell to an existing HyperCore testnet USDC market. It uses the official MIT Hyperliquid Python SDK for signatures and the documented numeric HIP-4 asset IDs. The liquidity report can read public mainnet books. All signed actions use HyperCore testnet. The embedded-wallet pilot runs on the separate HIP-4 branch. A Pronos builder code is the address on the order plus the approved rate; no venue deployment or HYPE stake is needed to route.

## Install and fund

```sh
cd experiments/hip4
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python probe.py status
```

Run `probe.py init-wallets` on a new checkout to create a fresh testnet-only pair. It prints only the addresses, writes private keys to a Git-ignored local file with mode `0600`, and never overwrites it. The original pair is available only in the original worktree. Save that file in private storage if you need the same addresses after removing the worktree. Do not reuse mainnet keys or transfer real funds to these addresses.

The current testnet builder is `0x040fe3673b6bded15d949eefccf3509a2284cd04`; the test trader is `0x53454f7449d447067663c3e2bc21b027b277d71c`. On November 10, 2026, the public API reported zero balances and zero fee approval. Use a funded HyperCore testnet operator to transfer 110 mock spot USDC to the builder and 30 to the trader. For the browser pilot, use the Turnkey address displayed in the app as the trader. A fresh recipient adds a one-time 1 test USDC activation fee to the sender’s cost. The [official testnet faucet](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/testnet-faucet) requires prior mainnet deposit on the same address.

```sh
.venv/bin/python probe.py fund-builder-perps
.venv/bin/python probe.py approve
.venv/bin/python probe.py status
```

The builder needs Standard abstraction and 100 mock USDC in perps account value; `fund-builder-perps` moves 100 from the builder's spot balance. The trader holds USDC in spot and signs the builder fee approval from its main testnet wallet. Confirm `approvedTenthsOfBps` is `250`, meaning 25 bps (`0.25%`).

## Run the Turnkey pilot

Set `VITE_HIP4_TESTNET_ENABLED=true` on the HIP-4 build and open `/mvp/hip4`. Sign in with the existing Pronos email OTP using a dedicated test account. The page reads HyperCore testnet balances for that user's embedded wallet. The original CLI trader uses a separate key and cannot stand in for the embedded-wallet test.

After a sponsor funds the wallet, refresh and choose **Autorizar trading**. The browser asks Turnkey to sign the named 30-minute agent approval and then the 25 bps builder approval. It keeps the agent key in page memory and submits USDC binary-outcome orders as immediate-or-cancel with a client order ID. Reloading generates a replacement agent at the next authorization. Use a fresh two-sided book and sell only the confirmed fill size from the buy.

The withdrawal asks Turnkey to sign a `sendAsset` from HyperCore spot to the USDC system address. It returns native test USDC to the same embedded wallet on HyperEVM testnet. Record the nonce and confirm destination credit separately from the exchange acknowledgement. [Circle's HyperEVM withdrawal guide](https://developers.circle.com/cctp/howtos/withdraw-usdc-from-hypercore-to-hyperevm)

## Fund and audit a Turnkey wallet

Use the embedded EOA displayed by the pilot and a separate operator-controlled, funded HyperCore testnet spot sponsor. Supply a private regular file containing only the sponsor's testnet private key. The operator must retain at least 1 mock USDC of preflight headroom and may send up to 30 mock USDC per run. The CLI journals the unsigned intent before submission. If a result is ambiguous, look up the transfer before taking another action.

```sh
.venv/bin/python probe.py fund-embedded RUN --sponsor "$SPONSOR" --trader "$TRADER" \
  --amount 30 --sponsor-key-file "$SPONSOR_KEY_FILE"
.venv/bin/python probe.py audit-transfer --source "$SPONSOR" --destination "$TRADER" \
  --start-time "$FUNDING_NONCE_MS" --amount 30
```

The nonce is in the funding output and in `.local-testnet/RUN/embedded-funding.json`. The audit lists transfers with the same hash, time and amount in both HyperCore spot ledgers and shows the current free USDC balances. Pass `--hash` to reconcile a known transfer. This command is for transfers between HyperCore spot wallets.

Before each browser order, save a baseline for the designated builder. Keep that builder idle apart from the order under test until the audit reconciles.

```sh
.venv/bin/python probe.py builder-rewards --builder "$BUILDER" > "$BASELINE_FILE"
# Submit the browser order and record the client order ID and submission time.
.venv/bin/python probe.py audit-order --trader "$TRADER" --builder "$BUILDER" --cloid "$CLOID" \
  --outcome "$OUTCOME" --side "$SIDE" --direction buy --start-time "$ORDER_NONCE_MS" \
  --rewards-before "$BASELINE_FILE"
```

Check the raw order time-in-force, terminal status and actual filled shares, plus the fill hashes and `builderFeeMatches25Bps`. `builderCreditMatches25BpsFill` compares the observed fees with the builder's USDC reward delta in that isolated window. It is available when you provide the pre-order baseline. Take a fresh snapshot before testing the sell. The command also reports the current approval as a separate observation. [Core spot transfers](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint#core-spot-transfer) · [Order status by client ID](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#query-order-status-by-oid-or-cloid)

### Reconcile the HyperEVM withdrawal

After the sell, save a new balance baseline before submitting the browser withdrawal. The Circle route credits native USDC to the same embedded address on HyperEVM testnet. Keep this address idle during reconciliation. [Circle withdrawal guide](https://developers.circle.com/cctp/howtos/withdraw-usdc-from-hypercore-to-hyperevm)

```sh
.venv/bin/python probe.py withdrawal-baseline --trader "$TRADER" > "$WITHDRAWAL_BASELINE"
# Submit the testnet withdrawal in the browser, then look for its confirmed credit.
.venv/bin/python probe.py audit-withdrawal --trader "$TRADER" --amount "$AMOUNT" \
  --baseline "$WITHDRAWAL_BASELINE"
```

The audit checks chain 998 and the Circle USDC contract at `0x2B3370eE501B4a559b57D449569354196457D8Ab`. Confirmation requires a Core spot debit of at least the requested amount, an exact increase in the EVM balance, and one matching pair of `Withdraw` and ERC-20 `Transfer` events in the same EVM transaction. For a known HyperEVM hash, pass `--hash` to use its receipt. The log search is bounded to 500 blocks after the baseline by default. For an older baseline with a known event window, pass `--from-block` within 500 blocks of the latest block. [Circle bridge contract](https://github.com/circlefin/hyperevm-circle-contracts/blob/master/src/CoreDepositWallet.sol) · [HyperEVM RPC limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm/json-rpc)

## Screen retail depth without wallets

```sh
.venv/bin/python probe.py liquidity 26594 1 --shares 10 15 30 --fee-bps 25
.venv/bin/python probe.py liquidity 27955 0 --mainnet --shares 17 42 165 --fee-bps 25
```

The outcome IDs are examples from November 10. Use `markets` for current testnet IDs and the public mainnet `outcomeMeta` response for current mainnet IDs. Convert intended retail amounts to comparable whole-share clips using the observed reference and a timestamped FX quote. Pass `--reference-price` for an independent reference when available. The report otherwise uses the two-sided book midpoint.

The report walks the visible levels for each size and records coverage, average and worst prices, spread, and depth within two and five probability points. `--fee-bps` models a flat **total taker fee** for the estimate. Use a separately confirmed fee for each scenario. The default is zero, and FX, venue minimums and changes before submission are outside this estimate. Stale, missing and one-sided observations should count separately in the pilot. Record repeated samples and eventual order results. HyperCore exposes up to 20 levels per side, and the two tokens of the same binary outcome share a merged book. [Order-book endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot) · [Merged outcome book](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-4-outcome-markets#mechanics)

## Record sports books continuously without signing

`orderbook_recorder.py` imports no wallet, signing or exchange code. It reads public **mainnet** books, since testnet depth cannot establish retail execution quality. It needs only Python 3.9+ and `requests`. The dated configuration selects five distinct sports events and includes official fixture sources. Confirm the selected outcome's full rules and kickoff before starting a new run. Soccer selections are individual home-win Yes tokens, with a draw counting as No.

```sh
cd experiments/hip4
.venv/bin/python orderbook_recorder.py collect --config sports_orderbooks_2026-11-10.json
```

The foreground command records through the last configured kickoff. For a local detached process, keep the computer awake and retain this worktree. Run the following from the same directory, with an existing virtual environment:

```sh
mkdir -p .local-orderbooks/2026-11-10-sports
nohup .venv/bin/python -u orderbook_recorder.py collect \
  > .local-orderbooks/2026-11-10-sports/collector.log 2>&1 < /dev/null &
sleep 2
cat .local-orderbooks/2026-11-10-sports/collector.pid
.venv/bin/python orderbook_recorder.py report
```

The collector writes its actual PID after acquiring a single-process lock. To stop it, send SIGTERM to that PID. Restart the same command and directory to resume the original schedule. Configuration changes require a new `--data-dir`; previously captured observations are immutable. The CLI accepts this global option before `collect` or `report`. This is a local process, with no automatic startup after reboot or recovery after a process crash. A temporary worktree is not permanent storage. Preserve its ignored data directory before deleting it.

Each run stores raw books, receipt times, timestamped FX quotes, failures and scores in `samples.sqlite3`. `report.md` and `report.json` refresh after each batch and at the final kickoff. `report` recomputes the denominator at the current time, including missed slots. Add `--json` after `report` for structured output. No balance or private-key file is read. No transaction is submitted.

Sampling is every five minutes, increasing to every minute for each event's last pregame hour. The depth target is **MXN 600 per side within two probability points of the midpoint after assumed trading fees**, qualified in **at least 90% of all scheduled observations**. A classification needs 20 complete samples. The last-hour gate also requires recording from an hour before kickoff through kickoff. Starting later always leaves that gate provisional. These are pilot screening thresholds, not proof of profitable operation.

Missing, stale, one-sided, crossed, invalid and late samples reduce the qualifying rate. Captures have a 15-second grace period. Book timestamps at least 15 seconds away from receipt fail freshness. This conservative rule can reject an unchanged book. Bitso ticker times must be no more than two minutes old or 15 seconds in the future. Computer sleep and downtime are inferred from the frozen schedule and counted as missing. HTTP errors are retained as failures, rather than empty successful books.

The configured **35 bps total fee** is an explicit scenario, not a verified HIP-4 charge. MXN conversion uses the indicative public [Bitso USD/MXN ticker](https://api.bitso.com/v3/ticker/?book=usd_mxn), assuming 1 USDC = 1 USD. It excludes executable conversion spreads and fees. Books expose at most 20 price levels per side. Partial displayed coverage is retained, and simulated sweeps never establish actual fills or fee credits. [Book endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint#l2-book-snapshot)

Cash-limited buys find the largest whole-share quantity whose displayed cost, including assumed fees, fits MXN 100, 300 or 1,000. They report unspent cash and whether budget or displayed depth limits the quantity. The separate matched-position comparison values a whole-share position at the midpoint and independently sweeps buys and sells of that same position. The report shows actual fee-adjusted spend/proceeds because those can differ from its reference labels. Slippage is measured in **probability percentage points**, not relative price percentages. Aggregate full-visible rates and percentiles refer to these matched-position comparisons. Full-visible rates include all scheduled observations, while slippage percentiles include only complete visible sweeps. A fee scenario is frozen per run so reports never mix different assumptions.

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
