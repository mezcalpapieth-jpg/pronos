#!/usr/bin/env python3
"""Record pregame public HIP-4 books and score visible MXN execution."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime
from decimal import Decimal, InvalidOperation
import fcntl
from itertools import groupby
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from zoneinfo import ZoneInfo

import requests

from orderbook_report import build_report, iter_slots
from orderbook_scoring import score_orderbook

HERE = Path(__file__).resolve().parent
CONFIG = HERE / "sports_orderbooks_2026-11-10.json"
DATA = HERE / ".local-orderbooks" / "2026-11-10-sports"
INFO = "https://api.hyperliquid.xyz/info"
FX_URL = "https://api.bitso.com/v3/ticker/?book=usd_mxn"
MEXICO_CITY = ZoneInfo("America/Mexico_City")
COARSE_MS = 300_000
NEAR_MS = 60_000
GRACE_MS = 15_000
MAX_FX_AGE_MS = 120_000


def now_ms():
    return time.time_ns() // 1_000_000


def timestamp(value):
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError("Kickoff and ticker timestamps require a timezone")
    return int(dt.timestamp() * 1000)


def display_time(ms, tz=MEXICO_CITY):
    return datetime.fromtimestamp(ms / 1000, tz).isoformat(timespec="seconds")


def read_config(path):
    data = json.loads(path.read_text())
    fee = Decimal(str(data["assumed_taker_fee_bps"]))
    if not fee.is_finite() or not 0 <= fee < 10_000:
        raise ValueError("Expected an assumed taker fee between 0 and 10,000 bps")
    markets = data["markets"]
    if not 3 <= len(markets) <= 5:
        raise ValueError("Select 3–5 sports markets")
    outcomes = set()
    for market in markets:
        coin = market["coin"]
        if not re.fullmatch(r"#[1-9][0-9]*[01]", coin):
            raise ValueError(f"Invalid HIP-4 coin {coin}")
        outcome = int(coin[1:]) // 10
        if outcome in outcomes:
            raise ValueError(f"Multiple sides of outcome {outcome} would double-count liquidity")
        outcomes.add(outcome)
        if not market["label"].strip() or not market["source_url"].startswith("https://"):
            raise ValueError("Market needs a label and an HTTPS fixture source")
        market["kickoff_ms"] = timestamp(market["kickoff"])
    return {"version": 1, "network": "mainnet-public", "markets": markets,
            "assumed_taker_fee_bps": str(fee), "interval_ms": COARSE_MS,
            "near_interval_ms": NEAR_MS, "fx_url": FX_URL}


def public_json(url, *, body=None):
    with requests.Session() as session:
        session.trust_env = False
        response = session.request("GET" if body is None else "POST", url, json=body,
                                   timeout=(4, 6), allow_redirects=False)
    if response.status_code != 200:
        raise ValueError(f"HTTP {response.status_code}")
    return response.json()


def fetch_book(coin):
    return public_json(INFO, body={"type": "l2Book", "coin": coin})


def fetch_fx():
    result = public_json(FX_URL)
    if result.get("success") is not True or result["payload"]["book"] != "usd_mxn":
        raise ValueError("Unexpected Bitso ticker")
    data = result["payload"]
    bid, ask = Decimal(data["bid"]), Decimal(data["ask"])
    if not bid.is_finite() or not ask.is_finite() or not 0 < bid <= ask:
        raise ValueError("Invalid Bitso bid/ask")
    return {"source": "Bitso USD/MXN indicative midpoint",
            "time_ms": timestamp(data["created_at"]), "bid": str(bid),
            "ask": str(ask), "mxn_per_usd": str((bid + ask) / 2)}


def attempt(fetch, *args):
    try:
        value = fetch(*args)
    except (requests.RequestException, KeyError, TypeError, ValueError, InvalidOperation) as exc:
        return None, now_ms(), f"{type(exc).__name__}: {str(exc)[:200]}"
    return value, now_ms(), None


def collect_batch(markets, slot, fee, *, get_book=fetch_book, get_fx=fetch_fx):
    """Fetch one indicative FX quote and timestamp each book's receipt independently."""
    with ThreadPoolExecutor(max_workers=len(markets) + 1) as pool:
        fx_future = pool.submit(attempt, get_fx)
        books = [pool.submit(attempt, get_book, market["coin"]) for market in markets]
        fx, _, fx_error = fx_future.result()
        samples = []
        for market, future in zip(markets, books):
            book, observed, book_error = future.result()
            coin = market["coin"]
            sample = {"coin": coin, "slot_ms": slot, "observed_ms": observed,
                      "book": book, "fx": fx}
            error = None
            if observed > slot + GRACE_MS or observed >= market["kickoff_ms"]:
                status = "late"
            elif book is None:
                status, error = "missing", book_error
            elif not isinstance(book, dict) or book.get("coin") != coin:
                status, error = "invalid", "Unexpected book coin or response"
            elif fx is None or not -GRACE_MS <= observed - fx["time_ms"] <= MAX_FX_AGE_MS:
                status, error = "missing_fx", fx_error or "Stale or out-of-sync Bitso ticker"
            else:
                samples.append({**sample, **score_orderbook(
                    book, mxn_per_usd=fx["mxn_per_usd"], fee_bps=fee, observed_at_ms=observed,
                )})
                continue
            samples.append({**sample, "status": status, "error": error, "passesDepthFloor": False})
    return samples


def initialize(db, config, clock):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS run (id INTEGER PRIMARY KEY CHECK (id = 1),
            config TEXT NOT NULL, start_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS samples (coin TEXT NOT NULL, slot_ms INTEGER NOT NULL,
            payload TEXT NOT NULL, PRIMARY KEY (coin, slot_ms));
    """)
    row = db.execute("SELECT config, start_ms FROM run WHERE id = 1").fetchone()
    if row:
        previous, start = row
        if json.loads(previous) != config:
            raise ValueError("Recorder configuration differs from this run. Choose a new data directory.")
        return start
    if min(m["kickoff_ms"] for m in config["markets"]) <= clock:
        raise ValueError("A fixture has already kicked off. Select upcoming fixtures for a new run.")
    with db:
        db.execute("INSERT INTO run VALUES (1, ?, ?)", (json.dumps(config), clock))
    return clock


def store_samples(db, samples):
    with db:
        db.executemany("INSERT OR IGNORE INTO samples VALUES (?, ?, ?)",
                       [(s["coin"], s["slot_ms"], json.dumps(s, separators=(",", ":"))) for s in samples])


def schedule(config, start):
    for market in config["markets"]:
        kickoff = market["kickoff_ms"]
        for slot in iter_slots(start, kickoff, kickoff, config["interval_ms"], config["near_interval_ms"]):
            yield slot, market["coin"], market


def snapshot_report(db, clock):
    encoded, start = db.execute("SELECT config, start_ms FROM run WHERE id = 1").fetchone()
    config = json.loads(encoded)
    rows = [json.loads(row[0]) for row in db.execute("SELECT payload FROM samples ORDER BY slot_ms, coin")]
    # Within the grace window, a slot enters the denominator only after its own response arrives.
    report = build_report(config["markets"], rows, start_ms=start, end_ms=clock,
                          interval_ms=config["interval_ms"], near_interval_ms=config["near_interval_ms"],
                          grace_ms=GRACE_MS)
    latest = {}
    for row in rows:
        latest[row["coin"]] = {key: value for key, value in row.items() if key != "book"}
    return {**report, "config": config, "startedAtMs": start, "asOfMs": clock, "latest": latest}


def render_markdown(report):
    """Render observations separately from the sustained-depth acceptance gate."""
    def number(value, places=2):
        return "—" if value is None else f"{Decimal(str(value)):,.{places}f}"

    def cell(value):
        return str(value).replace("|", "\\|").replace("\n", " ")

    fee = report["config"]["assumed_taker_fee_bps"]
    lines = ["# Pronos sports order-book observations", "",
             f"As of {display_time(report['asOfMs'])} CDMX. Started {display_time(report['startedAtMs'])}.", "",
             "Public HyperCore mainnet data. All executions below are simulations of displayed liquidity.", "",
             f"Assumed total trading fee: {fee} bps on both sides. This is a scenario, not a verified fee quote. "
             "MXN values use the timestamped Bitso USD/MXN midpoint and assume 1 USDC = 1 USD. "
             "Executable FX spreads, conversion fees and depegs are excluded.", "",
             "Depth target: at least MXN 600 on each side within two probability points of the midpoint "
             "after assumed trading fees, in at least 90% of scheduled observations. "
             "Overall classification needs 20 complete samples. The final-hour gate also requires the entire "
             "hour through kickoff. Missing, late, stale, invalid and one-sided samples count as failures.", "",
             "| Selected outcome | Kickoff CDMX | Latest buy depth MXN | Latest sell depth MXN | Latest sample | Overall qualified / scheduled | Overall gate | Final-hour gate |",
             "|---|---|---:|---:|---|---:|---|---|"]
    for market in report["markets"]:
        latest = report["latest"].get(market["coin"], {})
        depth = latest.get("depthWithinTwoPoints", {})
        overall = market["overall"]
        values = [market["label"], display_time(market["kickoff_ms"]),
                  number(depth.get("buy", {}).get("feeAdjustedNotionalMXN")),
                  number(depth.get("sell", {}).get("feeAdjustedNotionalMXN")),
                  latest.get("status", "pending"),
                  f"{overall['qualifiedSamples']} / {overall['scheduledSamples']}",
                  overall["status"], market["lastHour"]["status"]]
        lines.append("| " + " | ".join(cell(value) for value in values) + " |")
    lines += ["", "## Cash-limited buy simulations", "",
              "Each buy uses the largest whole-share order visible within the stated MXN budget, including "
              "assumed trading fees. Unspent cash is shown. Displayed-depth limits do not imply any liquidity beyond the snapshot. "
              "Samples captured before this optional calculation was added have no row in this table.", "",
              "| Outcome | Budget MXN | Whole shares | Actual spend MXN | Remaining MXN | Buy slippage points | Limited by |",
              "|---|---:|---:|---:|---:|---:|---|"]
    for market in report["markets"]:
        latest = report["latest"].get(market["coin"], {})
        for ticket in latest.get("tickets", []):
            budget = ticket.get("budgetBuy")
            if budget is None:
                continue
            values = [market["label"], budget["requestedBudgetMXN"], budget["wholeShares"],
                      number(budget["actualSpendMXN"]), number(budget["remainingBudgetMXN"]),
                      number(budget["slippagePoints"], 4), budget["limitation"]]
            lines.append("| " + " | ".join(cell(value) for value in values) + " |")
    lines += ["", "## Matched-position buy and sell simulations", "",
              "Ticket labels are midpoint reference amounts rounded down to whole shares. "
              "Buy and sell simulate the same position independently. Actual spend or proceeds appear below "
              "and can differ from the reference amount. A full visible sweep does not guarantee an order fill.", "",
              "| Outcome | Reference MXN | Shares | Buy coverage % | Buy cost MXN | Buy slippage points | Sell coverage % | Sell proceeds MXN | Sell slippage points |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for market in report["markets"]:
        latest = report["latest"].get(market["coin"], {})
        for ticket in latest.get("tickets", []):
            buy, sell = ticket["buy"], ticket["sell"]
            values = [market["label"], ticket["ticketMXN"], ticket["requestedShares"],
                      number(buy["coveragePct"]), number(buy["feeAdjustedNotionalMXN"]),
                      number(buy["slippagePoints"], 4), number(sell["coveragePct"]),
                      number(sell["feeAdjustedNotionalMXN"]), number(sell["slippagePoints"], 4)]
            lines.append("| " + " | ".join(cell(value) for value in values) + " |")
    lines += ["", "## Sampling and coverage", "",
              "Polls every five minutes, then every minute during the final hour before kickoff. "
              "Collection ends at the last selected kickoff. Reports include only pregame slots. "
              "Responses more than 15 seconds late, books at least 15 seconds old and FX over two minutes old "
              "fail qualification. Only the top 20 visible price levels are available. "
              "Computer sleep, network outages and restarts can leave missed slots and reduce the qualifying rate.", ""]
    for market in report["markets"]:
        latest = report["latest"].get(market["coin"], {})
        overall, near = market["overall"], market["lastHour"]
        fx = latest.get("fx") or {}
        lines += [f"### {cell(market['label'])}", "",
                  f"Coin `{market['coin']}`. [Fixture source]({market['source_url']}).",
                  f"Latest receipt: {display_time(latest['observed_ms']) if latest else 'pending'}. "
                  f"FX: {fx.get('mxn_per_usd', 'unavailable')} MXN/USD "
                  f"({display_time(fx['time_ms']) if fx else 'no timestamp'}).",
                  f"Overall statuses: `{json.dumps(overall['counts'], sort_keys=True)}`. "
                  f"Final hour: {near['qualifiedSamples']}/{near['scheduledSamples']} qualified. "
                  f"Provisional reasons: {', '.join(near['provisionalReasons']) or 'none'}.", ""]
        for window_name, window in (("Overall", overall), ("Final hour", near)):
            lines += [f"{window_name} ticket history:", "",
                      "| Reference MXN | Full buy / scheduled % | Buy p95 slippage points | Full sell / scheduled % | Sell p95 slippage points |",
                      "|---:|---:|---:|---:|---:|"]
            for ticket in window["tickets"]:
                values = [ticket["ticketMXN"], number(ticket["buy"]["fullVisibleRatePct"]),
                          number(ticket["buy"]["p95SlippagePoints"], 4),
                          number(ticket["sell"]["fullVisibleRatePct"]),
                          number(ticket["sell"]["p95SlippagePoints"], 4)]
                lines.append("| " + " | ".join(cell(value) for value in values) + " |")
            lines.append("")
    lines += ["Raw snapshots and errors are retained in samples.sqlite3. report.json contains all aggregate fields.", ""]
    return "\n".join(lines)


def write_reports(db, directory, clock):
    report = snapshot_report(db, clock)
    for name, text in (("report.json", json.dumps(report, indent=2) + "\n"),
                       ("report.md", render_markdown(report))):
        temporary = directory / (name + ".tmp")
        temporary.write_text(text)
        temporary.replace(directory / name)
    return report


def collect(config, directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "collector.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("A collector is already running for this data directory") from exc
        (directory / "collector.pid").write_text(f"{os.getpid()}\n")
        with closing(sqlite3.connect(directory / "samples.sqlite3")) as db:
            start = initialize(db, config, now_ms())
            recorded = set(db.execute("SELECT coin, slot_ms FROM samples"))
            print(f"Recording {len(config['markets'])} public books from {display_time(start)} CDMX", flush=True)
            write_reports(db, directory, now_ms())
            slots = sorted(schedule(config, start))
            for slot, group in groupby(slots, key=lambda item: item[0]):
                markets = [market for _, coin, market in group if (coin, slot) not in recorded]
                if not markets or now_ms() > slot + GRACE_MS:
                    continue
                while slot > now_ms():
                    time.sleep(min(60, max(0, (slot - now_ms()) / 1000)))
                if now_ms() > slot + GRACE_MS:
                    continue
                results = collect_batch(markets, slot, config["assumed_taker_fee_bps"])
                store_samples(db, results)
                write_reports(db, directory, now_ms())
                results_text = ", ".join(f"{s['coin']} {s['status']}" for s in results)
                print(f"{display_time(slot)} {results_text}", flush=True)
            # Let the final pregame window elapse so the completed report can classify it.
            last_kickoff = max(m["kickoff_ms"] for m in config["markets"])
            if last_kickoff > now_ms():
                time.sleep(max(0, (last_kickoff - now_ms()) / 1000))
            write_reports(db, directory, now_ms())
            print("Finished all configured pregame windows.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA)
    sub = parser.add_subparsers(dest="command", required=True)
    capture = sub.add_parser("collect", help="Record until the last scheduled kickoff")
    capture.add_argument("--config", type=Path, default=CONFIG)
    report = sub.add_parser("report", help="Compute a current report from the stored snapshots")
    report.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        if args.command == "collect":
            collect(read_config(args.config), args.data_dir)
        else:
            uri = (args.data_dir / "samples.sqlite3").resolve().as_uri() + "?mode=ro"
            with closing(sqlite3.connect(uri, uri=True)) as db:
                current = snapshot_report(db, now_ms())
            print(json.dumps(current, indent=2) if args.json else render_markdown(current), end="\n")
    except (KeyError, OSError, ValueError, InvalidOperation, sqlite3.Error) as exc:
        print(f"Order book recorder: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
