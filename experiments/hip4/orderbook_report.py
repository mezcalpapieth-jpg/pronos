"""Summarize scheduled HIP-4 book observations, including missed samples."""

from collections import Counter, defaultdict
from decimal import Decimal


HOUR_MS = 60 * 60 * 1000
TARGET_QUALIFYING_PCT = 90
TICKETS_MXN = (100, 300, 1000)
SIDES = ("buy", "sell")
BASE_STATUSES = ("complete", "missing", "stale", "one_sided")


def iter_slots(start_ms, cutoff_ms, kickoff_ms, interval_ms, near_interval_ms):
    """Yield scheduled slots through the inclusive cutoff and before kickoff."""
    if interval_ms <= 0 or near_interval_ms <= 0:
        raise ValueError("Sampling intervals must be positive")
    near_start = kickoff_ms - HOUR_MS
    stop = min(cutoff_ms + 1, kickoff_ms)
    yield from range(start_ms, min(near_start, stop), interval_ms)
    yield from range(max(start_ms, near_start), stop, near_interval_ms)


def _pct(numerator, denominator):
    return round(numerator * 100 / denominator, 2) if denominator else None


def _ticket_report(ticket, slippage_by_side, full_by_side, scheduled):
    result = {"ticketMXN": ticket}
    for side in SIDES:
        values = sorted(slippage_by_side[side])
        # Nearest-rank p95 describes the tail of observed full visible executions.
        rank = (len(values) * 95 + 99) // 100
        result[side] = {
            "fullVisibleSamples": full_by_side[side],
            "fullVisibleRatePct": _pct(full_by_side[side], scheduled),
            "slippageSamples": len(values),
            "p95SlippagePoints": format(values[rank - 1], "f") if values else None,
            "worstSlippagePoints": format(values[-1], "f") if values else None,
        }
    return result


def _summarize(samples, min_samples, *, covers_window=True):
    scheduled = len(samples)
    counts = Counter({status: 0 for status in BASE_STATUSES})
    qualified = 0
    full = {ticket: Counter() for ticket in TICKETS_MXN}
    slippage = {ticket: {side: [] for side in SIDES} for ticket in TICKETS_MXN}

    for sample in samples:
        status = sample["status"] if sample is not None else "missing"
        counts[status] += 1
        if status != "complete":
            continue
        qualified += bool(sample.get("passesDepthFloor"))
        for ticket in sample.get("tickets", ()):
            amount = ticket["ticketMXN"]
            if amount not in full:
                continue
            for side in SIDES:
                result = ticket[side]
                if result["status"] != "full":
                    continue
                full[amount][side] += 1
                if result["slippagePoints"] is not None:
                    slippage[amount][side].append(Decimal(result["slippagePoints"]))

    reasons = []
    if not covers_window:
        reasons.append("window_not_covered")
    if counts["complete"] < min_samples:
        reasons.append("too_few_complete_samples")
    if reasons:
        status = "provisional"
    elif qualified * 100 >= scheduled * TARGET_QUALIFYING_PCT:
        status = "passes"
    else:
        status = "below_target"

    return {
        "scheduledSamples": scheduled,
        "counts": dict(counts),
        "qualifiedSamples": qualified,
        "qualifyingPct": _pct(qualified, scheduled),
        "status": status,
        "provisionalReasons": reasons,
        "tickets": [_ticket_report(ticket, slippage[ticket], full[ticket], scheduled) for ticket in TICKETS_MXN],
    }


def build_report(markets, scored_samples, *, start_ms, end_ms, interval_ms=300_000,
                 near_interval_ms=60_000, min_samples=20, grace_ms=0):
    """Build a JSON-ready report for elapsed slots through end_ms, inclusive.

    Unscheduled records are ignored. The last appended observation for a
    duplicate slot wins, so a retried capture cannot increase its weight.
    Each ticket's full visible execution rate uses all scheduled slots;
    slippage uses full visible executions with a reported slippage value.
    A slot still within its capture grace period is deferred until a response
    arrives or the grace period expires. Completed final-hour coverage also
    requires kickoff to have elapsed.
    """
    if min_samples < 1 or interval_ms <= 0 or near_interval_ms <= 0:
        raise ValueError("Sampling intervals and minimum samples must be positive")
    if grace_ms < 0:
        raise ValueError("Capture grace period must be nonnegative")

    by_coin = defaultdict(dict)
    for sample in scored_samples:
        by_coin[sample["coin"]][sample["slot_ms"]] = sample

    rows = []
    for market in markets:
        kickoff = market["kickoff_ms"]
        near_start = kickoff - HOUR_MS
        covers_near_hour = start_ms <= near_start and end_ms >= kickoff
        records = by_coin[market["coin"]]
        overall = []
        last_hour = []
        for slot in iter_slots(start_ms, end_ms, kickoff, interval_ms, near_interval_ms):
            sample = records.get(slot)
            if sample is None and end_ms < slot + grace_ms:
                continue
            overall.append(sample)
            if slot >= near_start:
                last_hour.append(sample)
        rows.append({
            **market,
            "overall": _summarize(overall, min_samples),
            "lastHour": _summarize(last_hour, min_samples, covers_window=covers_near_hour),
        })

    return {
        "startMs": start_ms,
        "endMs": end_ms,
        "intervalMs": interval_ms,
        "nearIntervalMs": near_interval_ms,
        "graceMs": grace_ms,
        "minimumCompleteSamples": min_samples,
        "targetQualifyingPct": TARGET_QUALIFYING_PCT,
        "markets": rows,
    }
