"""Economic invariants and independently calculated contribution examples."""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
import unittest

import economics


def assumptions():
    return json.loads((Path(__file__).parent / "economics-assumptions.json").read_text())


class DistributionEconomicsTests(unittest.TestCase):
    def setUp(self):
        self.config = assumptions()

    def test_builder_revenue_counts_filled_cash_once_and_weights_collection(self):
        # Half of 1M at25bps*90%, half at25bps*98% =2350, not4700.
        report = economics.run(self.config)
        row = next(row for row in report["rows"] if row["filled_notional_mxn"] == "1000000.00")
        self.assertEqual(report["effective_builder_fee_bps"], "23.5")
        self.assertEqual(row["gross_credited_builder_fees_mxn"], "2350.00")
        self.assertEqual(row["distribution_customer_pays_funding_mxn"], "-3150.00")

    def test_price_sensitive_sports_fee_is_converted_to_cash_notional(self):
        # 100shares*.05*.5*.5=1.25 fee on50 cash =250bps.
        self.assertEqual(economics.sports_fee_bps("0.05", "0.5"), Decimal(250))
        self.assertEqual(economics.sports_fee_bps("0.05", "0.1"), Decimal(450))
        self.assertEqual(economics.sports_fee_bps("0.05", "0.9"), Decimal(50))
        _, _, weighted_venue_cost = economics.distribution_rates(self.config)
        self.assertEqual(weighted_venue_cost, Decimal(130))

    def test_customer_venue_fees_are_not_deducted_from_operator_by_default(self):
        baseline = economics.run(self.config)
        changed = deepcopy(self.config)
        changed["venues"][0]["venue_fee_bps_scenario"] = "1000"
        changed["venues"][1]["reference_price"] = "0.1"
        expensive = economics.run(changed)
        for before, after in zip(baseline["rows"], expensive["rows"]):
            self.assertEqual(before["distribution_customer_pays_funding_mxn"], after["distribution_customer_pays_funding_mxn"])
            self.assertLess(Decimal(after["distribution_subsidizes_venue_fees_mxn"]),
                            Decimal(before["distribution_subsidizes_venue_fees_mxn"]))

    def test_funding_cost_is_amortized_over_reused_cash_not_each_fill(self):
        # 300deposit*(50bps in+50bps out)+2fixed=5; 600fills =>83.333bps.
        self.assertAlmostEqual(economics.funding_bps(self.config), Decimal(250) / 3)
        more_turnover = deepcopy(self.config)
        more_turnover["funding"]["filled_notional_per_funded_peso"] = "4"
        self.assertAlmostEqual(economics.funding_bps(more_turnover), Decimal(125) / 3)
        no_fixed = deepcopy(self.config)
        no_fixed["funding"]["fixed_round_trip_mxn"] = "0"
        self.assertEqual(economics.funding_bps(no_fixed), Decimal(50))

    def test_subsidy_costs_are_additive_and_negative_margin_has_no_break_even(self):
        report = economics.run(self.config)
        row = next(row for row in report["rows"] if row["filled_notional_mxn"] == "1000000.00")
        self.assertIsNone(report["funding_subsidy_break_even_volume_mxn"])
        self.assertEqual(row["distribution_subsidizes_funding_mxn"], "-11483.33")
        self.assertEqual(row["distribution_subsidizes_venue_fees_mxn"], "-16150.00")
        self.assertEqual(row["distribution_subsidizes_both_mxn"], "-24483.33")
        self.assertIsNone(economics.required_volume("5000", Decimal(-1)))
        self.assertIsNone(economics.required_volume("5000", Decimal(0)))

    def test_base_break_even_and_treasury_risk_are_distinct(self):
        report = economics.run(self.config)
        self.assertEqual(report["distribution_break_even_volume_mxn"], "2702702.70")
        row = next(row for row in report["rows"] if row["filled_notional_mxn"] == "1000000.00")
        self.assertEqual(row["treasury_float_mxn"], "100000.00")
        self.assertEqual(row["monthly_float_financing_cost_mxn"], "1000.00")
        self.assertEqual(row["separate_adverse_fx_event_loss_mxn"], "2000.00")
        self.assertEqual(row["distribution_after_financing_and_fx_stress_mxn"], "-6150.00")
        # Committing float is not itself a100000 operating expense.
        self.assertEqual(row["distribution_with_treasury_float_mxn"], "-4150.00")


class NativeOpportunityCostTests(unittest.TestCase):
    def setUp(self):
        self.config = assumptions()

    def test_current_native_clob_has_zero_trading_fee_revenue(self):
        self.assertEqual(economics.native_margin(self.config, current=True), Decimal(-20))
        row = next(row for row in economics.run(self.config)["rows"] if row["filled_notional_mxn"] == "1000000.00")
        self.assertEqual(row["current_zero_fee_native_clob_mxn"], "-12000.00")

    def test_proposed_native_costs_and_volume_retention_determine_opportunity(self):
        full = economics.compare_native(self.config, "10000000")
        partial = economics.compare_native(self.config, "10000000", retention=Decimal("0.75"))
        self.assertEqual(full["distribution_contribution_mxn"], "13500.00")
        self.assertEqual(full["proposed_native_clob_contribution_mxn"], "20000.00")
        self.assertEqual(full["native_minus_distribution_mxn"], "6500.00")
        self.assertEqual(partial["native_filled_mxn"], "7500000.00")
        self.assertEqual(partial["proposed_native_clob_contribution_mxn"], "12500.00")
        self.assertEqual(partial["native_minus_distribution_mxn"], "-1000.00")
        self.assertEqual(full["native_required_volume_retention"], "0.78333333")
        self.assertEqual(full["equal_volume_native_crossover_mxn"], "4347826.09")

    def test_gross_fee_gap_is_not_equated_to_forgone_profit(self):
        comparison = economics.compare_native(self.config, "1000000")
        self.assertEqual(comparison["gross_native_fee_gap_at_equal_volume_mxn"], "2650.00")
        self.assertEqual(comparison["native_minus_distribution_mxn"], "-3850.00")
        self.assertGreater(Decimal(comparison["native_required_volume_retention"]), Decimal(1))

    def test_build_cost_recovery_changes_crossover_not_operating_contribution(self):
        baseline = economics.compare_native(self.config, "10000000")
        build = deepcopy(self.config)
        build["native_clob"]["incremental_build_cost_mxn"] = "120000"
        comparison = economics.compare_native(build, "10000000")
        self.assertEqual(comparison["native_minus_distribution_mxn"], baseline["native_minus_distribution_mxn"])
        self.assertEqual(comparison["native_minus_distribution_after_build_recovery_mxn"], "-13500.00")
        self.assertEqual(comparison["equal_volume_native_crossover_mxn"], "21739130.43")
        self.assertGreater(Decimal(comparison["native_required_volume_retention"]), Decimal(1))

    def test_native_already_cheaper_and_higher_margin_has_zero_volume_threshold(self):
        cheaper = deepcopy(self.config)
        cheaper["native_clob"]["fixed_mxn"] = "1000"
        comparison = economics.compare_native(cheaper, "1000000")
        self.assertEqual(comparison["equal_volume_native_crossover_mxn"], "0.00")
        self.assertEqual(comparison["native_required_volume_retention"], "0")

    def test_amortized_build_savings_can_cover_native_fixed_cost_gap(self):
        cheaper_build = deepcopy(self.config)
        cheaper_build["distribution"]["incremental_build_cost_mxn"] = "120000"
        comparison = economics.compare_native(cheaper_build, "1000000")
        self.assertEqual(comparison["equal_volume_native_crossover_mxn"], "0.00")
        self.assertEqual(comparison["native_required_volume_retention"], "0")

    def test_negative_native_margin_cannot_catch_positive_distribution_margin(self):
        unprofitable = deepcopy(self.config)
        unprofitable["native_clob"]["proposed_fee_bps"] = "10"
        comparison = economics.compare_native(unprofitable, "1000000")
        self.assertIsNone(comparison["equal_volume_native_crossover_mxn"])
        self.assertIsNone(comparison["native_required_volume_retention"])

    def test_cheaper_native_fixed_cost_with_lower_margin_wins_only_below_crossover(self):
        cheaper = deepcopy(self.config)
        cheaper["native_clob"]["fixed_mxn"] = "1000"
        cheaper["native_clob"]["proposed_fee_bps"] = "30"
        small = economics.compare_native(cheaper, "1000000")
        large = economics.compare_native(cheaper, "10000000")
        self.assertEqual(small["equal_volume_comparison_mode"], "native_wins_below_threshold")
        self.assertEqual(small["equal_volume_native_crossover_mxn"], "4705882.35")
        self.assertEqual(small["native_minus_distribution_mxn"], "3150.00")
        self.assertEqual(large["native_minus_distribution_mxn"], "-4500.00")

    def test_equal_margins_distinguish_equality_from_fixed_cost_advantage(self):
        same = deepcopy(self.config)
        same["native_clob"]["proposed_fee_bps"] = "38.5"
        same["native_clob"]["fixed_mxn"] = "5000"
        equal = economics.compare_native(same, "1000000")
        self.assertEqual(equal["equal_volume_comparison_mode"], "equal_at_all_volumes")
        self.assertEqual(equal["native_minus_distribution_mxn"], "0.00")
        same["native_clob"]["fixed_mxn"] = "1000"
        cheaper = economics.compare_native(same, "1000000")
        self.assertEqual(cheaper["equal_volume_comparison_mode"], "native_wins_at_all_volumes")
        self.assertEqual(cheaper["equal_volume_native_crossover_mxn"], "0.00")
        same["native_clob"]["fixed_mxn"] = "10000"
        expensive = economics.compare_native(same, "1000000")
        self.assertEqual(expensive["equal_volume_comparison_mode"], "native_never_wins_at_positive_volume")
        self.assertIsNone(expensive["equal_volume_native_crossover_mxn"])


class PoolEconomicsTests(unittest.TestCase):
    def setUp(self):
        self.config = assumptions()

    def test_buy_only_v2_fee_is_blended_over_buy_and_sell_notional(self):
        balanced = economics.pool_scenario(self.config, "1000000", "25")
        self.assertEqual(balanced["blended_gross_fee_bps"], "100")
        self.assertEqual(balanced["contribution_mxn"], "-7500.00")
        buys = deepcopy(self.config)
        buys["native_v2_pool"]["buy_fraction_of_filled_notional"] = "1"
        self.assertEqual(economics.pool_scenario(buys, "1000000", "25")["blended_gross_fee_bps"], "200")
        buys["native_v2_pool"]["buy_fraction_of_filled_notional"] = "0"
        self.assertEqual(economics.pool_scenario(buys, "1000000", "25")["blended_gross_fee_bps"], "0")

    def test_seed_is_committed_principal_only_financing_cost_is_an_expense(self):
        row = economics.pool_scenario(self.config, "1000000", "25")
        self.assertEqual(row["seed_committed_mxn"], "100000.00")
        self.assertEqual(row["monthly_capital_cost_mxn"], "1000.00")
        self.assertEqual(row["inventory_loss_before_fees_mxn"], "2500.00")
        neutral = deepcopy(self.config)
        pool = neutral["native_v2_pool"]
        for name in ("buy_fee_bps", "sell_fee_bps", "variable_bps", "fixed_mxn", "annual_capital_rate"):
            pool[name] = "0"
        result = economics.pool_scenario(neutral, "100000", "0")
        self.assertEqual(result["seed_committed_mxn"], "20000.00")
        self.assertEqual(result["contribution_mxn"], "0.00")

    def test_inventory_losses_are_separate_from_fee_income_and_flag_seed_overrun(self):
        mild = economics.pool_scenario(self.config, "1000000", "25")
        severe = economics.pool_scenario(self.config, "1000000", "200")
        self.assertEqual(severe["contribution_mxn"], "-25000.00")
        self.assertEqual(Decimal(mild["contribution_mxn"]) - Decimal(severe["contribution_mxn"]), Decimal(17500))
        self.assertFalse(severe["inventory_loss_exceeds_initial_seed"])
        self.assertTrue(economics.pool_scenario(self.config, "1000000", "2000")["inventory_loss_exceeds_initial_seed"])


class InputValidationTests(unittest.TestCase):
    def test_invalid_decimals_fail_as_validation_errors(self):
        for value in ("NaN", "Infinity", "-Infinity", "nonsense"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                economics.dec(value)

    def test_bounds_and_positive_denominators_are_enforced(self):
        for value in ("-0.01", "1.01"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                economics.fraction(value)
        with self.assertRaises(ValueError):
            economics.contribution("-1", Decimal(1), "0")
        for price in ("0", "1", "-0.1", "1.1"):
            with self.subTest(price=price), self.assertRaises(ValueError):
                economics.sports_fee_bps("0.05", price)
        for field in ("average_funded_amount_mxn", "filled_notional_per_funded_peso"):
            invalid = assumptions()
            invalid["funding"][field] = "0"
            with self.subTest(field=field), self.assertRaises(ValueError):
                economics.funding_bps(invalid)
        invalid = assumptions()
        invalid["native_clob"]["build_cost_recovery_months"] = "0"
        with self.assertRaises(ValueError):
            economics.compare_native(invalid, "1000000")

    def test_venue_mix_must_sum_to_one_and_capture_fraction_cannot_exceed_one(self):
        invalid = assumptions()
        invalid["venues"][0]["volume_share"] = "0.4"
        with self.assertRaises(ValueError):
            economics.distribution_rates(invalid)
        invalid = assumptions()
        invalid["venues"][0]["collection_fraction"] = "1.01"
        with self.assertRaises(ValueError):
            economics.distribution_rates(invalid)


if __name__ == "__main__":
    unittest.main()
