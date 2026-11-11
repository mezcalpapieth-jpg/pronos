"""Score displayed liquidity for one HIP-4 outcome book using fixed MXN tickets."""
from decimal import Decimal, DecimalException, InvalidOperation, localcontext


TICKETS_MXN = (100, 300, 1000)
DEPTH_FLOOR_MXN = 600
DEPTH_BAND = Decimal("0.02")
MAX_BOOK_AGE_MS = 15_000


def decimal(value):
    encoded = str(value)
    # The public endpoint returns short fixed-point amounts. Bound malformed
    # scientific notation before formatting or multiplying external numbers.
    if len(encoded) > 80:
        raise ValueError("Expected a bounded decimal")
    try:
        result = Decimal(encoded)
    except InvalidOperation as error:
        raise ValueError("Expected a decimal") from error
    if not result.is_finite():
        raise ValueError("Expected a finite decimal")
    if abs(result.as_tuple().exponent) > 30 or len(result.as_tuple().digits) > 30 or abs(result.adjusted()) > 30:
        raise ValueError("Expected a bounded decimal")
    return result


def wire(value):
    return format(value.normalize(), "f")


def parse_levels(levels):
    if not isinstance(levels, (list, tuple)) or len(levels) != 2:
        raise ValueError("Expected bid and ask levels")
    bids, asks = [[(decimal(row["px"]), decimal(row["sz"])) for row in side] for side in levels]
    if any(not (0 < price < 1 and shares > 0) for price, shares in bids + asks):
        raise ValueError("Invalid outcome price or size")
    return sorted(bids, reverse=True), sorted(asks)


def sweep(levels, requested=None):
    filled = notional = Decimal(0)
    worst = None
    for price, available in levels:
        size = available if requested is None else min(available, requested - filled)
        if not size:
            break
        filled += size
        notional += size * price
        worst = price
    return filled, notional, worst


def notionals(filled, gross, multiplier, mxn_per_usd):
    return {"visibleShares": wire(filled), "grossNotionalMXN": wire(gross * mxn_per_usd),
            "feeAdjustedNotionalMXN": wire(gross * multiplier * mxn_per_usd)}


def depth(levels, midpoint, direction, multiplier, mxn_per_usd):
    in_band = ((price, shares) for price, shares in levels if direction * (price * multiplier - midpoint) <= DEPTH_BAND)
    filled, gross, _ = sweep(in_band)
    return {"referenceNotionalMXN": wire(filled * midpoint * mxn_per_usd),
            **notionals(filled, gross, multiplier, mxn_per_usd)}


def ticket_quote(levels, requested, midpoint, direction, multiplier, mxn_per_usd):
    filled, gross, worst = sweep(levels, requested)
    status = "below_one_share" if requested == 0 else "full" if filled == requested else "partial" if filled else "unfilled"
    vwap = gross / filled if filled else None
    effective = vwap * multiplier if filled else None
    return {"status": status, "coveragePct": wire(filled / requested * 100) if requested else None,
            "grossVwap": wire(vwap) if filled else None, "feeAdjustedVwap": wire(effective) if filled else None,
            "worstPrice": wire(worst) if filled else None,
            "feeAdjustedWorstPrice": wire(worst * multiplier) if filled else None,
            "grossSlippagePoints": wire(direction * (vwap - midpoint) * 100) if filled else None,
            "slippagePoints": wire(direction * (effective - midpoint) * 100) if filled else None,
            **notionals(filled, gross, multiplier, mxn_per_usd)}


def budget_buy_quote(levels, budget_mxn, midpoint, multiplier, mxn_per_usd):
    """Maximize whole shares within an MXN cash budget, including assumed fees.

    Fractional displayed levels may contribute to an order, but its aggregate
    share quantity must be an integer. Searching total order cost avoids
    independently rounding each level and discarding usable liquidity.
    """
    # Input decimals are bounded to 30 digits. This precision keeps products of
    # price, quantity, FX and fee exact at the affordability boundary.
    with localcontext() as context:
        context.prec = 128
        budget = Decimal(budget_mxn)
        visible_whole = int(sum((shares for _, shares in levels), Decimal(0)))
        low, high = 0, visible_whole
        while low < high:
            quantity = (low + high + 1) // 2
            _, gross, _ = sweep(levels, quantity)
            if gross * multiplier * mxn_per_usd <= budget:
                low = quantity
            else:
                high = quantity - 1
        quote = ticket_quote(levels, low, midpoint, 1, multiplier, mxn_per_usd)
        spend = Decimal(quote["feeAdjustedNotionalMXN"])
        remaining = budget - spend
        limitation = "budget" if low < visible_whole else "displayed_depth"
        if low == visible_whole and remaining == 0:
            limitation = "budget_and_displayed_depth"
        # A budget has no requested share count, so share-fill coverage from
        # ticket_quote would be misleading. Cash utilization is explicit.
        quote.pop("coveragePct")
        return {**quote, "status": "quoted" if low else "below_one_share",
                "requestedBudgetMXN": budget_mxn, "wholeShares": low,
                "actualSpendMXN": wire(spend), "remainingBudgetMXN": wire(remaining),
                "budgetUtilizationPct": wire(spend / budget * 100),
                "limitation": limitation}


def score_orderbook(book, *, mxn_per_usd, fee_bps, observed_at_ms):
    """Score one coin's two-sided book. Slippage is directional and includes the fee."""
    mxn_per_usd, fee_bps = decimal(mxn_per_usd), decimal(fee_bps)
    if mxn_per_usd <= 0 or not 0 <= fee_bps < 10_000:
        raise ValueError("Expected positive MXN/USD and total fees between 0 and 10,000 bps")
    if type(observed_at_ms) is not int or observed_at_ms <= 0:
        raise ValueError("Expected a positive millisecond observation timestamp")
    result = {"status": "missing" if book is None else "invalid", "passesDepthFloor": False,
              "observedAtMs": observed_at_ms, "bookTimeMs": None, "bookAgeMs": None,
              "mxnPerUSD": wire(mxn_per_usd), "assumedTotalFeeBps": wire(fee_bps),
              "bestBid": None, "bestAsk": None, "midpoint": None, "spreadPoints": None,
              "depthWithinTwoPoints": {}, "tickets": []}
    if not isinstance(book, dict) or type(book.get("time")) is not int or book["time"] <= 0:
        return result
    age = observed_at_ms - book["time"]
    result.update(bookTimeMs=book["time"], bookAgeMs=age)
    if abs(age) >= MAX_BOOK_AGE_MS:
        return {**result, "status": "stale"}
    try:
        bids, asks = parse_levels(book["levels"])
    except (KeyError, TypeError, ValueError):
        return result
    best_bid, best_ask = bids[0][0] if bids else None, asks[0][0] if asks else None
    result.update(bestBid=wire(best_bid) if bids else None, bestAsk=wire(best_ask) if asks else None)
    if not (bids and asks):
        return {**result, "status": "one_sided" if bids or asks else "empty"}
    if best_bid >= best_ask:
        return {**result, "status": "locked_or_crossed"}

    try:
        return _score_valid_book(result, bids, asks, best_bid, best_ask, fee_bps, mxn_per_usd)
    except DecimalException:
        # A malformed price/size combination must become a failed observation,
        # rather than stopping collection of all other selected markets.
        return result


def _score_valid_book(result, bids, asks, best_bid, best_ask, fee_bps, mxn_per_usd):
    midpoint = (best_bid + best_ask) / 2
    fee = fee_bps / 10_000
    sides = {"buy": (asks, 1, 1 + fee), "sell": (bids, -1, 1 - fee)}
    depth_by_side = {name: depth(levels, midpoint, direction, multiplier, mxn_per_usd)
                     for name, (levels, direction, multiplier) in sides.items()}
    tickets = []
    midpoint_mxn = midpoint * mxn_per_usd
    for ticket in TICKETS_MXN:
        requested = int(Decimal(ticket) // midpoint_mxn)
        tickets.append({
            "ticketMXN": ticket, "requestedShares": requested, "referenceNotionalMXN": wire(requested * midpoint_mxn),
            "budgetBuy": budget_buy_quote(asks, ticket, midpoint, 1 + fee, mxn_per_usd),
            **{name: ticket_quote(levels, requested, midpoint, direction, multiplier, mxn_per_usd)
               for name, (levels, direction, multiplier) in sides.items()},
        })
    return {**result, "status": "complete", "midpoint": wire(midpoint), "spreadPoints": wire((best_ask - best_bid) * 100),
            "depthWithinTwoPoints": depth_by_side, "tickets": tickets,
            "passesDepthFloor": all(Decimal(row["feeAdjustedNotionalMXN"]) >= DEPTH_FLOOR_MXN
                                    for row in depth_by_side.values())}
