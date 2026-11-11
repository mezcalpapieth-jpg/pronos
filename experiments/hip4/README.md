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

## HIP-4, Polymarket and native-market economics — November 10, 2026

Recommendation: develop direct HIP-4 and Polymarket distribution first, measure repeat trading and actual fee credits, then launch selected native CLOB markets where independent makers commit executable depth. Keep the treasury CPMM behind its separate inventory-risk switch. Kalshi is outside this scope. Worm is a later partnership or unique-market option, pending its distribution terms and the extra Solana integration.

This section is an integration assessment and a reproducible sensitivity analysis. It does not activate a Polymarket connector or establish real-money readiness. Pronos builder receipts have not yet been verified on either venue. The funded HIP-4 acceptance test remains pending.

### What is buildable

| Venue | Existing evidence | Work and dependencies |
| --- | --- | --- |
| HIP-4 | Turnkey testnet pilot, bounded order/audit tools and a public sports-book recorder exist on this branch. | Finish funding, approvals, buy/sell, withdrawal and actual builder-credit reconciliation; then obtain the appropriate production arrangements. Buy-side builder fees are documented as best-effort. |
| Polymarket | Public metadata, book and fee endpoints were checked successfully. Current official client supports an Ethers v5 signer adapter compatible with our existing Turnkey signing mechanism. | Build a new venue adapter: the old Pronos Polymarket helpers are disabled. Register the builder profile/code; implement venue-specific authentication, wallet/funding, approvals, quotes, orders and reconciliation. Confirm commercial data/distribution rights and end-user eligibility. |
| Worm | Public API and an official Python SDK exist. Markets can use Worm's own order book or import Polymarket/Hyperliquid. | Adds Solana USDC funding and a Solana signing/account path; the current Pronos implementation signs EVM transactions. Imported books do not establish independent liquidity. No distributor commission for Pronos routing other creators' markets was verified. |

Polymarket's current default for new users is a user-controlled Deposit Wallet, with pUSD collateral. The existing Turnkey owner can remain the signer; no user private-key export is required. The gasless relay has server-only builder credentials. A staging hostname is documented, but a publicly available faucet-funded trading sandbox was not verified. Do not assume the HIP-4 testnet funding procedure works for Polymarket. [Wallets/authentication](https://docs.polymarket.com/trading/wallets-auth), [current TypeScript client](https://docs.polymarket.com/getting-started/typescript), [pUSD](https://docs.polymarket.com/concepts/pusd).

The shared Pronos interface should use venue adapters with explicit capabilities and maintain separate per-user balances and positions for HyperCore USDC, Polygon pUSD and native MXNB. Quotes must disclose venue, exact rules, net spend/proceeds, all fees, FX, minimum size, depth and expiry before signing. Match outcome rules, overtime, cancellation and dispute provisions before comparing prices; a similar title does not make claims interchangeable. Keep orders and claims on their original venue. A future native market offers a new order destination rather than migrating existing positions.

Third-party resolution removes the need for Pronos to resolve those positions. Funding, wallet security, venue outages, customer eligibility, FX guarantees and distribution obligations remain Pronos concerns. Commercial data access needs a partner agreement: review the current [Polymarket Terms](https://polymarket.com/tos), not only whether an endpoint is public. Mexico's absence from a blocked-country list alone does not establish Pronos's local authorization. [Geoblock API](https://docs.polymarket.com/api-reference/geoblock).

### Public Polymarket check and customer fees

At **19:05 CDMX on November 10** (01:05 UTC November 11), about 55 minutes before Heat–Jazz kickoff, the active Heat moneyline book showed a best bid of $0.76 and ask of $0.77, with 54,878.95 shares at the ask: approximately **$42,256.79 displayed ask notional**. Minimum order was five shares, tick $0.01. These observations establish one public integration path and one moment of displayed depth; they do not establish sustained depth or executable fills. Raw responses are retained locally in ignored `.local-orderbooks/polymarket-feasibility-2026-11-10.json`. [Market metadata](https://gamma-api.polymarket.com/markets/6428654), [selected CLOB parameters](https://clob.polymarket.com/clob-markets/0xec8bca230a30557ec12761af6cf5d1bf20a71bb3be7ae91f98179d3f280433c3).

The sampled market reported `fd = {r: 0.05, e: 1, to: true}`. For that sports fee curve:

`venue fee = shares × 0.05 × p × (1 − p)`

| Share price | Venue fee / cash notional | Including a proposed 25 bps Pronos fee |
| --- | ---: | ---: |
| $0.10 | 4.50% | 4.75% |
| $0.50 | 2.50% | 2.75% |
| $0.77, observed ask | 1.15% | 1.40% |
| $0.90 | 0.50% | 0.75% |

The fee is symmetric in dollars for a fixed number of shares, but its percentage of cash notional is not symmetric. Query each market's current parameters; the `base_fee:1000` compatibility response is not a flat 10% price quote. Makers pay no platform fee under the published schedule, though a builder maker fee can apply. Venue fees are paid by customers in the base model; they become a Pronos expense if Pronos subsidizes them. [Platform fees](https://docs.polymarket.com/trading/fees).

Polymarket documents an additive builder fee, configurable up to 100 bps taker / 50 bps maker, with signed `bytes32` attribution and daily prior-UTC-day payouts subject to its minimum and program terms. A 25 bps fee is a proposed configuration, not a verified Pronos entitlement or receipt. [Builder fees](https://docs.polymarket.com/programs/builders/fees).

### Reproduce and change assumptions

```sh
cd experiments/hip4
python3 economics.py --output economics-results-2026-11-10.json
python3 -m unittest test_economics -v
```

Inputs: [economics-assumptions.json](economics-assumptions.json). Model: [economics.py](economics.py). Generated results: [economics-results-2026-11-10.json](economics-results-2026-11-10.json). No wallets, network requests or signing are used by the model.

Volume means **aggregate monthly Pronos-attributed executed cash notional across the portfolio**, counting each customer's buy or sell once. Do not add the counterparty again or count deposits, claims, notional payout value or venue-wide volume. The numbers below are MXN, not USD, and are not per-market launch thresholds.

All operating costs and collection haircuts below are illustrative inputs, not invoices, estimates from Sepolia gas, or measured Pronos conversion rates. This is operating contribution before salaries, acquisition, corporate legal/compliance, taxes, unpriced development and full company overhead; it is not company net profit or a forecast.

| Input | Base scenario |
| --- | --- |
| Routing mix | 50% HIP-4 / 50% Polymarket sports |
| Pronos builder fee | 25 bps on each venue |
| Builder fee collection | 90% HIP-4 / 98% Polymarket; sensitivity assumptions, not observed success rates |
| Effective credited builder revenue | 23.5 bps of filled notional |
| Distribution variable costs | 5 bps |
| Distribution monthly fixed cost | MXN 5,000 |
| Proposed native CLOB | 50 bps fee; 20 bps variable costs including maker incentives; MXN 10,000 monthly fixed cost |
| Base inventory/funding | Users pay venue and funding fees; independent makers fund native CLOB inventory; Pronos supplies no treasury float |
| Initial development | Unpriced, excluded from the base table; enter actual incremental build costs in the inputs |

### Monthly operating contribution

| Filled notional | Direct HIP-4 + Polymarket | Same routing, Pronos absorbs funding | Proposed native CLOB, same filled volume |
| --- | ---: | ---: | ---: |
| MXN 100,000 | −4,815 | −5,648 | −9,700 |
| MXN 1,000,000 | −3,150 | −11,483 | −7,000 |
| MXN 10,000,000 | +13,500 | −69,833 | +20,000 |
| MXN 25,000,000 | +41,250 | −167,083 | +65,000 |

At MXN 1 million, the 25 bps advertised fee is MXN 2,500 gross at perfect collection; the modeled collection haircuts reduce it to MXN 2,350. Subtract MXN 500 variable costs and MXN 5,000 fixed costs to obtain −MXN 3,150. Distribution breaks even at approximately **MXN 2.70 million monthly filled notional** under these assumptions.

For the funding-subsidy column, each funding cycle is MXN 300, conversion costs 50 bps each way plus MXN 2 round trip, and every funded peso produces MXN 2 of aggregate buy-and-sell notional before withdrawal. That costs **83.33 bps of filled notional**, against only 18.5 bps contribution before fixed costs. More volume cannot fix that negative variable margin. Greater reuse lowers the cost per trade; a MXN 100 fully recycled deposit behaves differently from repeated MXN 100 deposits and withdrawals.

Funding subsidies exclude trading fees. The conversion and fixed round-trip inputs also need actual partner quotes, including any Pronos-paid account activation, relay, gas and bridge costs; costs above those inputs further reduce contribution. If Pronos also pays venue fees, the selected 50/50 venue scenario adds another **130 bps** expense: 10 bps HIP-4 scenario, and Polymarket sports at a 50¢ reference with its 250 bps fee. At MXN 1 million, subsidizing venue fees alone changes contribution to **−MXN 16,150**. The HIP-4 rate here is a scenario, not a verified flat venue rate. Its published outcome rules distinguish opening from closing/settlement fees, so quote the actual action rather than copying a generic spot rate. [HIP-4 fee treatment](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees#outcome-tokens).

For MXNB-facing balances backed by Pronos USDC, account for treasury float separately. A float equal to 10% of monthly filled volume, financed at 12% annually, costs MXN 1,000 per month at MXN 1 million volume. If Pronos guarantees MXN value and retains the unhedged exposure, a separate adverse 2% FX event on that MXN 100,000 equivalent float costs another MXN 2,000. This is an event stress, not an expected recurring loss. Capital recovered and user collateral are not revenue.

### What are we giving up by not creating native markets?

The current `clob-cpmm` BinaryCLOB contract has **no platform trading fee**: its fill transfers buyer collateral directly to the seller. The native fee in this model would require implementation. The V1 AMM has a probability-dependent fee; the [V2 multi-outcome AMM](../../contracts/src/PronosAMMMulti.sol) currently charges 200 bps on buys and zero on sells. A 50/50 buy/sell cash-notional mix therefore earns 100 bps blended gross, before losses and costs. Count the platform's fee streams once; a 70/20/10 split does not create extra revenue.

For the proposed 50 bps native CLOB, the gross fee difference versus modeled distribution is **26.5 bps, or MXN 2,650 per MXN 1 million**. That gross difference is not missed profit. After the modeled costs:

- At MXN 1 million monthly volume, native contribution is MXN 3,850 worse. Choosing external distribution avoids that extra modeled loss.
- At MXN 10 million, native contribution is MXN 6,500 better **if all the filled volume is retained**. Retaining 75% produces MXN 12,500 versus external MXN 13,500, so native is MXN 1,000 worse.
- The equal-volume comparison crosses at approximately **MXN 4.35 million/month**, before additional development costs. At MXN 10 million, native must retain at least **78.3%** of external filled volume to match its contribution.
- An extra MXN 100,000 native build cost recovered over six months raises that illustrative equal-volume crossover to approximately **MXN 18.84 million/month**. Replace this example with a real implementation budget.

Independent-maker CLOB markets do not require Pronos to be the inventory provider. A treasury CPMM adds a separate risk. The V2 pool sensitivities below assume all modeled fees accrue to Pronos, variable costs of 20 bps, fixed costs of MXN 12,000, and seed `max(MXN 20,000, 10% of monthly volume)` financed at 12% annually. That seed formula is uncalibrated and does not prove depth. Inventory losses are marked-to-settlement losses **before fee income**, expressed against filled notional; they have no assigned probabilities.

| Native pool filled notional | Inventory loss 25 bps | Inventory loss 100 bps | Inventory loss 200 bps |
| --- | ---: | ---: | ---: |
| MXN 1,000,000 | −7,500 | −15,000 | −25,000 |
| MXN 10,000,000 | +33,000 | −42,000 | −142,000 |

Sepolia rehearsals prove mechanics, not expected real-money returns. The binary hybrid rehearsal filled 7.705 mock MXNB and left ordinary book fills/claims working after the maker switch was disabled. Its chosen winning outcome produced a 4.875 mock MXNB treasury-maker loss on a 100 mock MXNB seed, before gas. That single path is not an estimated loss rate. The shared vault's full backing protects claims; it does not guarantee the treasury's inventory will be profitable.

### Worm and the rollout decision

Worm's documented **50% share of collected trading fees belongs to creators of their own markets**, excluding curated leveraged markets. It is not a verified builder commission on other people's markets. User-created markets start with independent empty books, so free creation does not solve liquidity. The referral program was documented as planned at review time. Do not put Worm distribution revenue into the base case until a commercial agreement and actual credits establish it. [Creator earnings](https://docs.worm.wtf/creating-markets/market-earnings), [market creation](https://docs.worm.wtf/creating-markets/creating-a-market), [referral program](https://docs.worm.wtf/faq/support-community/referral-program), [API](https://docs.worm.wtf/api-reference/introduction), [official SDK](https://github.com/wormwtf/worm-sdk).

Start with direct HIP-4 and Polymarket adapters, spot outcomes only. Expand the same MXN 100/300/1,000 depth simulation using each venue's actual fee curve and minimums. Compare all-in customer execution, not builder revenue alone; the sports fee curve can materially change customer retention. Confirm each venue's actual Pronos builder payout with bounded buys and sells before budgeting revenue.

Use the recorder to select native-market candidates with repeat demand and reliable maker commitments. Forecast incremental filled volume, fee retention, maker incentives, resolution/operations cost and build recovery per cohort. Launch a small independent-maker native CLOB cohort only when conservative incremental contribution is positive. Keep external positions and withdrawal paths working. Enable the treasury CPMM only after its own depth and inventory-loss budget passes, with exposure limits and a kill switch. A single gross-volume milestone does not establish either gate.
