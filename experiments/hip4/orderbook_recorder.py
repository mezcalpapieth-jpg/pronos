#!/usr/bin/env python3
"""Record pregame public HIP-4 and Polymarket books and score visible MXN execution."""
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

from orderbook_report import build_report, iter_slots, pair_listings
from orderbook_scoring import decimal, score_orderbook
from polymarket_orderbook import fetch_polymarket_book

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
    version = data.get("version", 1)
    if version not in (1, 2):
        raise ValueError("Unsupported recorder configuration version")
    fee = decimal(data["assumed_taker_fee_bps"])
    if not 0 <= fee < 10_000:
        raise ValueError("Expected an assumed taker fee between 0 and 10,000 bps")
    markets = data["markets"]
    minimum = 2 if version == 2 else 3
    if not minimum <= len(markets) <= 5:
        raise ValueError(f"Select {minimum}–5 sports markets")
    outcomes = set()
    for market in markets:
        coin = market["coin"]
        venue = market["venue"] if version == 2 else "hip4"
        if venue == "hip4":
            if not re.fullmatch(r"#[1-9][0-9]*[01]", coin):
                raise ValueError(f"Invalid HIP-4 coin {coin}")
            outcome = coin[:-1]
        elif venue == "polymarket":
            outcome = "polymarket:" + market["market_id"]
            index = market["outcome_index"]
            if (not re.fullmatch(r"polymarket:[1-9][0-9]*", outcome)
                    or type(index) is not int or index not in (0, 1)
                    or coin != f"{outcome}:{index}" or not market["outcome_label"].strip()):
                raise ValueError(f"Invalid Polymarket outcome {coin}")
        else:
            raise ValueError(f"Unsupported venue {venue}")
        if (venue, outcome) in outcomes:
            raise ValueError(f"Multiple sides of outcome {outcome} would double-count liquidity")
        outcomes.add((venue, outcome))
        if not market["label"].strip() or not market["source_url"].startswith("https://"):
            raise ValueError("Market needs a label and an HTTPS fixture source")
        market["kickoff_ms"] = timestamp(market["kickoff"])
    settings = {"version": version, "network": "mainnet-public", "markets": markets,
                "assumed_taker_fee_bps": str(fee), "interval_ms": COARSE_MS,
                "near_interval_ms": NEAR_MS, "fx_url": FX_URL}
    if version == 2:
        if not pair_listings(markets):
            raise ValueError("Select at least one cross-venue comparison")
        hip4_builder = decimal(data["hip4_builder_fee_bps"])
        poly_builder = decimal(data["polymarket_builder_fee_bps"])
        if not (0 <= hip4_builder <= fee and 0 <= poly_builder < 10_000):
            raise ValueError("Invalid builder fee scenarios")
        settings.update(hip4_builder_fee_bps=str(hip4_builder), polymarket_builder_fee_bps=str(poly_builder))
    return settings


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


def fetch_poly(market):
    return fetch_polymarket_book(market, get_json=public_json)


def score_sample(sample, fee, settings, *, reference_midpoint=None):
    book, fx = sample["book"], sample["fx"]
    kwargs = {}
    if settings is not None:
        kwargs = {"fx_bid": fx["bid"], "fx_ask": fx["ask"],
                  "builder_fee_bps": settings[f"{sample['venue']}_builder_fee_bps"]}
        if sample["venue"] == "polymarket":
            kwargs.update(curve_fee_rate=book["fee_rate"], min_order_size=book["min_order_size"])
    return score_orderbook(book, mxn_per_usd=fx["mxn_per_usd"], fee_bps=fee,
                           observed_at_ms=sample["observed_ms"], reference_midpoint=reference_midpoint,
                           **kwargs)


def collect_batch(markets, slot, fee, *, settings=None, get_book=fetch_book, get_fx=fetch_fx,
                  get_poly=fetch_poly):
    """Fetch one indicative FX quote and timestamp each book's receipt independently."""
    with ThreadPoolExecutor(max_workers=len(markets) + 1) as pool:
        fx_future = pool.submit(attempt, get_fx)
        books = [pool.submit(attempt, get_poly, market) if market.get("venue") == "polymarket"
                 else pool.submit(attempt, get_book, market["coin"]) for market in markets]
        fx, _, fx_error = fx_future.result()
        samples = []
        for market, future in zip(markets, books):
            book, observed, book_error = future.result()
            coin = market["coin"]
            sample = {"coin": coin, "slot_ms": slot, "observed_ms": observed,
                      "book": book, "fx": fx}
            if settings is not None:
                sample["venue"] = market["venue"]
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
                try:
                    score = score_sample(sample, fee, settings)
                except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
                    status, error = "invalid", str(exc)
                else:
                    if "market_metadata" in book:
                        sample["marketMetadata"] = book["market_metadata"]
                    samples.append({**sample, **score})
                    continue
            samples.append({**sample, "status": status, "error": error, "passesDepthFloor": False})
    if settings is not None:
        by_coin = {sample["coin"]: sample for sample in samples}
        for group in pair_listings(settings["markets"]).values():
            pair = [by_coin.get(market["coin"]) for market in group]
            if all(sample and sample["status"] == "complete" for sample in pair):
                reference = sum(Decimal(sample["midpoint"]) for sample in pair) / len(pair)
                for sample in pair:
                    score = score_sample(sample, fee, settings, reference_midpoint=reference)
                    sample["pairedTickets"] = score["tickets"]
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

    config = report["config"]
    fee = config["assumed_taker_fee_bps"]
    mixed = config["version"] == 2
    if mixed:
        methodology = (
            f"Public HyperCore and Polymarket mainnet books. HIP-4 uses a {fee} bps total scenario, "
            f"including {config['hip4_builder_fee_bps']} bps for Pronos. Polymarket uses each CLOB market's published "
            f"price-dependent venue fee and a {config['polymarket_builder_fee_bps']} bps Pronos scenario. "
            "Buy costs use Bitso's indicative USD/MXN ask and sell proceeds use the bid. Depth uses the midpoint. "
            "Each USD-denominated collateral unit is treated as 1 USD. Estimates exclude bridge, funding, "
            "withdrawal and per-fill fee rounding. Pronos fees are gross modeled revenue."
        )
    else:
        methodology = (
            f"Public HyperCore mainnet books with an assumed {fee} bps total trading fee on each side. "
            "MXN values use the timestamped Bitso USD/MXN midpoint and assume 1 USDC = 1 USD. "
            "Executable FX spreads, conversion fees and depegs are excluded."
        )
    lines = ["# Pronos sports order-book observations", "",
             f"As of {display_time(report['asOfMs'])} CDMX. Started {display_time(report['startedAtMs'])}.", "",
             methodology, "",
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
                      number(budget["slippagePoints"], 4),
                      budget["limitation"] if budget["status"] == "quoted" else budget["status"]]
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
    for comparison in report.get("comparisons", []):
        lines += ["", f"## {cell(comparison['group'])} cross-venue comparison", "",
                  "Both books use the same whole-share quantity at the average of their two midpoints. "
                  "Each venue carries its own resolution and cancellation terms.", ""]
        latest_pair = comparison["latestPair"]
        if latest_pair:
            lines += [f"Latest paired slot at {display_time(latest_pair['slotMs'])} CDMX.", "",
                      "| Venue | Reference MXN | Shares | Buy cost MXN | Sell proceeds MXN | Venue fees buy / sell MXN | Pronos fees buy / sell MXN | Buy / sell status |",
                      "|---|---:|---:|---:|---:|---:|---:|---|"]
            for venue, listing in latest_pair["listings"].items():
                for ticket in listing["tickets"]:
                    buy, sell = ticket["buy"], ticket["sell"]
                    values = [venue, ticket["ticketMXN"], ticket["requestedShares"],
                              number(buy["feeAdjustedNotionalMXN"]), number(sell["feeAdjustedNotionalMXN"]),
                              " / ".join(number(quote["venueFeeMXN"], 4) for quote in (buy, sell)),
                              " / ".join(number(quote["builderFeeMXN"], 4) for quote in (buy, sell)),
                              f"{buy['status']} / {sell['status']}"]
                    lines.append("| " + " | ".join(cell(value) for value in values) + " |")
            lines.append("")
        for name, window in (("Overall", comparison["overall"]), ("Final hour", comparison["lastHour"])):
            coverage = "" if window.get("windowCovered", True) else " The final hour is still provisional."
            lines += [f"{name} paired observations {window['pairedSamples']}/{window['scheduledSamples']}.{coverage}", "",
                      "| Reference MXN | Full buy HIP-4 / Polymarket / both % | Full sell HIP-4 / Polymarket / both % |",
                      "|---:|---:|---:|"]
            for ticket in window["tickets"]:
                rates = [" / ".join(number(ticket[side][venue]) for venue in ("hip4", "polymarket", "both"))
                         for side in ("buy", "sell")]
                lines.append(f"| {ticket['ticketMXN']} | {' | '.join(rates)} |")
            lines.append("")
    lines += ["", "## Sampling and coverage", "",
              "Polls every five minutes, then every minute during the final hour before kickoff. "
              "Collection ends at the last selected kickoff. Reports include only pregame slots. "
              "Responses more than 15 seconds late, books at least 15 seconds old and FX over two minutes old "
              "fail qualification. Simulations use the levels returned by each venue's public book. "
              "Computer sleep, network outages and restarts can leave missed slots and reduce the qualifying rate.", ""]
    for market in report["markets"]:
        latest = report["latest"].get(market["coin"], {})
        overall, near = market["overall"], market["lastHour"]
        fx = latest.get("fx") or {}
        metadata = latest.get("marketMetadata", {})
        cancellation = metadata.get("cancellation_deadline") or market.get("cancellation_deadline")
        lines += [f"### {cell(market['label'])}", "",
                  f"Listing `{market['coin']}`. [Fixture source]({market['source_url']}).",
                  f"Latest receipt: {display_time(latest['observed_ms']) if latest else 'pending'}. "
                  f"FX: {fx.get('mxn_per_usd', 'unavailable')} MXN/USD "
                  f"({display_time(fx['time_ms']) if fx else 'no timestamp'}).",
                  f"Overall statuses: `{json.dumps(overall['counts'], sort_keys=True)}`. "
                  f"Final hour: {near['qualifiedSamples']}/{near['scheduledSamples']} qualified. "
                  f"Provisional reasons: {', '.join(near['provisionalReasons']) or 'none'}.", ""]
        if cancellation:
            lines += [f"Venue no-result deadline {cell(cancellation)}.", ""]
        if latest.get("error"):
            error = cell(latest["error"]).replace("`", "")
            lines += [f"Latest capture error `{error}`.", ""]
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
                results = collect_batch(markets, slot, config["assumed_taker_fee_bps"],
                                        settings=config if config["version"] == 2 else None)
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
