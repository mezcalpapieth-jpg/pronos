#!/usr/bin/env python3
"""Single-round-trip, testnet-only HIP-4 builder fee probe."""
import argparse
import json
import os
import re
import secrets
import stat
import sys
import time
from decimal import Decimal, InvalidOperation
from pathlib import Path

import requests
from eth_account import Account
from hyperliquid.utils.signing import (
    sign_approve_builder_fee, sign_l1_action, sign_spot_transfer_action, sign_usd_class_transfer_action,
)

API = "https://api.hyperliquid-testnet.xyz"
MAINNET_INFO = "https://api.hyperliquid.xyz/info"
HYPEREVM_RPC = "https://rpc.hyperliquid-testnet.xyz/evm"
HYPEREVM_CHAIN = 998
HYPEREVM_USDC = "0x2b3370ee501b4a559b57d449569354196457d8ab"
CORE_DEPOSIT_WALLET = "0x0b80659a4076e9e93c7dbe0f10675a16a3e5c206"
WITHDRAW_TOPIC = "0x884edad9ce6fa2440d8a54cc123490eb96d2768479d49ff9c7366125a9424364"
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
USDC_UNIT = Decimal(1_000_000)
LOCAL = Path(__file__).resolve().parent / ".local-testnet"
WALLETS = LOCAL / "wallets.json"
FEE = 250  # 0.25%; units are tenths of a basis point.
MIN_NOTIONAL = Decimal(10)  # Conservative probe floor, not a claim about venue minimum.
MAX_NOTIONAL = Decimal(25)
MAX_EMBEDDED_FUNDING = Decimal(30)
SPONSOR_HEADROOM = Decimal(1)
FEE_TOLERANCE = Decimal("0.000001")
MAX_BOOK_AGE_MS = 15_000
TERMINAL = ("filled", "iocCancel", "canceled")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def dec(value):
    d = Decimal(str(value))
    require(d.is_finite(), "Non-finite amount")
    return d


def wire(value):
    return format(value.normalize(), "f")


def now():
    return time.time_ns() // 1_000_000


def address(value):
    require(re.fullmatch(r"0x[0-9a-fA-F]{40}", value), "Invalid wallet address")
    return value.lower()


def post(url, payload):
    # Pin network and disallow proxy/environment overrides and redirects.
    with requests.Session() as session:
        session.trust_env = False
        result = session.post(url, json=payload, timeout=12, allow_redirects=False)
    require(result.status_code == 200, f"{url} returned HTTP {result.status_code}")
    return result.json()


def info(kind, *, mainnet=False, **fields):
    return post(MAINNET_INFO if mainnet else API + "/info", {"type": kind, **fields})


def exchange(action, signature, nonce, expires=None):
    return post(API + "/exchange", {"action": action, "signature": signature,
                                  "nonce": nonce, "vaultAddress": None, "expiresAfter": expires})


def asset(outcome, side):
    require(outcome >= 0 and side in (0, 1), "Expected a nonnegative outcome and side 0 or 1")
    encoding = 10 * outcome + side
    return 100_000_000 + encoding, f"#{encoding}", f"+{encoding}"


def market(outcome, *, mainnet=False):
    return next((m for m in info("outcomeMeta", mainnet=mainnet)["outcomes"] if m["outcome"] == outcome), None)


def wallet_info(user, token):
    balances = info("spotClearinghouseState", user=user)["balances"]
    for b in balances:
        if b["coin"] == token:
            return dec(b["total"]) - dec(b["hold"])
    return Decimal(0)


def builder_state(builder):
    abstraction = info("userAbstraction", user=builder)
    value = info("clearinghouseState", user=builder)["marginSummary"]["accountValue"]
    return {"abstraction": abstraction, "perpsUSDCAccountValue": value}


def eligible(state):
    # API returns 'default' for Standard; 'disabled' is the SDK's Standard action value.
    return state["abstraction"] in ("default", "disabled") and dec(state["perpsUSDCAccountValue"]) >= 100


def rewards(builder):
    referral = info("referral", user=builder)
    return {"builderRewards": referral["builderRewards"],
            "unclaimedRewards": referral["unclaimedRewards"],
            "tokenToState": referral["tokenToState"]}


def approved(trader, builder):
    return int(info("maxBuilderFee", user=trader, builder=builder))


def save_new(path, data):
    # Exclusive create blocks reusing the same order slot after any ambiguous result.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(data, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def init_wallets():
    LOCAL.mkdir(mode=0o700, exist_ok=True)
    wallets = {role: Account.create() for role in ("builder", "trader")}
    save_new(WALLETS, {role: w.key.hex() for role, w in wallets.items()})
    return {role: w.address.lower() for role, w in wallets.items()}


def accounts():
    mode = WALLETS.lstat().st_mode
    require(stat.S_ISREG(mode) and not mode & 0o077, "Wallet file must be regular and private (0600)")
    keys = json.loads(WALLETS.read_text())
    trader = Account.from_key(keys["trader"])
    builder = Account.from_key(keys["builder"])
    require(builder.address.lower() != trader.address.lower(), "Trader and builder must be distinct")
    return trader, builder


def transfer_parties(source, destination):
    source, destination = address(source), address(destination)
    require(source != destination and all(int(a, 16) for a in (source, destination)),
            "Spot transfer requires distinct nonzero addresses")
    return source, destination


def usdc_token():
    matches = [t["tokenId"] for t in info("spotMeta")["tokens"] if t["name"] == "USDC"]
    require(len(matches) == 1 and re.fullmatch(r"0x[0-9a-fA-F]{32}", matches[0]),
            "Expected one USDC token ID in testnet spot metadata")
    return f"USDC:{matches[0]}"


def fund_embedded(run, sponsor, trader, amount, key_file):
    sponsor, trader = transfer_parties(sponsor, trader)
    require(0 < amount <= MAX_EMBEDDED_FUNDING and amount.normalize().as_tuple().exponent >= -6,
            "Use a positive amount up to 30 mock USDC and at most six decimal places")
    folder = run_dir(run)
    journal = folder / "embedded-funding.json"
    require(not journal.exists(), "Funding slot used; audit the existing transfer")
    mode = key_file.lstat().st_mode
    require(stat.S_ISREG(mode) and not mode & 0o077, "Sponsor key file must be regular and private (0600)")
    wallet = Account.from_key(key_file.read_text().strip())
    require(address(wallet.address) == sponsor, "Key does not match the explicit sponsor address")
    sponsor_before = wallet_info(sponsor, "USDC")
    require(sponsor_before >= amount + SPONSOR_HEADROOM, "Sponsor needs the amount plus 1 mock USDC headroom")
    trader_before = wallet_info(trader, "USDC")
    token = usdc_token()
    nonce = now()
    action = {"type": "spotSend", "destination": trader, "token": token, "amount": wire(amount), "time": nonce}
    record = {"network": "Testnet", "source": sponsor, "destination": trader, "nonce": nonce,
              "sourceFreeBeforeUSDC": wire(sponsor_before), "destinationFreeBeforeUSDC": wire(trader_before),
              "action": action}
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    save_new(journal, record)
    response = exchange(action, sign_spot_transfer_action(wallet, action, False), nonce)
    save_new(folder / "embedded-funding-response.json", response)
    return {**record, "response": response}


def audit_transfer(source, destination, start_time, transfer_hash=None, expected_amount=None):
    source, destination = transfer_parties(source, destination)
    require(start_time > 0, "Use a positive Unix timestamp in milliseconds")
    require(expected_amount is None or expected_amount > 0, "Expected transfer amount must be positive")
    if transfer_hash is not None:
        require(re.fullmatch(r"0x[0-9a-fA-F]{64}", transfer_hash), "Invalid transfer hash")
        transfer_hash = transfer_hash.lower()
    token = usdc_token().lower()
    ledgers = []
    for user in (source, destination):
        records = {}
        for entry in info("userNonFundingLedgerUpdates", user=user, startTime=start_time):
            delta = entry["delta"]
            tx = entry["hash"].lower()
            if (delta["type"] == "spotTransfer" and entry["time"] >= start_time
                    and re.fullmatch(r"0x[0-9a-f]{64}", tx) and int(tx, 16)
                    and (transfer_hash is None or tx == transfer_hash)
                    and delta["token"].lower() in ("usdc", token)
                    and delta["user"].lower() == source and delta["destination"].lower() == destination):
                amount = dec(delta["amount"])
                if amount > 0 and (expected_amount is None or expected_amount == amount):
                    records[(tx, entry["time"], amount)] = entry
        ledgers.append(records)
    sent, received = ledgers
    matched = sorted(sent.keys() & received.keys(), key=lambda item: (item[1], item[0]))
    return {"network": "Testnet", "source": source, "destination": destination, "startTimeMs": start_time,
            "sourceFreeSpotUSDC": wire(wallet_info(source, "USDC")),
            "destinationFreeSpotUSDC": wire(wallet_info(destination, "USDC")),
            "confirmedTransfers": [{"hash": key[0], "timeMs": key[1], "amountUSDC": wire(key[2]),
                                    "sourceLedger": sent[key], "destinationLedger": received[key]}
                                   for key in matched]}


def evm_rpc(method, *params):
    response = post(HYPEREVM_RPC, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    require("result" in response, f"HyperEVM RPC {method} failed: {response.get('error')}")
    return response["result"]


def evm_usdc_balance(owner, block):
    data = "0x70a08231" + owner[2:].rjust(64, "0")
    return int(evm_rpc("eth_call", {"to": HYPEREVM_USDC, "data": data}, block), 16)


def withdrawal_state(trader):
    trader = address(trader)
    require(int(trader, 16), "Withdrawal audit requires a nonzero address")
    require(int(evm_rpc("eth_chainId"), 16) == HYPEREVM_CHAIN, "Expected HyperEVM testnet chain 998")
    block = evm_rpc("eth_blockNumber")
    return {"network": "Testnet", "chainId": HYPEREVM_CHAIN, "trader": trader, "usdcToken": HYPEREVM_USDC,
            "block": int(block, 16), "evmUSDCUnits": evm_usdc_balance(trader, block),
            "coreFreeUSDC": wire(wallet_info(trader, "USDC"))}


def audit_withdrawal(trader, amount, baseline, tx_hash=None, from_block=None):
    trader = address(trader)
    units = amount * USDC_UNIT
    require(units > 0 and units == units.to_integral_value(), "Use a positive amount with up to six decimal places")
    require(baseline["network"] == "Testnet" and baseline["chainId"] == HYPEREVM_CHAIN
            and baseline["trader"] == trader and baseline["usdcToken"] == HYPEREVM_USDC,
            "Expected a withdrawal baseline for this wallet on HyperEVM testnet")
    if tx_hash is not None:
        require(re.fullmatch(r"0x[0-9a-fA-F]{64}", tx_hash), "Invalid HyperEVM transaction hash")
        tx_hash = tx_hash.lower()
    start = baseline["block"] + 1 if from_block is None else from_block
    require(start > baseline["block"], "Log search must start after the baseline block")
    after = withdrawal_state(trader)
    recipient = "0x" + trader[2:].rjust(64, "0")
    sender = "0x" + CORE_DEPOSIT_WALLET[2:].rjust(64, "0")
    if tx_hash:
        receipt = evm_rpc("eth_getTransactionReceipt", tx_hash)
        logs = receipt["logs"] if receipt and receipt["status"] == "0x1" else []
    else:
        require(after["block"] - start < 500, "Pass the HyperEVM receipt hash or narrow --from-block to 500 blocks")
        logs = []
        for first in range(start, after["block"] + 1, 50):
            logs.extend(evm_rpc("eth_getLogs", {
                "address": [CORE_DEPOSIT_WALLET, HYPEREVM_USDC],
                "topics": [[WITHDRAW_TOPIC, TRANSFER_TOPIC], [recipient, sender]],
                "fromBlock": hex(first), "toBlock": hex(min(first + 49, after["block"])),
            }))

    withdrawals, transfers = {}, {}
    for log in logs:
        block = int(log["blockNumber"], 16)
        tx = log["transactionHash"].lower()
        if log.get("removed") or not start <= block <= after["block"] or (tx_hash and tx != tx_hash):
            continue
        key = block, tx
        contract, topics = log["address"].lower(), [t.lower() for t in log["topics"]]
        if (contract == CORE_DEPOSIT_WALLET and topics == [WITHDRAW_TOPIC, recipient]
                and int(log["data"], 16) == units):
            withdrawals[key] = log
        if (contract == HYPEREVM_USDC and topics == [TRANSFER_TOPIC, sender, recipient]
                and int(log["data"], 16) == units):
            transfers[key] = log
    credits = [{"block": block, "hash": tx, "bridgeWithdraw": withdrawals[(block, tx)],
                "usdcTransfer": transfers[(block, tx)]} for block, tx in sorted(withdrawals.keys() & transfers.keys())]
    credit = Decimal(after["evmUSDCUnits"] - baseline["evmUSDCUnits"]) / USDC_UNIT
    debit = dec(baseline["coreFreeUSDC"]) - dec(after["coreFreeUSDC"])
    return {"baseline": baseline, "after": after, "expectedUSDC": wire(amount), "evmCreditUSDC": wire(credit),
            "coreSpotDebitUSDC": wire(debit), "fromBlock": start, "matchingCredits": credits,
            "withdrawalConfirmed": len(credits) == 1 and credit == amount and debit >= amount}


def status(trader, builder):
    return {"network": "Testnet", "trader": trader,
            "traderSpotUSDC": wire(wallet_info(trader, "USDC")),
            "builderSpotUSDC": wire(wallet_info(builder, "USDC")),
            "builder": {"address": builder, **builder_state(builder), "rewards": rewards(builder)},
            "approvedTenthsOfBps": approved(trader, builder)}


def order_wire(outcome, side, direction, size, limit, builder, cloid):
    require(direction in ("buy", "sell"), "Order side must be buy or sell")
    require(0 < limit < 1 and len(limit.normalize().as_tuple().digits) <= 5
            and limit.normalize().as_tuple().exponent >= -5, "Use a 0–1 price with up to 5 significant digits and 5 decimal places")
    require(size > 0 and size == size.to_integral_value(), "Use a positive integer number of shares")
    require(MIN_NOTIONAL <= size * limit <= MAX_NOTIONAL, "Limit-price notional must be 10–25 mock USDC")
    numeric, _, _ = asset(outcome, side)
    return {"type": "order", "orders": [{"a": numeric, "b": direction == "buy", "p": wire(limit),
                                          "s": wire(size), "r": False, "t": {"limit": {"tif": "Ioc"}},
                                          "c": cloid}], "grouping": "na", "builder": {"b": builder, "f": FEE}}


def crossing_size(book, direction, limit):
    if not book:
        return Decimal(0)
    buy = direction == "buy"
    levels = book["levels"][1 if buy else 0]
    return sum((dec(l["sz"]) for l in levels if
                (dec(l["px"]) <= limit if buy else dec(l["px"]) >= limit)), Decimal(0))


def order_fills(record):
    order_status = info("orderStatus", user=record["trader"], oid=record["cloid"])
    if order_status.get("status") != "order":
        return {"orderStatus": order_status.get("status", "unknown"), "fills": []}
    detail = order_status["order"]
    order = detail["order"]
    require(order["coin"] == record["coin"], "Order status returned an unexpected outcome")
    if order.get("cloid") is not None:
        require(order["cloid"].lower() == record["cloid"].lower(), "Order status returned an unexpected client ID")
    oid = order["oid"]
    found = info("userFillsByTime", user=record["trader"], startTime=max(1, record["nonce"] - 1000),
                 aggregateByTime=False)
    fills = [f for f in found if f["oid"] == oid]
    direction = "B" if record["direction"] == "buy" else "A"
    require(order.get("side", direction) == direction, "Order status returned an unexpected direction")
    require(all(f["coin"] == record["coin"] and f["side"] == direction for f in fills),
            "Unexpected direction or outcome in fills")
    require(len({f["tid"] for f in fills}) == len(fills), "Duplicate fill IDs")
    return {"orderStatus": detail["status"], "order": order, "statusTimestamp": detail.get("statusTimestamp"),
            "oid": oid, "fills": fills}


def summarize(fills):
    require(all(f["feeToken"] == "USDC" for f in fills), "Unexpected fee currency; inspect raw fills")
    amount = sum((dec(f["sz"]) for f in fills), Decimal(0))
    notional = sum((dec(f["sz"]) * dec(f["px"]) for f in fills), Decimal(0))
    total = sum((dec(f["fee"]) for f in fills), Decimal(0))
    builder = sum((dec(f.get("builderFee", "0")) for f in fills), Decimal(0))
    matches_rate = bool(fills) and all(
        "builderFee" in f and dec(f["builderFee"]) > 0
        and abs(dec(f["builderFee"]) - dec(f["sz"]) * dec(f["px"]) * FEE / 100_000) <= FEE_TOLERANCE
        for f in fills
    )
    return {"filledShares": wire(amount), "notionalUSDC": wire(notional), "totalTraderFeesUSDC": wire(total),
            "builderFeesOnFillsUSDC": wire(builder), "nonBuilderFeesUSDC": wire(total - builder),
            "expectedBuilderFeeUSDC": wire(notional * FEE / 100_000),
            "effectiveBuilderBps": wire(builder * 10_000 / notional) if notional else None,
            "fillsWithoutBuilderFeeField": sum("builderFee" not in f for f in fills),
            "builderFeeMatches25Bps": matches_rate}


def run_dir(run):
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", run), "Invalid run label")
    return LOCAL / run


def check_depth(book, direction, limit, size):
    require(book and abs(now() - book["time"]) < MAX_BOOK_AGE_MS, "No fresh order book")
    require(crossing_size(book, direction, limit) >= size, "Live book lacks enough depth inside the limit")


def visible_execution(levels, fee_multiplier, requested_shares=None):
    shares = notional = Decimal(0)
    last_price = None
    for price, available in levels:
        amount = available if requested_shares is None else min(available, requested_shares - shares)
        if not amount:
            break
        shares += amount
        notional += price * amount
        last_price = price
    return {
        "visibleShares": wire(shares),
        "grossQuote": wire(notional),
        "quoteAfterAssumedFees": wire(notional * fee_multiplier),
        "vwap": wire(notional / shares) if shares else None,
        "worstPrice": wire(last_price) if last_price is not None else None,
    }


def liquidity_snapshot(book, sizes, fee_bps, reference, observed_at):
    """Estimate taker execution from visible L2 only, without sending an order."""
    require(all(size > 0 for size in sizes), "Share sizes must be positive")
    require(0 <= fee_bps < 10_000, "Assumed fee must be between 0 and 10,000 bps")
    require(reference is None or 0 < reference < 1, "Reference price must be between 0 and 1")
    age = observed_at - book["time"] if book else None
    report = {"observedAtMs": observed_at, "bookTimeMs": book["time"] if book else None,
              "bookAgeMs": age, "assumedTakerFeeBps": wire(fee_bps)}
    if age is None or abs(age) >= MAX_BOOK_AGE_MS:
        return {**report, "status": "unavailable" if age is None else "stale"}

    bids, asks = [[(dec(level["px"]), dec(level["sz"])) for level in side] for side in book["levels"]]
    require(all(0 < p < 1 and s > 0 for p, s in bids + asks), "Invalid outcome book level")
    bids.sort(key=lambda level: level[0], reverse=True)
    asks.sort(key=lambda level: level[0])
    best_bid = bids[0][0] if bids else None
    best_ask = asks[0][0] if asks else None
    two_sided = best_bid is not None and best_ask is not None
    if two_sided and best_bid >= best_ask:
        return {**report, "status": "locked_or_crossed", "bestBid": wire(best_bid), "bestAsk": wire(best_ask)}
    midpoint = (best_bid + best_ask) / 2 if two_sided else None
    ref = reference if reference is not None else midpoint
    sides = {}
    for direction, levels, sign in (("buy", asks, 1), ("sell", bids, -1)):
        multiplier = 1 + sign * fee_bps / 10_000
        bands = {}
        if ref is not None:
            for points in (2, 5):
                width = Decimal(points) / 100
                in_band = [(p, s) for p, s in levels if sign * (p * multiplier - ref) <= width]
                bands[str(points)] = visible_execution(in_band, multiplier)
        quotes = []
        for size in sizes:
            quote = visible_execution(levels, multiplier, size)
            shares = dec(quote["visibleShares"])
            cost_vs_ref = sign * (dec(quote["vwap"]) * multiplier - ref) * 100 if shares and ref is not None else None
            quotes.append({"requestedShares": size, "coveragePct": wire(shares * 100 / size), **quote,
                           "costVsReferencePoints": wire(cost_vs_ref) if cost_vs_ref is not None else None})
        sides[direction] = {"levelsSeen": len(levels), "depthWithinPoints": bands, "sizeEstimates": quotes}
    return {**report, "status": "two_sided" if two_sided else "one_sided" if bids or asks else "empty",
            "bestBid": wire(best_bid) if best_bid is not None else None,
            "bestAsk": wire(best_ask) if best_ask is not None else None,
            "spreadPoints": wire((best_ask - best_bid) * 100) if two_sided else None,
            "referencePrice": wire(ref) if ref is not None else None,
            "referenceSource": "supplied" if reference is not None else "book_midpoint" if two_sided else None,
            **sides}


def submit(run, direction, outcome, side, limit, size, exit_floor):
    trader_wallet, builder_wallet = accounts()
    trader, builder = trader_wallet.address.lower(), builder_wallet.address.lower()
    folder = run_dir(run)
    journal = folder / f"{direction}.json"
    require(not journal.exists(), "Order slot used; audit it before taking any further action")
    _, coin, token = asset(outcome, side)
    require(eligible(builder_state(builder)), "Builder requires Standard mode and ≥100 mock USDC perps account value")
    require(approved(trader, builder) >= FEE, "Trader has not approved a 25 bps builder fee")
    m = market(outcome)
    require(m and m.get("quoteToken") == "USDC", "Outcome must be listed and quoted in USDC")
    if direction == "buy":
        require(size is not None and exit_floor is not None, "Buy requires --size and --exit-floor")
        require(exit_floor <= limit, "Exit floor must not exceed the buy limit")
        order_wire(outcome, side, "sell", size, exit_floor, builder, "unused")
        require(wallet_info(trader, token) == 0, "Use a trader with zero existing shares for this probe")
        require(wallet_info(trader, "USDC") >= size * limit * Decimal("1.01"),
                "Trader lacks free spot mock USDC plus fee headroom")
    else:
        require(size is None and exit_floor is None, "Sell size is derived from confirmed buy fills")
        purchase = json.loads((folder / "buy.json").read_text())
        require((purchase["trader"], purchase["builder"], purchase["coin"]) == (trader, builder, coin),
                "Sell must use the same trader, builder and asset as the buy")
        require(limit >= dec(purchase["preflightExitFloor"]), "Sell limit is below the original exit floor")
        buy = order_fills(purchase)
        require(buy["orderStatus"] in TERMINAL, "Buy is not confirmed terminal")
        size = dec(summarize(buy["fills"])["filledShares"])
        require(size > 0 and wallet_info(trader, token) >= size, "No confirmed buy shares available to sell")
    cloid = "0x" + secrets.token_hex(16)
    action = order_wire(outcome, side, direction, size, limit, builder, cloid)
    book = info("l2Book", coin=coin)
    check_depth(book, direction, limit, size)
    if direction == "buy":
        check_depth(book, "sell", exit_floor, size)
    before = rewards(builder)
    nonce = now()
    expiry = nonce + 15_000
    folder.mkdir(mode=0o700, exist_ok=True)
    save_new(journal, {"network": "Testnet", "trader": trader, "builder": builder, "coin": coin,
                       "direction": direction, "nonce": nonce, "cloid": cloid, "action": action,
                       "preflightExitFloor": wire(exit_floor) if exit_floor is not None else None,
                       "rewardsBefore": before, "bookTime": book["time"]})
    response = exchange(action, sign_l1_action(trader_wallet, action, None, nonce, expiry, False), nonce, expiry)
    save_new(folder / f"{direction}-response.json", response)
    return {"cloid": cloid, "response": response}


def reward_deltas(before, after):
    deltas = {}
    for key in ("builderRewards", "unclaimedRewards"):
        old, new = (dict(v["tokenToState"]).get(0, {}).get(key, v[key]) for v in (before, after))
        deltas[key] = wire(dec(new) - dec(old))
    return deltas


def audit_order(trader, builder, cloid, outcome, side, direction, start_time, baseline):
    trader, builder = transfer_parties(trader, builder)
    require(re.fullmatch(r"0x[0-9a-fA-F]{32}", cloid), "Invalid 16-byte client order ID")
    require(start_time > 0, "Use a positive Unix timestamp in milliseconds")
    _, coin, _ = asset(outcome, side)
    details = order_fills({"trader": trader, "cloid": cloid.lower(), "nonce": start_time,
                           "coin": coin, "direction": direction})
    summary = summarize(details["fills"])
    order = details.get("order", {})
    report = {"network": "Testnet", "trader": trader, "builder": builder, "coin": coin, "cloid": cloid.lower(),
              "isIoc": order.get("tif", "").lower() == "ioc" if order.get("tif") else None,
              "fillTxHashes": sorted({f["hash"] for f in details["fills"]}),
              "currentApprovedTenthsOfBps": approved(trader, builder), **details, **summary}
    if baseline is not None:
        require(baseline["network"] == "Testnet" and address(baseline["builder"]) == builder,
                "Reward baseline must be a testnet snapshot for this builder")
        require(not order or baseline["observedAtMs"] <= order["timestamp"],
                "Reward baseline must precede the order")
        after = rewards(builder)
        delta = reward_deltas(baseline["rewards"], after)
        report.update(rewardsBefore=baseline["rewards"], rewardsAfter=after, builderRewardDeltasUSDC=delta,
                      builderCreditMatches25BpsFill=summary["builderFeeMatches25Bps"]
                      and abs(dec(delta["builderRewards"]) - dec(summary["builderFeesOnFillsUSDC"])) <= FEE_TOLERANCE)
    return report


def audit(run):
    folder = run_dir(run)
    buy = json.loads((folder / "buy.json").read_text())
    details = {}
    for direction in ("buy", "sell"):
        journal = folder / f"{direction}.json"
        if journal.exists():
            evidence = order_fills(json.loads(journal.read_text()))
            details[direction] = {**evidence, **summarize(evidence["fills"])}
    observed = sum((dec(d["builderFeesOnFillsUSDC"]) for d in details.values()), Decimal(0))
    after = rewards(buy["builder"])
    deltas = reward_deltas(buy["rewardsBefore"], after)
    verified = (set(details) == {"buy", "sell"} and
                all(d["builderFeeMatches25Bps"] and d["orderStatus"] in TERMINAL for d in details.values()) and
                details["buy"]["filledShares"] == details["sell"]["filledShares"] and
                abs(dec(deltas["builderRewards"]) - observed) <= FEE_TOLERANCE)
    return {"network": "Testnet", "trader": buy["trader"], "builder": buy["builder"],
            "coin": buy["coin"], "orders": details, "rewardsBefore": buy["rewardsBefore"],
            "rewardsAfter": after, "builderRewardDeltasUSDC": deltas,
            "bothSidesCreditedAndFlat": verified}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    cmd = parser.add_subparsers(dest="cmd", required=True)
    cmd.add_parser("init-wallets")
    cmd.add_parser("status")
    cmd.add_parser("approve")
    cmd.add_parser("fund-builder-perps")
    cmd.add_parser("markets")
    book = cmd.add_parser("book")
    liquidity = cmd.add_parser("liquidity", help="Estimate visible depth and execution without trading")
    for command in (book, liquidity):
        command.add_argument("outcome", type=int)
        command.add_argument("side", type=int)
    liquidity.add_argument("--shares", nargs="+", type=int, required=True)
    liquidity.add_argument("--fee-bps", type=dec, default=Decimal(0))
    liquidity.add_argument("--reference-price", type=dec)
    liquidity.add_argument("--mainnet", action="store_true", help="Read public mainnet metadata and book only")
    order = cmd.add_parser("order")
    order.add_argument("run")
    order.add_argument("direction", choices=("buy", "sell"))
    order.add_argument("outcome", type=int)
    order.add_argument("side", type=int)
    order.add_argument("limit", type=dec)
    order.add_argument("--size", type=dec)
    order.add_argument("--exit-floor", type=dec)
    report = cmd.add_parser("audit")
    report.add_argument("run")
    fund = cmd.add_parser("fund-embedded", help="Send mock spot USDC from an operator sponsor to an embedded wallet")
    fund.add_argument("run")
    fund.add_argument("--sponsor", required=True)
    fund.add_argument("--trader", required=True)
    fund.add_argument("--amount", type=dec, required=True)
    fund.add_argument("--sponsor-key-file", type=Path, required=True)
    transfer = cmd.add_parser("audit-transfer", help="Reconcile a testnet spot transfer using both ledgers")
    transfer.add_argument("--source", required=True)
    transfer.add_argument("--destination", required=True)
    transfer.add_argument("--start-time", type=int, required=True)
    transfer.add_argument("--hash")
    transfer.add_argument("--amount", type=dec)
    withdrawal_base = cmd.add_parser("withdrawal-baseline", help="Read same-address Core and HyperEVM testnet balances")
    withdrawal_base.add_argument("--trader", required=True)
    withdrawal = cmd.add_parser("audit-withdrawal", help="Reconcile a testnet Core-to-HyperEVM USDC credit")
    withdrawal.add_argument("--trader", required=True)
    withdrawal.add_argument("--amount", type=dec, required=True)
    withdrawal.add_argument("--baseline", type=Path, required=True)
    withdrawal.add_argument("--hash", help="HyperEVM transaction hash")
    withdrawal.add_argument("--from-block", type=int)
    snapshot = cmd.add_parser("builder-rewards", help="Read the testnet builder reward baseline")
    snapshot.add_argument("--builder", required=True)
    external_order = cmd.add_parser("audit-order", help="Reconcile a testnet order placed by the embedded wallet")
    external_order.add_argument("--trader", required=True)
    external_order.add_argument("--builder", required=True)
    external_order.add_argument("--cloid", required=True)
    external_order.add_argument("--outcome", type=int, required=True)
    external_order.add_argument("--side", type=int, required=True)
    external_order.add_argument("--direction", choices=("buy", "sell"), required=True)
    external_order.add_argument("--start-time", type=int, required=True)
    external_order.add_argument("--rewards-before", type=Path)
    args = parser.parse_args()
    if args.cmd == "init-wallets":
        result = init_wallets()
    elif args.cmd == "markets":
        meta = info("outcomeMeta")
        result = {"network": "Testnet", "outcomes": meta["outcomes"], "questions": len(meta["questions"])}
    elif args.cmd == "book":
        _, coin, _ = asset(args.outcome, args.side)
        result = {"network": "Testnet", "market": market(args.outcome), "book": info("l2Book", coin=coin)}
    elif args.cmd == "liquidity":
        _, coin, _ = asset(args.outcome, args.side)
        m = market(args.outcome, mainnet=args.mainnet)
        require(m and m.get("quoteToken") == "USDC", "Outcome must be listed and quoted in USDC")
        book = info("l2Book", mainnet=args.mainnet, coin=coin)
        result = {"network": "Mainnet" if args.mainnet else "Testnet", "coin": coin, "market": m,
                  **liquidity_snapshot(book, args.shares, args.fee_bps, args.reference_price, now())}
    elif args.cmd == "order":
        result = submit(args.run, args.direction, args.outcome, args.side, args.limit, args.size, args.exit_floor)
    elif args.cmd == "audit":
        result = audit(args.run)
    elif args.cmd == "fund-embedded":
        result = fund_embedded(args.run, args.sponsor, args.trader, args.amount, args.sponsor_key_file)
    elif args.cmd == "audit-transfer":
        result = audit_transfer(args.source, args.destination, args.start_time, args.hash, args.amount)
    elif args.cmd == "withdrawal-baseline":
        result = withdrawal_state(args.trader)
    elif args.cmd == "audit-withdrawal":
        result = audit_withdrawal(args.trader, args.amount, json.loads(args.baseline.read_text()),
                                  args.hash, args.from_block)
    elif args.cmd == "builder-rewards":
        builder = address(args.builder)
        snapshot = rewards(builder)
        result = {"network": "Testnet", "builder": builder, "observedAtMs": now(), "rewards": snapshot}
    elif args.cmd == "audit-order":
        baseline = json.loads(args.rewards_before.read_text()) if args.rewards_before else None
        result = audit_order(args.trader, args.builder, args.cloid, args.outcome, args.side, args.direction,
                             args.start_time, baseline)
    else:
        trader, builder_wallet = accounts()
        trader_address, builder = address(trader.address), address(builder_wallet.address)
        if args.cmd == "status":
            result = status(trader_address, builder)
        elif args.cmd == "fund-builder-perps":
            state = builder_state(builder)
            require(state["abstraction"] in ("default", "disabled"), "Builder must use Standard mode")
            if eligible(state):
                result = {"alreadyEligible": True, **state}
            else:
                require(wallet_info(builder, "USDC") >= 100, "Fund the builder with 100 mock USDC in spot first")
                nonce = now()
                action = {"type": "usdClassTransfer", "amount": "100", "toPerp": True, "nonce": nonce}
                result = exchange(action, sign_usd_class_transfer_action(builder_wallet, action, False), nonce)
        elif approved(trader_address, builder) >= FEE:
            result = {"alreadyApproved": True, "builder": builder, "trader": trader_address}
        else:
            require(eligible(builder_state(builder)), "Fund the Standard-mode builder with 100 mock USDC in perps first")
            require(wallet_info(trader_address, "USDC") >= MIN_NOTIONAL, "Fund the trader's spot testnet account first")
            nonce = now()
            action = {"maxFeeRate": "0.25%", "builder": builder, "nonce": nonce, "type": "approveBuilderFee"}
            result = exchange(action, sign_approve_builder_fee(trader, action, False), nonce)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, InvalidOperation, OSError, requests.RequestException, KeyError) as exc:
        print(f"Probe stopped: {exc}", file=sys.stderr)
        sys.exit(1)
