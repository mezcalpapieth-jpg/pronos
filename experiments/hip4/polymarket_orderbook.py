"""Validate and adapt public Polymarket books for the sports recorder."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
import re
import time
from zoneinfo import ZoneInfo


GAMMA = "https://gamma-api.polymarket.com"
CLOB = "https://clob.polymarket.com"
NBA_SOURCE = "https://www.nba.com/"
ET = ZoneInfo("America/New_York")
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
MAX_LEVELS = 1_000
MAX_SIZE = Decimal("1000000000000")
MAX_MINIMUM = Decimal("1000000")
MAX_PRICE = Decimal("0.999999")
UINT256 = (1 << 256) - 1

WEEKDAYS = "Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split()
MONTHS = "January February March April May June July August September October November December".split()
NBA_RULE_DATE = re.compile(
    rf"((?:{'|'.join(WEEKDAYS)}), (?:{'|'.join(MONTHS)}) (?:[1-9]|[12][0-9]|3[01]), 20[0-9]{{2}})"
)
NBA_RULE_START = re.compile(
    r"^ at ([1-9]|1[0-2]):([0-5][0-9]) ([AP]M) ET "
    r"\(as of creation of the first market related to the event\): "
)
VENUE_TIME = re.compile(
    r"([0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2})"
    r"(?:\.([0-9]{1,6}))?(Z|[+-](?:[01][0-9]|2[0-3])(?::?[0-5][0-9])?)"
)
NO_RESULT_RULE = (
    "If this market's outcome was definitively determined under its rules by the listed resolution "
    "sources before abandonment, that outcome will stand. Otherwise, the following no-result provisions "
    "apply. If the game is canceled, does not start by "
)
NBA_RULE_SUFFIX = (
    ", 11:59 PM ET, or is abandoned with no official result by that time, this market will resolve 50-50. "
    "The result will be determined based on the final score including any overtime periods."
)


class PolymarketBookError(ValueError):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code


def _fail(code, message):
    raise PolymarketBookError(code, message)


def _clock_ms():
    return time.time_ns() // 1_000_000


def _condition(value, code):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        _fail(code, "Expected a complete CLOB condition ID")
    return value.lower()


def _token(value, code):
    if not isinstance(value, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", value) or int(value) > UINT256:
        _fail(code, "Expected a decimal uint256 token ID")
    return value


def _pair(value, field):
    if isinstance(value, str) and len(value) <= 20_000:
        try:
            value = json.loads(value)
        except (ValueError, RecursionError):
            _fail("INVALID_MARKET", f"Invalid JSON in Gamma {field}")
    if not isinstance(value, list) or len(value) != 2:
        _fail("INVALID_MARKET", f"Gamma {field} must identify exactly two outcomes")
    return value


def _decimal(value, field, *, maximum, positive=True, code="INVALID_DECIMAL"):
    if type(value) in (int, float):
        value = str(value)
        if "e" in value:
            value = format(Decimal(value), "f")
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,17})(?:\.[0-9]{1,6})?", value):
        _fail(code, f"{field} must be an unsigned decimal with at most six decimal places")
    result = Decimal(value)
    if result > maximum or (positive and not result):
        _fail(code, f"{field} is outside supported bounds")
    return result


def _wire(value):
    return format(value.normalize(), "f")


def _iso_ms(value):
    match = VENUE_TIME.fullmatch(value) if isinstance(value, str) else None
    if not match:
        _fail("INVALID_KICKOFF", "Expected a timezone-aware venue game start time")
    local, fraction, offset = match.groups()
    # Gamma uses +00 offsets. Python 3.9 needs +00:00 and full microseconds.
    fraction = (fraction or "").ljust(6, "0")
    offset = "+0000" if offset == "Z" else offset.replace(":", "").ljust(5, "0")
    try:
        parsed = datetime.fromisoformat(f"{local}.{fraction}{offset[:3]}:{offset[3:]}")
    except ValueError:
        _fail("INVALID_KICKOFF", "Could not parse the venue game start time")
    if parsed.microsecond % 1000:
        _fail("INVALID_KICKOFF", "Venue game start time requires millisecond precision")
    return (parsed - EPOCH) // timedelta(milliseconds=1)


def _rule_ms(date, hour, minute):
    weekday, month_day, year = date.split(", ")
    month, day = month_day.split()
    try:
        start = datetime(int(year), MONTHS.index(month) + 1, int(day), hour, minute, tzinfo=ET)
    except ValueError:
        _fail("UNSUPPORTED_CANCELLATION", "Invalid date in the published NBA rules")
    if WEEKDAYS[start.weekday()] != weekday:
        _fail("UNSUPPORTED_CANCELLATION", "Published NBA rule date and weekday disagree")
    return (start - EPOCH) // timedelta(milliseconds=1)


def _normalized_rules(value):
    return " ".join(value.split()) if isinstance(value, str) and len(value) <= 16_000 else ""


def _verify_cancellation(raw, labels):
    # Mirror the full reviewed NBA rule in frontend/api/_lib/polymarket-distribution.js.
    # A 50-50 phrase elsewhere in the description is insufficient.
    first, second = labels
    rules = _normalized_rules(raw.get("description"))
    override = raw.get("rules")
    parts = NBA_RULE_DATE.split(rules)
    if (raw.get("sportsMarketType") != "moneyline" or raw.get("negRisk") is not False
            or raw.get("resolutionSource") != NBA_SOURCE
            or (override not in (None, "") and _normalized_rules(override) != rules)
            or len(parts) != 5):
        _fail("UNSUPPORTED_CANCELLATION", "Market does not match the reviewed 50/50 NBA cancellation rules")
    prefix, scheduled, between, deadline, suffix = parts
    start = NBA_RULE_START.match(between)
    winner_rules = (
        f'If the {first} win, the market will resolve to "{first}". '
        f'If the {second} win, the market will resolve to "{second}". '
    )
    if (prefix != f"In the upcoming NBA game between {first} and {second}, originally scheduled for "
            or not start or between[start.end():] != winner_rules + NO_RESULT_RULE or suffix != NBA_RULE_SUFFIX):
        _fail("UNSUPPORTED_CANCELLATION", "Market does not match the reviewed 50/50 NBA cancellation rules")
    hour, minute, meridiem = start.groups()
    start_ms = _rule_ms(scheduled, int(hour) % 12 + (12 if meridiem == "PM" else 0), int(minute))
    deadline_ms = _rule_ms(deadline, 23, 59)
    if deadline_ms < start_ms:
        _fail("UNSUPPORTED_CANCELLATION", "Published cancellation deadline precedes the scheduled start")
    return start_ms, f"{deadline}, 11:59 PM ET", deadline_ms


def _verify_market(raw, market_id, outcome_index, outcome_label, kickoff_ms):
    if not isinstance(raw, dict) or str(raw.get("id")) != market_id:
        _fail("MARKET_ID_MISMATCH", "Gamma returned a different market ID")
    version = raw.get("version")
    if version not in ("v1", "v2"):
        _fail("UNSUPPORTED_VERSION", "Gamma must specify market version v1 or v2")
    if (raw.get("active") is not True or raw.get("closed") is not False or raw.get("archived") is True
            or raw.get("acceptingOrders") is not True or raw.get("enableOrderBook") is not True):
        _fail("MARKET_NOT_TRADING", "Gamma market is not open for order-book trading")
    condition = _condition(raw.get("conditionId"), "INVALID_MARKET")
    token_field = "clobTokenIds" if version == "v1" else "positionIds"
    tokens = [_token(value, "INVALID_MARKET") for value in _pair(raw.get(token_field), token_field)]
    labels = _pair(raw.get("outcomes"), "outcomes")
    if (tokens[0] == tokens[1] or labels[0] == labels[1]
            or any(not isinstance(label, str) or not label.strip() or len(label) > 200 for label in labels)):
        _fail("INVALID_MARKET", "Binary labels and tokens must be distinct")
    if labels[outcome_index] != outcome_label:
        _fail("OUTCOME_MISMATCH", "Configured outcome label does not match Gamma at the selected index")
    start_ms, deadline, deadline_ms = _verify_cancellation(raw, labels)
    # Gamma may omit gameStartTime. endDate corroborates kickoff only when the
    # full published rule also gives the exact configured start.
    kickoff_source = "gameStartTime" if raw.get("gameStartTime") not in (None, "") else "endDate"
    kickoff_timestamp = raw.get(kickoff_source)
    if _iso_ms(kickoff_timestamp) != kickoff_ms or start_ms != kickoff_ms:
        _fail("KICKOFF_MISMATCH", "Configured kickoff differs from Gamma or the published NBA rules")
    title = raw.get("question")
    if not isinstance(title, str) or not title.strip() or len(title) > 500:
        _fail("INVALID_MARKET", "Gamma must identify the market title")
    return {
        "market_id": market_id, "condition_id": condition, "version": version, "title": title,
        "outcome_index": outcome_index, "outcome_label": outcome_label, "token_id": tokens[outcome_index],
        "outcomes": [{"label": label, "token_id": token} for label, token in zip(labels, tokens)],
        "kickoff_ms": kickoff_ms, "kickoff_source": kickoff_source, "kickoff_timestamp": kickoff_timestamp,
        "resolution_source": NBA_SOURCE, "rules": raw["description"],
        "cancellation_payout_per_share": "0.50", "cancellation_deadline": deadline,
        "cancellation_deadline_ms": deadline_ms, "restricted": raw.get("restricted") is True,
        "access_eligibility": "unverified",
    }


def _verify_details(raw, market):
    if (not isinstance(raw, dict) or _condition(raw.get("c"), "MARKET_ID_MISMATCH") != market["condition_id"]
            or raw.get("v") != market["version"]):
        _fail("MARKET_ID_MISMATCH", "CLOB condition or version differs from Gamma")
    if raw.get("ao") is not True:
        _fail("MARKET_NOT_TRADING", "CLOB market is not accepting orders")
    tokens = raw.get("t")
    if not isinstance(tokens, list) or len(tokens) != 2 or any(not isinstance(item, dict) for item in tokens):
        _fail("MARKET_ID_MISMATCH", "CLOB must identify both binary outcomes")
    actual = {_token(item.get("t"), "MARKET_ID_MISMATCH"): item.get("o") for item in tokens}
    expected = {outcome["token_id"]: outcome["label"] for outcome in market["outcomes"]}
    if actual != expected:
        _fail("MARKET_ID_MISMATCH", "CLOB outcome labels or tokens differ from Gamma")
    if raw.get("gst") is not None and _iso_ms(raw["gst"]) != market["kickoff_ms"]:
        _fail("KICKOFF_MISMATCH", "CLOB game start differs from the configured kickoff")
    fee = raw.get("fd")
    if not isinstance(fee, dict) or type(fee.get("e")) not in (int, float) or fee["e"] != 1 or fee.get("to") is not True:
        _fail("UNSUPPORTED_FEES", "Expected a live exponent-one, taker-only CLOB fee curve")
    rate = _decimal(fee.get("r"), "Fee rate", maximum=Decimal(1), positive=False, code="UNSUPPORTED_FEES")
    tick = _decimal(raw.get("mts"), "CLOB tick size", maximum=MAX_PRICE)
    minimum = _decimal(raw.get("mos"), "CLOB minimum order size", maximum=MAX_MINIMUM)
    return rate, tick, minimum


def _levels(raw, tick, *, descending):
    if not isinstance(raw, list) or len(raw) > MAX_LEVELS:
        _fail("INVALID_DEPTH", "Expected at most 1,000 levels per side")
    levels = {}
    for level in raw:
        if not isinstance(level, dict):
            _fail("INVALID_DEPTH", "Malformed price level")
        price = _decimal(level.get("price"), "Level price", maximum=MAX_PRICE, code="INVALID_DEPTH")
        size = _decimal(level.get("size"), "Level size", maximum=MAX_SIZE, code="INVALID_DEPTH")
        if price % tick or price in levels:
            _fail("INVALID_DEPTH", "Book prices must be unique and aligned with the current tick")
        levels[price] = size
    return [{"px": _wire(price), "sz": _wire(levels[price])} for price in sorted(levels, reverse=descending)]


def _verify_book(raw, market, tick, minimum, captured_ms):
    if (not isinstance(raw, dict) or _condition(raw.get("market"), "BOOK_ID_MISMATCH") != market["condition_id"]
            or _token(raw.get("asset_id"), "BOOK_ID_MISMATCH") != market["token_id"]):
        _fail("BOOK_ID_MISMATCH", "Book condition or token differs from the selected outcome")
    version = raw.get("version")
    if version != market["version"] and not (market["version"] == "v1" and version is None):
        _fail("BOOK_ID_MISMATCH", "Book version differs from the selected market")
    if raw.get("neg_risk") is not False:
        _fail("BOOK_ID_MISMATCH", "Book negative-risk setting differs from the selected market")
    timestamp = raw.get("timestamp")
    if not isinstance(timestamp, str) or not re.fullmatch(r"[1-9][0-9]{12}", timestamp) or int(timestamp) > captured_ms:
        _fail("INVALID_BOOK_TIME", "Book requires a non-future epoch-millisecond timestamp")
    book_tick = _decimal(raw.get("tick_size"), "Book tick size", maximum=MAX_PRICE)
    book_minimum = _decimal(raw.get("min_order_size"), "Book minimum order size", maximum=MAX_MINIMUM)
    if book_tick != tick or book_minimum != minimum:
        _fail("BOOK_PARAMETERS_CHANGED", "Book tick or minimum differs from CLOB market details")
    # Keep stale, empty, one-sided and crossed books for explicit scorer outcomes.
    bids = _levels(raw.get("bids"), tick, descending=True)
    asks = _levels(raw.get("asks"), tick, descending=False)
    return int(timestamp), [bids, asks]


def fetch_polymarket_book(market, *, get_json, clock=_clock_ms):
    """Load one configured outcome through three fixed public GET endpoints."""
    if not isinstance(market, dict):
        _fail("INVALID_MARKET", "Expected a configured recorder market")
    market_id, index = market.get("market_id"), market.get("outcome_index")
    label, kickoff = market.get("outcome_label"), market.get("kickoff_ms")
    if not isinstance(market_id, str) or not re.fullmatch(r"[1-9][0-9]{0,19}", market_id):
        _fail("INVALID_MARKET", "Expected a numeric Gamma market ID")
    if type(index) is not int or index not in (0, 1) or not isinstance(label, str) or not label.strip():
        _fail("INVALID_OUTCOME", "Expected a binary outcome index and exact outcome label")
    if type(kickoff) is not int or kickoff <= 0 or market.get("coin") != f"polymarket:{market_id}:{index}":
        _fail("INVALID_MARKET", "Expected the matching recorder key and configured kickoff time")

    metadata = _verify_market(get_json(f"{GAMMA}/markets/{market_id}"), market_id, index, label, kickoff)
    details = get_json(f"{CLOB}/clob-markets/{metadata['condition_id']}")
    rate, tick, minimum = _verify_details(details, metadata)
    book = get_json(f"{CLOB}/book?token_id={metadata['token_id']}")
    captured_ms = clock()
    stamp, levels = _verify_book(book, metadata, tick, minimum, captured_ms)
    return {
        "coin": market["coin"], "time": stamp, "levels": levels, "fee_rate": _wire(rate),
        "min_order_size": _wire(minimum), "tick_size": _wire(tick), "market_metadata": metadata,
    }
