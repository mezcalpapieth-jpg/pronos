#!/usr/bin/env python3
"""Replay a Pronos MXN checkout against the recorder's public book snapshots."""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, DecimalException, localcontext
import json
from pathlib import Path
import sqlite3
import sys
import time

from orderbook_report import HOUR_MS, SIDES, iter_slots
from orderbook_scoring import Fees, TICKETS_MXN, decimal, score_orderbook, wire


RATES_BPS = (0, 50, 100)
CAP_BPS = 500
CAPTURE_GRACE_MS = 15_000
MAX_FX_AGE_MS = 120_000


def score_capture(market, sample, slot, base_fee_bps, builder_bps):
    if sample is None:
        return {"status": "missing"}
    if sample["status"] != "complete":
        return {"status": sample["status"]}
    try:
        observed, book, fx = sample["observed_ms"], sample["book"], sample["fx"]
        if observed > slot + CAPTURE_GRACE_MS or observed >= market["kickoff_ms"]:
            return {"status": "late"}
        if book["coin"] != market["coin"]:
            return {"status": "invalid"}
        if fx is None or not -CAPTURE_GRACE_MS <= observed - fx["time_ms"] <= MAX_FX_AGE_MS:
            return {"status": "missing_fx"}
        poly = market.get("venue", "hip4") == "polymarket"
        # Sweep even below the venue minimum so cap and depth checks have the
        # same priority as checkout. Apply the actual minimum to the result.
        result = score_orderbook(
            book, mxn_per_usd=fx["mxn_per_usd"], fx_bid=fx["bid"], fx_ask=fx["ask"],
            observed_at_ms=observed, fee_bps=base_fee_bps + builder_bps, builder_fee_bps=builder_bps,
            curve_fee_rate=book["fee_rate"] if poly else None,
        )
        if result["status"] == "complete":
            fees = Fees(Decimal(result["venueFeeRate"]), Decimal(builder_bps) / 10_000, result["venueFeeCurve"])
            last_ask = max(decimal(level["px"]) for level in book["levels"][1])
            result["lastUnitCostMXN"] = fees.adjusted_price(last_ask, 1) * decimal(fx["ask"])
            result["venueMinimum"] = decimal(book["min_order_size"]) if poly else Decimal(1)
            if result["venueMinimum"] <= 0:
                return {"status": "invalid"}
        return result
    except (KeyError, TypeError, ValueError, DecimalException):
        return {"status": "invalid"}


def quote_result(ticket, side, fx, *, last_unit_cost, minimum):
    quote = ticket["budgetBuy"] if side == "buy" else ticket["sell"]
    gross = Decimal(quote["grossNotionalMXN"])
    builder = Decimal(quote["builderFeeMXN"])
    fee = Decimal(quote["venueFeeMXN"]) + builder
    if fee * 10_000 > gross * CAP_BPS:
        return "fee_cap", Decimal(0), Decimal(0)
    # Use the last displayed ask, including any fractional levels beyond the
    # filled whole shares. This is the same exhaustion check as MXN checkout.
    buy_depth_limited = (side == "buy" and quote["limitation"] == "displayed_depth"
                         and Decimal(quote["remainingBudgetMXN"]) >= last_unit_cost)
    if buy_depth_limited or quote["status"] in ("partial", "unfilled"):
        return "insufficient_depth", Decimal(0), Decimal(0)
    if quote["status"] == "below_one_share":
        return "below_one_share", Decimal(0), Decimal(0)
    if Decimal(quote["visibleShares"]) < minimum:
        return "below_venue_minimum", Decimal(0), Decimal(0)
    # Value builder accrual and gross notional at the observed midpoint for
    # reporting. The customer quote still uses the corresponding FX bid/ask.
    rate = decimal(fx["ask" if side == "buy" else "bid"])
    midpoint_fx = decimal(fx["mxn_per_usd"])
    return "pass", gross / rate * midpoint_fx, builder / rate * midpoint_fx


def replay(config, samples, *, start_ms, as_of_ms, final_hour=False):
    """Use one simulated order per scheduled slot, rate, side, and ticket."""
    base_fee = decimal(config["assumed_taker_fee_bps"]) - decimal(config.get("hip4_builder_fee_bps", 0))
    markets = config["markets"]
    venues = sorted({market.get("venue", "hip4") for market in markets})
    counts = defaultdict(Counter)
    gross = defaultdict(Decimal)
    revenue = defaultdict(Decimal)
    listings = []
    with localcontext() as context:
        context.prec = 60
        for market in markets:
            venue = market.get("venue", "hip4")
            coin = market["coin"]
            kickoff = market["kickoff_ms"]
            first = max(start_ms, kickoff - HOUR_MS) if final_hour else start_ms
            capture_statuses = Counter()
            for slot in iter_slots(first, as_of_ms, kickoff, config["interval_ms"], config["near_interval_ms"]):
                sample = samples.get((coin, slot))
                if sample is None and as_of_ms < slot + CAPTURE_GRACE_MS:
                    continue
                if sample and sample["observed_ms"] > as_of_ms:
                    if as_of_ms < slot + CAPTURE_GRACE_MS:
                        continue
                    sample = None
                capture_statuses[sample["status"] if sample else "missing"] += 1
                for rate in RATES_BPS:
                    result = score_capture(market, sample, slot, base_fee, rate)
                    tickets = {row["ticketMXN"]: row for row in result.get("tickets", ())}
                    for amount in TICKETS_MXN:
                        for side in SIDES:
                            key = (venue, rate, side, amount)
                            status = result["status"]
                            if status == "complete":
                                status, notional, builder = quote_result(
                                    tickets[amount], side, sample["fx"],
                                    last_unit_cost=result["lastUnitCostMXN"], minimum=result["venueMinimum"],
                                )
                                gross[key] += notional
                                revenue[key] += builder
                            counts[key][status] += 1
            listings.append({"venue": venue, "coin": coin, "label": market["label"], "kickoffMs": kickoff,
                             "captureStatuses": dict(capture_statuses),
                             "finalHourCovered": start_ms <= kickoff - HOUR_MS and as_of_ms >= kickoff})

        rows = []
        for venue in venues:
            for rate in RATES_BPS:
                for side in SIDES:
                    for amount in TICKETS_MXN:
                        key = (venue, rate, side, amount)
                        status_counts = counts[key]
                        rows.append({"venue": venue, "builderBps": rate, "side": side, "ticketMXN": amount,
                                     "scheduled": sum(status_counts.values()), "passed": status_counts["pass"],
                                     "statusCounts": dict(status_counts), "passedGrossNotionalMXN": wire(gross[key]),
                                     "modeledBuilderFeesMXN": wire(revenue[key])})
    return {"startedAtMs": start_ms, "asOfMs": as_of_ms, "window": "final_hour" if final_hour else "overall",
            "tradingFeeCapBps": CAP_BPS, "hip4BaseFeeScenarioBps": wire(base_fee),
            "listings": listings, "rows": rows}


def load_recording(path):
    uri = path.resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute("BEGIN")
        run = db.execute("SELECT config, start_ms FROM run WHERE id = 1").fetchone()
        if run is None:
            raise ValueError("Recorder database has no configured run")
        config, start = json.loads(run[0]), run[1]
        samples = {(coin, slot): json.loads(payload)
                   for coin, slot, payload in db.execute("SELECT coin, slot_ms, payload FROM samples")}
        return config, samples, start


def render_markdown(report):
    timestamp = datetime.fromtimestamp(report["asOfMs"] / 1000, timezone.utc).isoformat(timespec="seconds")
    lines = ["# Pronos MXN checkout replay", "",
             f"Cutoff {timestamp} (`{report['asOfMs']}` Unix ms). Window {report['window']}.", "",
             "One hypothetical order per scheduled snapshot, ticket, side and rate. The 5% ceiling applies to combined "
             "venue and builder trading fees divided by swept gross notional. Buys use an all-in MXN budget and whole "
             "shares. Sells size whole shares at the venue midpoint and require a full sweep. Customer amounts use "
             "the recorded indicative FX ask for buys and bid for sells.", "",
             f"HIP-4 uses a {report['hip4BaseFeeScenarioBps']} bps base venue-fee scenario on both sides. Polymarket uses "
             "the recorded taker curve. Fee estimates omit settlement fees and per-fill rounding. Gross modeled builder "
             "fees use midpoint FX and count only passing quotes. The model assumes customers pay their own trading and "
             "funding costs. Gross fees exclude operating costs and do not represent credits, forecasts, or net profit.", "",
             "| Listing | Capture counts | Final-hour window covered |",
             "|---|---|---|"]
    for listing in report["listings"]:
        capture = ", ".join(f"{status} {count}" for status, count in sorted(listing["captureStatuses"].items()))
        covered = "yes" if listing["finalHourCovered"] else "pending or incomplete"
        label = listing["label"].replace("|", "\\|")
        lines.append(f"| {label} | {capture or 'none'} | {covered} |")

    def cell(rows):
        passed = sum(row["passed"] for row in rows)
        scheduled = sum(row["scheduled"] for row in rows)
        revenue = sum(Decimal(row["modeledBuilderFeesMXN"]) for row in rows)
        return f"{passed}/{scheduled} · {revenue:,.2f}"

    grouped = defaultdict(list)
    for row in report["rows"]:
        grouped[row["venue"], row["builderBps"]].append(row)

    headings = [f"{row['ticketMXN']:,} {row['side']}" for row in next(iter(grouped.values()), [])]
    headings = ["Venue", "Builder bps", *headings, "Total", "Fee cap fails", "Other fails"]
    lines += ["", "Each ticket cell shows quotes passed / scheduled and modeled builder fees in MXN.", "",
              "| " + " | ".join(headings) + " |", "|" + "---|" * len(headings)]
    for (venue, bps), rows in grouped.items():
        counts = Counter()
        for row in rows:
            counts.update(row["statusCounts"])
        failures = ", ".join(f"{status} {count}" for status, count in sorted(counts.items())
                             if status not in ("pass", "fee_cap")) or "—"
        values = [venue, str(bps), *(cell([row]) for row in rows), cell(rows), str(counts["fee_cap"]), failures]
        lines.append("| " + " | ".join(values) + " |")

    lines += ["", "| Builder bps | Combined venue tests and modeled fees MXN |", "|---:|---:|"]
    by_rate = defaultdict(list)
    for row in report["rows"]:
        by_rate[row["builderBps"]].append(row)
    for bps, rows in sorted(by_rate.items()):
        lines.append(f"| {bps} | {cell(rows)} |")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("db", type=Path, help="The recorder's samples.sqlite3 file")
    parser.add_argument("--as-of-ms", type=int, help="Optional UTC Unix-millisecond cutoff for reproducibility")
    parser.add_argument("--final-hour", action="store_true", help="Limit each listing to its final hour before kickoff")
    parser.add_argument("--json", action="store_true", help="Write structured results to stdout")
    args = parser.parse_args()
    try:
        config, samples, start = load_recording(args.db)
        cutoff = time.time_ns() // 1_000_000 if args.as_of_ms is None else args.as_of_ms
        if cutoff < start:
            raise ValueError("Replay cutoff precedes the first scheduled observation")
        report = replay(config, samples, start_ms=start, as_of_ms=cutoff, final_hour=args.final_hour)
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(1, f"{error}\n")
    sys.stdout.write(json.dumps(report, indent=2) + "\n" if args.json else render_markdown(report))


if __name__ == "__main__":
    main()
