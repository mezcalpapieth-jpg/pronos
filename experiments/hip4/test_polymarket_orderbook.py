"""Exercise the public capture boundary without hitting a live venue."""
from datetime import datetime
import unittest

from polymarket_orderbook import CLOB, GAMMA, PolymarketBookError, fetch_polymarket_book


def milliseconds(iso):
    return int(datetime.fromisoformat(iso).timestamp() * 1_000)


NOW = milliseconds("2026-11-11T01:00:00+00:00")
KICKOFF = milliseconds("2026-11-11T02:00:00+00:00")
CONDITION = "0x" + "a" * 64


class CaptureFixture:
    def __init__(self):
        # Same reviewed rules template and outcomes as the web pilot fixture.
        self.gamma = {
            "id": "123", "question": "Heat vs. Jazz", "version": "v1", "conditionId": CONDITION,
            "description": (
                'In the upcoming NBA game between Heat and Jazz, originally scheduled for Tuesday, November 10, 2026 '
                'at 9:00 PM ET (as of creation of the first market related to the event):\n'
                'If the Heat win, the market will resolve to "Heat".\n'
                'If the Jazz win, the market will resolve to "Jazz".\n'
                "If this market's outcome was definitively determined under its rules by the listed resolution sources "
                "before abandonment, that outcome will stand. Otherwise, the following no-result provisions apply. "
                "If the game is canceled, does not start by Thursday, November 12, 2026, 11:59 PM ET, or is abandoned "
                "with no official result by that time, this market will resolve 50-50.\n"
                "The result will be determined based on the final score including any overtime periods."
            ),
            "resolutionSource": "https://www.nba.com/", "gameStartTime": "2026-11-11 02:00:00+00",
            "endDate": "2026-11-11T02:00:00Z", "clobTokenIds": '["101", "102"]',
            "positionIds": ["201", "202"], "outcomes": '["Heat", "Jazz"]',
            "active": True, "closed": False, "archived": False, "enableOrderBook": True, "acceptingOrders": True,
            "sportsMarketType": "moneyline", "negRisk": False, "restricted": True,
        }
        self.details = {
            "c": CONDITION, "v": "v1", "ao": True, "t": [{"t": "102", "o": "Jazz"}, {"t": "101", "o": "Heat"}],
            "mts": 0.01, "mos": 5, "mbf": 1000, "tbf": 1000, "fd": {"r": 0.05, "e": 1, "to": True},
        }
        self.book = {
            "market": CONDITION, "asset_id": "101", "timestamp": str(NOW - 100), "neg_risk": False,
            "bids": [{"price": "0.39", "size": "12.5"}, {"price": "0.4", "size": "100"}],
            "asks": [{"price": "0.6", "size": "75"}, {"price": "0.5", "size": "100"}],
            "min_order_size": "5", "tick_size": "0.01",
        }
        self.market = {
            "coin": "polymarket:123:0", "market_id": "123", "outcome_index": 0,
            "outcome_label": "Heat", "kickoff_ms": KICKOFF,
        }
        self.calls = []

    def fetch(self, url):
        self.calls.append(url)
        if url == f"{GAMMA}/markets/123":
            return self.gamma
        if url == f"{CLOB}/clob-markets/{CONDITION}":
            return self.details
        if url in {f"{CLOB}/book?token_id={token}" for token in ("101", "102", "201", "202")}:
            return self.book
        raise AssertionError(f"Unexpected public request: {url}")

    def capture(self):
        return fetch_polymarket_book(self.market, get_json=self.fetch, clock=lambda: NOW)


class PolymarketCaptureTests(unittest.TestCase):
    def expect_error(self, fixture, code, count):
        with self.assertRaises(PolymarketBookError) as error:
            fixture.capture()
        self.assertEqual(error.exception.code, code)
        self.assertEqual(len(fixture.calls), count)

    def test_read_only_capture_preserves_venue_time_rules_and_fee_curve(self):
        f = CaptureFixture()
        result = f.capture()
        self.assertEqual(f.calls, [
            f"{GAMMA}/markets/123", f"{CLOB}/clob-markets/{CONDITION}", f"{CLOB}/book?token_id=101",
        ])
        self.assertEqual(result["coin"], "polymarket:123:0")
        self.assertEqual(result["time"], NOW - 100)
        self.assertEqual(result["levels"], [
            [{"px": "0.4", "sz": "100"}, {"px": "0.39", "sz": "12.5"}],
            [{"px": "0.5", "sz": "100"}, {"px": "0.6", "sz": "75"}],
        ])
        self.assertEqual((result["fee_rate"], result["min_order_size"], result["tick_size"]), ("0.05", "5", "0.01"))
        meta = result["market_metadata"]
        self.assertEqual((meta["version"], meta["condition_id"], meta["token_id"]), ("v1", CONDITION, "101"))
        self.assertEqual(meta["kickoff_ms"], KICKOFF)
        self.assertEqual(meta["kickoff_source"], "gameStartTime")
        self.assertEqual(meta["rules"], f.gamma["description"])
        self.assertEqual(meta["cancellation_payout_per_share"], "0.50")
        self.assertEqual(meta["cancellation_deadline"], "Thursday, November 12, 2026, 11:59 PM ET")
        self.assertEqual(meta["cancellation_deadline_ms"], milliseconds("2026-11-13T04:59:00+00:00"))
        self.assertTrue(meta["restricted"])
        self.assertEqual(meta["access_eligibility"], "unverified")

    def test_v2_uses_position_ids_and_requires_explicit_book_version(self):
        f = CaptureFixture()
        f.gamma["version"] = "v2"
        f.details.update(v="v2", t=[{"t": "201", "o": "Heat"}, {"t": "202", "o": "Jazz"}])
        f.market.update(coin="polymarket:123:1", outcome_index=1, outcome_label="Jazz")
        f.book.update(asset_id="202", version="v2")
        self.assertEqual(f.capture()["market_metadata"]["token_id"], "202")
        self.assertEqual(f.calls[-1], f"{CLOB}/book?token_id=202")
        f.calls.clear()
        del f.book["version"]
        self.expect_error(f, "BOOK_ID_MISMATCH", 3)
        f.calls.clear()
        del f.gamma["positionIds"]
        self.expect_error(f, "INVALID_MARKET", 1)

    def test_full_cancellation_rules_and_deadline_are_required(self):
        for field, change in [
            ("description", lambda _: "If the teams tie, this market will resolve 50-50."),
            ("description", lambda text: text.replace("will resolve 50-50", "will resolve to Jazz")),
            ("description", lambda text: text + "\nIn the event of cancellation, Jazz wins."),
            ("description", lambda text: text.replace("Thursday, November 12", "Friday, November 12")),
            ("description", lambda text: text.replace("Thursday, November 12", "Monday, November 9")),
            ("rules", lambda _: "If the game is canceled, resolve to Jazz."),
            ("resolutionSource", lambda _: "https://example.com/"),
            ("negRisk", lambda _: True),
        ]:
            f = CaptureFixture()
            f.gamma[field] = change(f.gamma.get(field))
            with self.subTest(field=field, value=f.gamma[field]):
                self.expect_error(f, "UNSUPPORTED_CANCELLATION", 1)
        f = CaptureFixture()
        f.gamma["rules"] = f.gamma["description"].replace("\n", "\r\n\r\n")
        self.assertEqual(f.capture()["market_metadata"]["cancellation_payout_per_share"], "0.50")

    def test_kickoff_must_match_live_metadata_and_reviewed_rule(self):
        f = CaptureFixture()
        del f.gamma["gameStartTime"]
        self.assertEqual(f.capture()["market_metadata"]["kickoff_source"], "endDate")
        f.calls.clear()
        f.gamma["description"] = f.gamma["description"].replace("at 9:00 PM", "at 8:00 PM")
        self.expect_error(f, "KICKOFF_MISMATCH", 1)
        f = CaptureFixture()
        f.gamma["gameStartTime"] = "2026-11-11T03:00:00Z"
        self.expect_error(f, "KICKOFF_MISMATCH", 1)
        f = CaptureFixture()
        f.gamma["gameStartTime"] = "2026-11-11T02:00:00"
        self.expect_error(f, "INVALID_KICKOFF", 1)
        f = CaptureFixture()
        f.details["gst"] = "2026-11-11T03:00:00Z"
        self.expect_error(f, "KICKOFF_MISMATCH", 2)

    def test_closed_mismatched_or_unconfigured_market_never_fetches_a_book(self):
        for target, field, value, code, count in [
            ("market", "market_id", "https://example.com/", "INVALID_MARKET", 0),
            ("market", "outcome_index", False, "INVALID_OUTCOME", 0),
            ("market", "outcome_label", "heat", "OUTCOME_MISMATCH", 1),
            ("gamma", "id", "124", "MARKET_ID_MISMATCH", 1),
            ("gamma", "acceptingOrders", False, "MARKET_NOT_TRADING", 1),
            ("details", "ao", False, "MARKET_NOT_TRADING", 2),
            ("details", "c", "0x" + "b" * 64, "MARKET_ID_MISMATCH", 2),
            ("details", "t", [{"t": "101", "o": "Jazz"}, {"t": "102", "o": "Heat"}], "MARKET_ID_MISMATCH", 2),
        ]:
            with self.subTest(field=field, value=value):
                f = CaptureFixture()
                getattr(f, target)[field] = value
                self.expect_error(f, code, count)

    def test_fee_requires_an_explicit_supported_curve(self):
        for curve in (None, {"r": 0.05, "e": 2, "to": True}, {"r": 0.05, "e": 1, "to": False},
                      {"r": 0.05, "e": True, "to": True}, {"e": 1, "to": True}):
            with self.subTest(curve=curve):
                f = CaptureFixture()
                f.details["fd"] = curve
                self.expect_error(f, "UNSUPPORTED_FEES", 2)
        f = CaptureFixture()
        f.details["fd"]["r"] = 0
        self.assertEqual(f.capture()["fee_rate"], "0")

    def test_book_keeps_failed_depth_observations_and_rejects_malformed_levels(self):
        f = CaptureFixture()
        f.book.update(asks=[], timestamp=str(NOW - 16_000))
        result = f.capture()
        self.assertEqual(result["levels"][1], [])
        self.assertEqual(result["time"], NOW - 16_000)
        f = CaptureFixture()
        f.book["asks"] = [{"price": "0.4", "size": "10"}]
        self.assertEqual(f.capture()["levels"][1], [{"px": "0.4", "sz": "10"}])
        for field, value, code in [
            ("timestamp", str(NOW + 1), "INVALID_BOOK_TIME"),
            ("timestamp", str(NOW // 1_000), "INVALID_BOOK_TIME"),
            ("asset_id", "102", "BOOK_ID_MISMATCH"),
            ("tick_size", "0.001", "BOOK_PARAMETERS_CHANGED"),
            ("min_order_size", "6", "BOOK_PARAMETERS_CHANGED"),
            ("asks", [{"price": "0.501", "size": "10"}], "INVALID_DEPTH"),
            ("asks", [{"price": "0.5", "size": "10"}] * 2, "INVALID_DEPTH"),
        ]:
            with self.subTest(field=field, value=value):
                f = CaptureFixture()
                f.book[field] = value
                self.expect_error(f, code, 3)


if __name__ == "__main__":
    unittest.main()
