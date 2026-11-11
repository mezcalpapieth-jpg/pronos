import unittest

from orderbook_report import HOUR_MS, build_report, iter_slots
from orderbook_scoring import score_orderbook


MIN = 60_000
KICKOFF = 2 * HOUR_MS
MARKET = {"coin": "#1020", "label": "Example", "kickoff_ms": KICKOFF, "source_url": "https://example.com/market"}


def sample(slot, *, status="complete", qualifies=True, tickets=()):
    return {"coin": MARKET["coin"], "slot_ms": slot, "status": status,
            "passesDepthFloor": qualifies, "tickets": tickets}


def ticket(amount, *, buy="full", sell="full", points="1.75"):
    return {"ticketMXN": amount, "buy": {"status": buy, "slippagePoints": points},
            "sell": {"status": sell, "slippagePoints": points}}


class OrderbookReportTests(unittest.TestCase):
    def test_schedule_resets_at_final_hour_and_excludes_kickoff(self):
        self.assertEqual(list(iter_slots(13 * MIN, KICKOFF, KICKOFF, 20 * MIN, 15 * MIN)),
                         [13 * MIN, 33 * MIN, 53 * MIN, HOUR_MS, 75 * MIN, 90 * MIN, 105 * MIN])
        self.assertEqual(list(iter_slots(73 * MIN, 88 * MIN, KICKOFF, 20 * MIN, 15 * MIN)),
                         [73 * MIN, 88 * MIN])
        self.assertEqual(list(iter_slots(73 * MIN, 72 * MIN, KICKOFF, 20 * MIN, 15 * MIN)), [])

    def test_inferred_downtime_and_statuses_use_all_scheduled_slots(self):
        samples = [
            sample(0, tickets=[ticket(100), ticket(300, buy="partial"), ticket(1000, buy="partial", sell="unfilled")]),
            sample(5 * MIN, tickets=[ticket(100, sell="partial")]),
            sample(10 * MIN, qualifies=False),
            sample(15 * MIN, status="stale", tickets=[ticket(100, points="100")]),
            sample(20 * MIN, status="one_sided"),
            sample(25 * MIN, status="missing_fx"),
            sample(35 * MIN), sample(40 * MIN), sample(45 * MIN),
        ]
        market = build_report([MARKET], samples, start_ms=0, end_ms=45 * MIN, min_samples=4)["markets"][0]
        self.assertEqual(market["source_url"], MARKET["source_url"])
        overall = market["overall"]
        self.assertEqual(overall["scheduledSamples"], 10)
        self.assertEqual(overall["counts"], {"complete": 6, "missing": 1, "stale": 1, "one_sided": 1, "missing_fx": 1})
        self.assertEqual(overall["qualifiedSamples"], 5)
        self.assertEqual(overall["qualifyingPct"], 50)
        self.assertEqual(overall["status"], "below_target")
        small, medium, large = overall["tickets"]
        self.assertEqual(small["buy"]["fullVisibleRatePct"], 20)
        self.assertEqual(small["buy"]["worstSlippagePoints"], "1.75")
        self.assertEqual(small["sell"]["fullVisibleRatePct"], 10)
        self.assertEqual(medium["buy"]["fullVisibleRatePct"], 0)
        self.assertEqual(medium["sell"]["fullVisibleRatePct"], 10)
        self.assertEqual(large["buy"]["slippageSamples"], 0)
        self.assertIsNone(large["buy"]["p95SlippagePoints"])
        self.assertIsNone(market["lastHour"]["qualifyingPct"])

    def test_final_hour_can_pass_exactly_ninety_percent_independently(self):
        slots = list(iter_slots(0, KICKOFF, KICKOFF, 15 * MIN, 6 * MIN))
        samples = [sample(slot, qualifies=slot >= HOUR_MS) for slot in slots[:-1]]
        report = build_report([MARKET], samples, start_ms=0, end_ms=KICKOFF,
                              interval_ms=15 * MIN, near_interval_ms=6 * MIN, min_samples=2)
        market = report["markets"][0]
        self.assertEqual(report["targetQualifyingPct"], 90)
        self.assertEqual(market["overall"]["status"], "below_target")
        self.assertEqual(market["lastHour"]["scheduledSamples"], 10)
        self.assertEqual(market["lastHour"]["qualifyingPct"], 90)
        self.assertEqual(market["lastHour"]["status"], "passes")

    def test_grace_waits_for_response_then_counts_missing(self):
        before = build_report([MARKET], [], start_ms=0, end_ms=14_999, grace_ms=15_000)
        self.assertEqual(before["markets"][0]["overall"]["scheduledSamples"], 0)
        arrived = build_report([MARKET], [sample(0)], start_ms=0, end_ms=1_000, grace_ms=15_000)
        self.assertEqual(arrived["markets"][0]["overall"]["scheduledSamples"], 1)
        self.assertEqual(arrived["markets"][0]["overall"]["counts"]["missing"], 0)
        expired = build_report([MARKET], [], start_ms=0, end_ms=15_000, grace_ms=15_000)
        self.assertEqual(expired["markets"][0]["overall"]["counts"]["missing"], 1)
        self.assertEqual(expired["graceMs"], 15_000)
        with self.assertRaises(ValueError):
            build_report([MARKET], [], start_ms=0, end_ms=0, grace_ms=-1)

    def test_final_hour_waits_until_kickoff_and_requires_full_start(self):
        slots = list(iter_slots(HOUR_MS, KICKOFF, KICKOFF, 5 * MIN, MIN))
        samples = [sample(slot) for slot in slots]
        before = build_report([MARKET], samples, start_ms=HOUR_MS, end_ms=KICKOFF - 1)
        self.assertEqual(before["markets"][0]["lastHour"]["provisionalReasons"], ["window_not_covered"])
        complete = build_report([MARKET], samples, start_ms=HOUR_MS, end_ms=KICKOFF)
        self.assertEqual(complete["markets"][0]["lastHour"]["status"], "passes")
        partial = build_report([MARKET], samples[1:], start_ms=HOUR_MS + MIN, end_ms=KICKOFF)
        self.assertEqual(partial["markets"][0]["lastHour"]["status"], "provisional")
        self.assertIn("window_not_covered", partial["markets"][0]["lastHour"]["provisionalReasons"])

    def test_sparse_and_partial_windows_stay_provisional(self):
        start = 70 * MIN
        samples = [sample(start), sample(start + MIN), sample(start + 2 * MIN, status="empty")]
        market = build_report([MARKET], samples, start_ms=start, end_ms=start + MIN, min_samples=3)["markets"][0]
        self.assertEqual(market["overall"]["qualifyingPct"], 100)
        self.assertEqual(market["overall"]["provisionalReasons"], ["too_few_complete_samples"])
        self.assertEqual(market["lastHour"]["status"], "provisional")
        self.assertEqual(market["lastHour"]["provisionalReasons"], ["window_not_covered", "too_few_complete_samples"])

    def test_slippage_nearest_rank_and_duplicate_slots(self):
        start = HOUR_MS
        samples = [sample(start + minute * MIN, tickets=[ticket(100, points=str(minute))]) for minute in range(20)]
        samples.insert(0, sample(start, tickets=[ticket(100, points="99")]))
        samples.append(sample(start + 1, tickets=[ticket(100, points="99")]))
        market = build_report([MARKET], samples, start_ms=start, end_ms=start + 19 * MIN)["markets"][0]
        buy = market["overall"]["tickets"][0]["buy"]
        self.assertEqual(buy, {"fullVisibleSamples": 20, "fullVisibleRatePct": 100,
                               "slippageSamples": 20, "p95SlippagePoints": "18", "worstSlippagePoints": "19"})
        self.assertEqual(market["lastHour"]["provisionalReasons"], ["window_not_covered"])

    def test_scoring_contract_feeds_report(self):
        book = {"time": 1, "levels": [[{"px": "0.49", "sz": "500"}], [{"px": "0.51", "sz": "500"}]]}
        score = score_orderbook(book, mxn_per_usd="20", fee_bps="25", observed_at_ms=1)
        row = {**score, "coin": MARKET["coin"], "slot_ms": 0}
        report = build_report([MARKET], [row], start_ms=0, end_ms=0, min_samples=1)
        overall = report["markets"][0]["overall"]
        self.assertEqual(overall["status"], "passes")
        self.assertEqual([r["buy"]["fullVisibleRatePct"] for r in overall["tickets"]], [100, 100, 100])
        self.assertEqual(overall["tickets"][0]["buy"]["worstSlippagePoints"], "1.1275")


if __name__ == "__main__":
    unittest.main()
