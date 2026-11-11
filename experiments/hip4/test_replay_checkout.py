import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from replay_checkout import CAPTURE_GRACE_MS, load_recording, render_markdown, replay


START = 1_900_000_000_000
INTERVAL = 300_000
KICKOFF = START + 3_600_000 + INTERVAL * 2
HIP4 = {"coin": "#100", "venue": "hip4", "label": "HIP-4 fixture", "kickoff_ms": KICKOFF}
POLY = {"coin": "polymarket:1:0", "venue": "polymarket", "label": "Polymarket fixture", "kickoff_ms": KICKOFF}
CONFIG = {"markets": [HIP4, POLY], "interval_ms": INTERVAL, "near_interval_ms": 60_000,
          "assumed_taker_fee_bps": "35", "hip4_builder_fee_bps": "25"}


def sample(market, *, bid="0.49", ask="0.5", shares="10000", slot=START, status="complete",
           fx_bid="20", fx_ask="20"):
    book = {"coin": market["coin"], "time": slot - 1,
            "levels": [[{"px": bid, "sz": shares}], [{"px": ask, "sz": shares}]]}
    if market["venue"] == "polymarket":
        book.update(fee_rate="0.05", min_order_size="5")
    return {"book": book, "status": status, "observed_ms": slot,
            "fx": {"time_ms": slot, "mxn_per_usd": "20", "ask": fx_ask, "bid": fx_bid}}


def row(report, *, venue="hip4", rate=0, side="buy", ticket=100):
    return next(row for row in report["rows"] if (
        row["venue"], row["builderBps"], row["side"], row["ticketMXN"]
    ) == (venue, rate, side, ticket))


class CheckoutReplayTest(unittest.TestCase):
    def test_rate_scenarios_keep_venue_fees_and_count_cap_failures_at_low_prices(self):
        samples = {(HIP4["coin"], START): sample(HIP4),
                   (POLY["coin"], START): sample(POLY, bid="0.09", ask="0.1")}
        result = replay(CONFIG, samples, start_ms=START, as_of_ms=START + 10)
        self.assertEqual(len(result["rows"]), 36)
        self.assertEqual(result["hip4BaseFeeScenarioBps"], "10")
        for side in ("buy", "sell"):
            self.assertEqual(row(result, venue="polymarket", side=side)["passed"], 1)
            self.assertEqual(row(result, venue="polymarket", side=side)["modeledBuilderFeesMXN"], "0")
            self.assertEqual(row(result, venue="polymarket", rate=100, side=side)["statusCounts"], {"fee_cap": 1})
        buy_at_cap = row(result, venue="polymarket", rate=50)
        self.assertEqual(buy_at_cap["passed"], 1)
        self.assertEqual(buy_at_cap["passedGrossNotionalMXN"], "94")
        self.assertEqual(buy_at_cap["modeledBuilderFeesMXN"], "0.47")
        self.assertEqual(row(result, venue="polymarket", rate=50, side="sell")["statusCounts"], {"fee_cap": 1})

    def test_directional_fx_budget_and_mx_normalized_builder_revenue(self):
        samples = {(HIP4["coin"], START): sample(HIP4, bid="0.49", ask="0.5", fx_bid="19.9", fx_ask="20.1")}
        result = replay(CONFIG, samples, start_ms=START, as_of_ms=START + 1)
        self.assertEqual(row(result, rate=100)["passedGrossNotionalMXN"], "90")
        self.assertEqual(row(result, rate=100)["modeledBuilderFeesMXN"], "0.9")
        self.assertEqual(row(result, rate=100, side="sell")["passedGrossNotionalMXN"], "98")
        self.assertEqual(row(result, rate=100, side="sell")["modeledBuilderFeesMXN"], "0.98")

    def test_depth_exhaustion_checks_whole_share_remainder_and_full_sell(self):
        samples = {(HIP4["coin"], START): sample(HIP4, shares="9"),
                   (HIP4["coin"], START + INTERVAL): sample(HIP4, shares="8", slot=START + INTERVAL)}
        result = replay(CONFIG, samples, start_ms=START, as_of_ms=START + INTERVAL + 1)
        self.assertEqual(row(result)["statusCounts"], {"pass": 1, "insufficient_depth": 1})
        self.assertEqual(row(result, side="sell")["statusCounts"], {"insufficient_depth": 2})

    def test_last_visible_ask_counts_fractional_tail_and_distinguishes_sub_one_share(self):
        fractional_tail = sample(HIP4, bid="0.48", ask="0.49", shares="9")
        fractional_tail["book"]["levels"][1].append({"px": "0.60", "sz": "0.8"})
        fractional_only = sample(HIP4, shares="0.6", slot=START + INTERVAL)
        too_expensive = sample(HIP4, shares="0.6", slot=START + 2 * INTERVAL, fx_bid="300", fx_ask="300")
        too_expensive["fx"]["mxn_per_usd"] = "300"
        samples = {(HIP4["coin"], sample["observed_ms"]): sample
                   for sample in (fractional_tail, fractional_only, too_expensive)}
        result = replay(CONFIG, samples, start_ms=START, as_of_ms=START + 2 * INTERVAL + 1)
        self.assertEqual(row(result)["statusCounts"], {"pass": 1, "insufficient_depth": 1, "below_one_share": 1})

    def test_missing_stale_and_late_never_earn_fees(self):
        samples = {(HIP4["coin"], START): sample(HIP4, status="stale"),
                   (POLY["coin"], START): sample(POLY, status="late"),
                   (POLY["coin"], START + INTERVAL): sample(POLY, slot=START + INTERVAL)}
        samples[(POLY["coin"], START + INTERVAL)]["book"]["time"] -= 16_000
        result = replay(CONFIG, samples, start_ms=START, as_of_ms=START + INTERVAL + CAPTURE_GRACE_MS)
        self.assertEqual(row(result, rate=100)["statusCounts"], {"stale": 1, "missing": 1})
        self.assertEqual(row(result, venue="polymarket", rate=100)["statusCounts"], {"late": 1, "stale": 1})
        self.assertTrue(all(entry["modeledBuilderFeesMXN"] == "0" for entry in result["rows"]))
        self.assertIn("Fee cap fails", render_markdown(result))

    def test_final_hour_has_its_own_scheduled_denominator(self):
        window_start = KICKOFF - 3_600_000
        result = replay(CONFIG, {}, start_ms=START, as_of_ms=window_start + 120_000, final_hour=True)
        self.assertEqual(result["window"], "final_hour")
        self.assertEqual(row(result)["scheduled"], 2)
        self.assertFalse(result["listings"][0]["finalHourCovered"])

    def test_read_only_database_uses_recorder_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "samples.sqlite3"
            with sqlite3.connect(path) as db:
                db.execute("CREATE TABLE run (id, config, start_ms)")
                db.execute("CREATE TABLE samples (coin, slot_ms, payload)")
                db.execute("INSERT INTO run VALUES (1, ?, ?)", (json.dumps(CONFIG), START))
                db.execute("INSERT INTO samples VALUES (?, ?, ?)",
                           (HIP4["coin"], START, json.dumps(sample(HIP4))))
            before = path.read_bytes()
            self.assertEqual(load_recording(path), (CONFIG, {(HIP4["coin"], START): sample(HIP4)}, START))
            self.assertEqual(path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
