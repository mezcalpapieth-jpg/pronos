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
    sign_approve_builder_fee, sign_l1_action, sign_usd_class_transfer_action,
)

API = "https://api.hyperliquid-testnet.xyz"
LOCAL = Path(__file__).resolve().parent / ".local-testnet"
WALLETS = LOCAL / "wallets.json"
FEE = 250  # 0.25%; units are tenths of a basis point.
MIN_NOTIONAL = Decimal(10)  # Conservative probe floor, not a claim about venue minimum.
MAX_NOTIONAL = Decimal(25)
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


def post(path, payload):
    # Pin network and disallow proxy/environment overrides and redirects.
    with requests.Session() as session:
        session.trust_env = False
        result = session.post(API + path, json=payload, timeout=12, allow_redirects=False)
    require(result.status_code == 200, f"Testnet {path} returned HTTP {result.status_code}")
    return result.json()


def info(kind, **fields):
    return post("/info", {"type": kind, **fields})


def exchange(action, signature, nonce, expires=None):
    return post("/exchange", {"action": action, "signature": signature,
                             "nonce": nonce, "vaultAddress": None, "expiresAfter": expires})


def asset(outcome, side):
    require(outcome >= 0 and side in (0, 1), "Expected a nonnegative outcome and side 0 or 1")
    encoding = 10 * outcome + side
    return 100_000_000 + encoding, f"#{encoding}", f"+{encoding}"


def market(outcome):
    return next((m for m in info("outcomeMeta")["outcomes"] if m["outcome"] == outcome), None)


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
        require(order["cloid"] == record["cloid"], "Order status returned an unexpected client ID")
    oid = order["oid"]
    found = info("userFillsByTime", user=record["trader"], startTime=record["nonce"] - 1000,
                 aggregateByTime=False)
    fills = [f for f in found if f["oid"] == oid]
    direction = "B" if record["direction"] == "buy" else "A"
    require(all(f["coin"] == record["coin"] and f["side"] == direction for f in fills),
            "Unexpected direction or outcome in fills")
    require(len({f["tid"] for f in fills}) == len(fills), "Duplicate fill IDs")
    return {"orderStatus": detail["status"], "oid": oid, "fills": fills}


def summarize(fills):
    require(all(f["feeToken"] == "USDC" for f in fills), "Unexpected fee currency; inspect raw fills")
    amount = sum((dec(f["sz"]) for f in fills), Decimal(0))
    notional = sum((dec(f["sz"]) * dec(f["px"]) for f in fills), Decimal(0))
    total = sum((dec(f["fee"]) for f in fills), Decimal(0))
    builder = sum((dec(f.get("builderFee", "0")) for f in fills), Decimal(0))
    return {"filledShares": wire(amount), "notionalUSDC": wire(notional), "totalTraderFeesUSDC": wire(total),
            "builderFeesOnFillsUSDC": wire(builder), "nonBuilderFeesUSDC": wire(total - builder),
            "expectedBuilderFeeUSDC": wire(notional * FEE / 100_000),
            "effectiveBuilderBps": wire(builder * 10_000 / notional) if notional else None,
            "fillsWithoutBuilderFeeField": sum("builderFee" not in f for f in fills)}


def run_dir(run):
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", run), "Invalid run label")
    return LOCAL / run


def check_depth(book, direction, limit, size):
    require(book and abs(now() - book["time"]) < 15_000, "No fresh order book")
    require(crossing_size(book, direction, limit) >= size, "Live book lacks enough depth inside the limit")


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
                all(dec(d["builderFeesOnFillsUSDC"]) > 0 and d["orderStatus"] in TERMINAL for d in details.values()) and
                details["buy"]["filledShares"] == details["sell"]["filledShares"] and
                abs(dec(deltas["builderRewards"]) - observed) <= Decimal("0.000001"))
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
    book.add_argument("outcome", type=int)
    book.add_argument("side", type=int)
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
    args = parser.parse_args()
    if args.cmd == "init-wallets":
        result = init_wallets()
    elif args.cmd == "markets":
        meta = info("outcomeMeta")
        result = {"network": "Testnet", "outcomes": meta["outcomes"], "questions": len(meta["questions"])}
    elif args.cmd == "book":
        _, coin, _ = asset(args.outcome, args.side)
        result = {"network": "Testnet", "market": market(args.outcome), "book": info("l2Book", coin=coin)}
    elif args.cmd == "order":
        result = submit(args.run, args.direction, args.outcome, args.side, args.limit, args.size, args.exit_floor)
    elif args.cmd == "audit":
        result = audit(args.run)
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
