"""Read-only collector boundaries, persistence and report integration tests."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import requests

import orderbook_recorder as recorder


CLOCK = 1_000_000


def market(coin="#1000"):
    return {"coin": coin, "label": "Example home win", "kickoff_ms": CLOCK + 7_200_000,
            "kickoff": "2026-11-12T00:00:00Z", "source_url": "https://example.com/fixture"}


def config():
    return {"version": 1, "network": "mainnet-public", "markets": [market(f"#{i}0") for i in (100, 101, 102)],
            "assumed_taker_fee_bps": "35", "interval_ms": 300_000, "near_interval_ms": 60_000,
            "fx_url": recorder.FX_URL}


def book(coin="#1000"):
    return {"coin": coin, "time": CLOCK,
            "levels": [[{"px": "0.49", "sz": "1000", "n": 2}],
                       [{"px": "0.51", "sz": "1000", "n": 2}]]}


def fx():
    return {"source": "Bitso USD/MXN indicative midpoint", "time_ms": CLOCK,
            "bid": "19.99", "ask": "20.01", "mxn_per_usd": "20"}


class BatchTests(unittest.TestCase):
    def collect(self, *, get_book=book, get_fx=fx, observed=CLOCK, selected=None):
        with patch.object(recorder, "now_ms", return_value=observed):
            return recorder.collect_batch(selected or [market()], CLOCK, "35",
                                          get_book=get_book, get_fx=get_fx)

    def test_complete_capture_keeps_raw_book_and_fx(self):
        sample, = self.collect()
        self.assertEqual(sample["status"], "complete")
        self.assertTrue(sample["passesDepthFloor"])
        self.assertEqual(sample["book"], book())
        self.assertEqual(sample["fx"], fx())
        self.assertEqual([ticket["ticketMXN"] for ticket in sample["tickets"]], [100, 300, 1000])

    def test_wrong_coin_is_invalid_and_does_not_qualify(self):
        sample, = self.collect(get_book=lambda coin: book("#1010"))
        self.assertEqual(sample["status"], "invalid")
        self.assertFalse(sample["passesDepthFloor"])

    def test_book_timeout_is_an_explicit_missing_observation(self):
        def unavailable(coin):
            raise requests.Timeout("test timeout")
        sample, = self.collect(get_book=unavailable)
        self.assertEqual(sample["status"], "missing")
        self.assertIn("Timeout", sample["error"])
        self.assertIsNone(sample["book"])

    def test_failed_fx_prevents_scoring_a_fresh_book(self):
        def unavailable():
            raise requests.ConnectionError("test offline")
        sample, = self.collect(get_fx=unavailable)
        self.assertEqual(sample["status"], "missing_fx")
        self.assertFalse(sample["passesDepthFloor"])

    def test_stale_fx_prevents_scoring(self):
        sample, = self.collect(get_fx=lambda: {**fx(), "time_ms": CLOCK - recorder.MAX_FX_AGE_MS - 1})
        self.assertEqual(sample["status"], "missing_fx")

    def test_fx_too_far_in_the_future_prevents_scoring(self):
        sample, = self.collect(get_fx=lambda: {**fx(), "time_ms": CLOCK + recorder.GRACE_MS + 1})
        self.assertEqual(sample["status"], "missing_fx")

    def test_late_response_cannot_pass_a_slot(self):
        sample, = self.collect(observed=CLOCK + recorder.GRACE_MS + 1)
        self.assertEqual(sample["status"], "late")
        self.assertFalse(sample["passesDepthFloor"])

    def test_response_at_kickoff_is_late(self):
        sample, = self.collect(selected=[{**market(), "kickoff_ms": CLOCK}])
        self.assertEqual(sample["status"], "late")

    def test_stale_book_is_preserved_but_does_not_qualify(self):
        sample, = self.collect(get_book=lambda coin: {**book(coin), "time": CLOCK - 15_001})
        self.assertEqual(sample["status"], "stale")
        self.assertFalse(sample["passesDepthFloor"])

    def test_each_market_has_its_own_response(self):
        selected = [market("#1000"), market("#1010")]
        samples = self.collect(selected=selected)
        self.assertEqual([sample["coin"] for sample in samples], ["#1000", "#1010"])
        self.assertTrue(all(sample["status"] == "complete" for sample in samples))


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.settings = config()
        self.assertEqual(recorder.initialize(self.db, self.settings, CLOCK), CLOCK)

    def sample(self):
        with patch.object(recorder, "now_ms", return_value=CLOCK):
            return recorder.collect_batch([market()], CLOCK, "35", get_book=book, get_fx=fx)[0]

    def test_restart_preserves_start_even_after_kickoff(self):
        self.assertEqual(recorder.initialize(self.db, self.settings, CLOCK + 8_000_000), CLOCK)

    def test_restart_rejects_configuration_changes(self):
        changed = deepcopy(self.settings)
        changed["assumed_taker_fee_bps"] = "25"
        with self.assertRaisesRegex(ValueError, "configuration differs"):
            recorder.initialize(self.db, changed, CLOCK + 1)

    def test_new_run_rejects_already_started_fixture(self):
        with sqlite3.connect(":memory:") as other:
            with self.assertRaisesRegex(ValueError, "already kicked off"):
                recorder.initialize(other, self.settings, self.settings["markets"][0]["kickoff_ms"])

    def test_duplicate_slot_is_immutable_and_counted_once(self):
        sample = self.sample()
        recorder.store_samples(self.db, [sample])
        recorder.store_samples(self.db, [{**sample, "status": "missing"}])
        payloads = [json.loads(row[0]) for row in self.db.execute("SELECT payload FROM samples")]
        self.assertEqual(len(payloads), 1)
        self.assertEqual(payloads[0]["status"], "complete")

    def test_saved_reports_match_persisted_samples(self):
        recorder.store_samples(self.db, [self.sample()])
        with TemporaryDirectory() as directory:
            path = Path(directory)
            result = recorder.write_reports(self.db, path, CLOCK + 16_000)
            saved = json.loads((path / "report.json").read_text())
            self.assertEqual(saved, result)
            self.assertEqual(saved["markets"][0]["overall"]["scheduledSamples"], 1)
            self.assertEqual(saved["markets"][0]["overall"]["counts"]["complete"], 1)
            self.assertEqual(saved["markets"][1]["overall"]["counts"]["missing"], 1)
            self.assertNotIn("book", saved["latest"]["#1000"])
            self.assertIn("Example home win", (path / "report.md").read_text())
            self.assertFalse(list(path.glob("*.tmp")))

    def test_schedule_has_no_post_kickoff_slots(self):
        events = list(recorder.schedule(self.settings, CLOCK))
        self.assertTrue(events)
        self.assertTrue(all(slot < selected["kickoff_ms"] for slot, coin, selected in events))
        keys = [(coin, slot) for slot, coin, selected in events]
        self.assertEqual(len(keys), len(set(keys)))


class RequestBoundaryTests(unittest.TestCase):
    def test_book_only_posts_to_public_info(self):
        with patch.object(recorder, "public_json", return_value=book()) as request:
            self.assertEqual(recorder.fetch_book("#1000"), book())
        request.assert_called_once_with(recorder.INFO, body={"type": "l2Book", "coin": "#1000"})

    def test_non_ok_response_does_not_become_an_empty_book(self):
        with patch.object(recorder.requests, "Session") as session:
            response = session.return_value.__enter__.return_value.request.return_value
            response.status_code = 429
            with self.assertRaisesRegex(ValueError, "HTTP 429"):
                recorder.public_json(recorder.INFO, body={"type": "l2Book", "coin": "#1000"})


if __name__ == "__main__":
    unittest.main()
