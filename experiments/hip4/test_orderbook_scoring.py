import unittest
from decimal import Decimal

from orderbook_scoring import score_orderbook


def book(bids, asks, time=1000):
    return {"time": time, "levels": [[{"px": price, "sz": size} for price, size in side] for side in (bids, asks)]}


class OrderbookScoringTests(unittest.TestCase):
    def score(self, levels, fee_bps=25, mxn_per_usd=20):
        return score_orderbook(levels, mxn_per_usd=mxn_per_usd, fee_bps=fee_bps, observed_at_ms=1200)

    def test_tickets_share_one_midpoint_and_match_whole_share_sizes_on_both_sides(self):
        report = self.score(book([("0.49", "200")], [("0.51", "200")]), mxn_per_usd="19.3")
        self.assertEqual(report["status"], "complete")
        self.assertEqual(report["midpoint"], "0.5")
        self.assertEqual(report["spreadPoints"], "2")
        self.assertEqual([t["ticketMXN"] for t in report["tickets"]], [100, 300, 1000])
        self.assertEqual([t["requestedShares"] for t in report["tickets"]], [10, 31, 103])
        self.assertEqual([t["referenceNotionalMXN"] for t in report["tickets"]], ["96.5", "299.15", "993.95"])
        for ticket in report["tickets"]:
            self.assertEqual(ticket["buy"]["visibleShares"], str(ticket["requestedShares"]))
            self.assertEqual(ticket["sell"]["visibleShares"], str(ticket["requestedShares"]))

    def test_fill_walk_prices_partials_and_slippage_direction_after_fees(self):
        report = self.score(book([("0.48", "8"), ("0.49", "8")], [("0.52", "10"), ("0.51", "6")]))
        small, medium, large = report["tickets"]
        buy, sell = small["buy"], small["sell"]
        self.assertEqual((buy["status"], sell["status"]), ("full", "full"))
        self.assertEqual((buy["grossVwap"], sell["grossVwap"]), ("0.514", "0.488"))
        self.assertEqual((buy["feeAdjustedVwap"], sell["feeAdjustedVwap"]), ("0.515285", "0.48678"))
        self.assertEqual((buy["feeAdjustedWorstPrice"], sell["feeAdjustedWorstPrice"]), ("0.5213", "0.4788"))
        self.assertEqual((buy["slippagePoints"], sell["slippagePoints"]), ("1.5285", "1.322"))
        self.assertEqual((buy["feeAdjustedNotionalMXN"], sell["feeAdjustedNotionalMXN"]), ("103.057", "97.356"))
        self.assertEqual((medium["buy"]["status"], medium["buy"]["visibleShares"]), ("partial", "16"))
        self.assertAlmostEqual(float(medium["sell"]["coveragePct"]), 100 * 16 / 30)
        self.assertEqual((large["sell"]["status"], large["sell"]["coveragePct"]), ("partial", "16"))

    def test_depth_checks_adjusted_prices_and_requires_both_side_notionals(self):
        bids = [("0.47", "5"), ("0.48", "100"), ("0.49", "61")]
        asks = [("0.53", "10"), ("0.52", "100"), ("0.51", "61")]
        report = self.score(book(bids, asks))
        depth = report["depthWithinTwoPoints"]
        self.assertEqual(depth["buy"]["visibleShares"], "61")
        self.assertEqual(depth["sell"]["visibleShares"], "61")
        self.assertEqual(depth["sell"]["referenceNotionalMXN"], "610")
        self.assertEqual(depth["sell"]["feeAdjustedNotionalMXN"], "596.3055")
        self.assertEqual(depth["buy"]["feeAdjustedNotionalMXN"], "623.7555")
        self.assertFalse(report["passesDepthFloor"])
        self.assertTrue(self.score(book(bids[:-1] + [("0.49", "62")], asks))["passesDepthFloor"])
        no_fee = self.score(book(bids, asks), fee_bps=0)
        self.assertEqual(no_fee["depthWithinTwoPoints"]["sell"]["visibleShares"], "161")
        self.assertEqual(no_fee["depthWithinTwoPoints"]["buy"]["visibleShares"], "161")
        self.assertTrue(no_fee["passesDepthFloor"])

    def test_missing_stale_empty_crossed_and_bad_books_are_distinct(self):
        cases = [
            (None, "missing"),
            (book([], [], time=16_200), "stale"),
            (book([], []), "empty"),
            (book([], [("0.51", "30")]), "one_sided"),
            (book([("0.52", "30")], [("0.52", "30")]), "locked_or_crossed"),
            (book([("0.52", "30")], [("0.51", "30")]), "locked_or_crossed"),
            (book([("0.50", "NaN")], [("0.51", "30")]), "invalid"),
            ({"time": 1000, "levels": [{"px": "0.50", "sz": "3"}, []]}, "invalid"),
        ]
        for levels, status in cases:
            with self.subTest(status=status):
                report = self.score(levels)
                self.assertEqual(report["status"], status)
                self.assertFalse(report["passesDepthFloor"])
                self.assertEqual(report["tickets"], [])

    def test_ticket_below_one_share_has_no_coverage_or_price(self):
        report = self.score(book([("0.49", "100")], [("0.51", "100")]), mxn_per_usd=1000)
        small, _, large = report["tickets"]
        self.assertEqual(small["requestedShares"], 0)
        self.assertEqual(small["buy"]["status"], "below_one_share")
        self.assertIsNone(small["buy"]["coveragePct"])
        self.assertIsNone(small["buy"]["feeAdjustedVwap"])
        self.assertEqual(large["requestedShares"], 2)
        self.assertEqual(large["sell"]["status"], "full")

    def test_config_rejects_invalid_fx_or_fee(self):
        for fx, fee in [(0, 25), ("bad", 25), ("Infinity", 25), (20, -1), (20, Decimal("NaN")), (20, 10_000)]:
            with self.subTest(fx=fx, fee=fee), self.assertRaises(ValueError):
                self.score(None, fee_bps=fee, mxn_per_usd=fx)

    def test_extreme_finite_wire_numbers_fail_closed(self):
        for price, size in [("0.49", "1e999999"), ("1e-999999", "10"),
                            ("0.49", "9" * 100), ("0.49", "0e-999999")]:
            with self.subTest(price=price, size=size):
                result = self.score(book([(price, size)], [("0.51", "30")]))
                self.assertEqual(result["status"], "invalid")
                self.assertFalse(result["passesDepthFloor"])

        # Even bounded inputs can exceed Decimal's integer-division precision.
        result = self.score(book([("1e-30", "100")], [("2e-30", "100")]), mxn_per_usd="1e-30")
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["tickets"], [])
        with self.assertRaises(ValueError):
            self.score(None, mxn_per_usd="1e999999")
        large_valid = self.score(book([("0.49", "1e30")], [("0.51", "1e30")]), mxn_per_usd="1e30")
        self.assertEqual(large_valid["status"], "complete")
        self.assertTrue(large_valid["passesDepthFloor"])

    def test_freshness_boundary_in_both_clock_directions(self):
        levels = book([("0.49", "100")], [("0.51", "100")], time=100_000)
        for observed, status in [(85_000, "stale"), (85_001, "complete"),
                                 (114_999, "complete"), (115_000, "stale")]:
            with self.subTest(observed=observed):
                result = score_orderbook(levels, mxn_per_usd=20, fee_bps=25, observed_at_ms=observed)
                self.assertEqual(result["status"], status)

    def test_budget_buy_caps_total_cash_including_fees(self):
        levels = book([("0.49", "1000")], [("0.5", "1000")])
        fee_quote = self.score(levels)["tickets"][0]["budgetBuy"]
        self.assertEqual(fee_quote["requestedBudgetMXN"], 100)
        self.assertEqual(fee_quote["wholeShares"], 9)
        self.assertEqual(fee_quote["actualSpendMXN"], "90.225")
        self.assertEqual(fee_quote["remainingBudgetMXN"], "9.775")
        self.assertEqual(fee_quote["budgetUtilizationPct"], "90.225")
        self.assertEqual(fee_quote["limitation"], "budget")
        self.assertNotIn("coveragePct", fee_quote)
        no_fee_quote = self.score(levels, fee_bps=0)["tickets"][0]["budgetBuy"]
        self.assertEqual(no_fee_quote["wholeShares"], 10)
        self.assertEqual(no_fee_quote["actualSpendMXN"], "100")
        self.assertEqual(no_fee_quote["remainingBudgetMXN"], "0")

    def test_budget_buy_uses_fractional_levels_but_whole_order_quantity(self):
        levels = book([("0.49", "100")], [("0.5", "1.5"), ("0.6", "10")])
        small, medium, _ = self.score(levels)["tickets"]
        quote = small["budgetBuy"]
        self.assertEqual(quote["status"], "quoted")
        self.assertEqual(quote["wholeShares"], 8)
        self.assertEqual(quote["actualSpendMXN"], "93.2325")
        self.assertEqual(quote["remainingBudgetMXN"], "6.7675")
        self.assertEqual(quote["worstPrice"], "0.6")
        self.assertEqual(quote["limitation"], "budget")
        self.assertEqual(medium["budgetBuy"]["wholeShares"], 11)
        self.assertEqual(medium["budgetBuy"]["actualSpendMXN"], "129.3225")
        self.assertEqual(medium["budgetBuy"]["limitation"], "displayed_depth")
        # Historical equal-position comparisons keep their original semantics.
        self.assertEqual(small["requestedShares"], 10)
        self.assertGreater(Decimal(small["buy"]["feeAdjustedNotionalMXN"]), 100)

    def test_budget_buy_marks_no_affordable_or_no_visible_whole_share(self):
        high_unit_price = self.score(book([("0.49", "100")], [("0.51", "100")]), mxn_per_usd=1000)
        quote = high_unit_price["tickets"][0]["budgetBuy"]
        self.assertEqual((quote["status"], quote["limitation"]), ("below_one_share", "budget"))
        self.assertEqual(quote["actualSpendMXN"], "0")
        self.assertEqual(quote["remainingBudgetMXN"], "100")
        fractional_depth = self.score(book([("0.49", "100")], [("0.51", "0.5")]))
        quote = fractional_depth["tickets"][0]["budgetBuy"]
        self.assertEqual((quote["status"], quote["limitation"]), ("below_one_share", "displayed_depth"))

    def test_budget_buy_handles_exact_displayed_and_cash_limit(self):
        quote = self.score(book([("0.49", "100")], [("0.5", "10")]), fee_bps=0)["tickets"][0]["budgetBuy"]
        self.assertEqual(quote["wholeShares"], 10)
        self.assertEqual(quote["limitation"], "budget_and_displayed_depth")


if __name__ == "__main__":
    unittest.main()
