#!/usr/bin/env python3
"""Reproducible contribution scenarios for distribution versus native markets."""
import argparse
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path


HERE = Path(__file__).resolve().parent
BPS = Decimal(10000)
ZERO = Decimal(0)


def dec(value):
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError("Inputs must be finite decimals") from exc
    if not result.is_finite():
        raise ValueError("Inputs must be finite decimals")
    return result


def nonnegative(value):
    result = dec(value)
    if result < 0:
        raise ValueError("Costs, volume and rates must be nonnegative")
    return result


def fraction(value):
    result = nonnegative(value)
    if result > 1:
        raise ValueError("Fractions must be between zero and one")
    return result


def money(value):
    return format(value.quantize(Decimal("0.01")), "f")


def wire(value):
    return format(value, ".8f").rstrip("0").rstrip(".") if value is not None else None


def sports_fee_bps(parameter, price):
    """C*r*p*(1-p) / (C*p), expressed as bps of filled cash notional."""
    rate, p = fraction(parameter), dec(price)
    if not ZERO < p < 1:
        raise ValueError("Outcome price must be strictly between zero and one")
    return rate * (1 - p) * BPS


def distribution_rates(config):
    venues = config["venues"]
    if not venues or sum((fraction(v["volume_share"]) for v in venues), ZERO) != 1:
        raise ValueError("Venue volume shares must sum to one")
    fee = venue_cost = ZERO
    for venue in venues:
        share = fraction(venue["volume_share"])
        fee += share * nonnegative(venue["builder_fee_bps"]) * fraction(venue["collection_fraction"])
        if "sports_fee_parameter" in venue:
            taker_cost = sports_fee_bps(venue["sports_fee_parameter"], venue["reference_price"])
        else:
            taker_cost = nonnegative(venue["venue_fee_bps_scenario"])
        venue_cost += share * fraction(venue["taker_fraction"]) * taker_cost
    variable = nonnegative(config["distribution"]["variable_bps"])
    return fee, fee - variable, venue_cost


def funding_bps(config):
    funding = config["funding"]
    deposit = dec(funding["average_funded_amount_mxn"])
    turnover = dec(funding["filled_notional_per_funded_peso"])
    if deposit <= 0 or turnover <= 0:
        raise ValueError("Funding amount and turnover must be positive")
    cash_cost_bps = 2 * nonnegative(funding["conversion_bps_each_way"]) + nonnegative(funding["fixed_round_trip_mxn"]) / deposit * BPS
    return cash_cost_bps / turnover


def contribution(volume, margin_bps, fixed):
    return nonnegative(volume) * margin_bps / BPS - nonnegative(fixed)


def required_volume(fixed, margin_bps):
    return nonnegative(fixed) * BPS / margin_bps if margin_bps > 0 else None


def native_margin(config, *, current=False):
    native = config["native_clob"]
    gross = ZERO if current else nonnegative(native["proposed_fee_bps"]) * fraction(native["fee_retention_fraction"])
    return gross - nonnegative(native["variable_bps_including_maker_incentives"])


def compare_native(config, volume, *, retention=Decimal(1)):
    volume, retention = nonnegative(volume), fraction(retention)
    gross_bps, routed_margin, _ = distribution_rates(config)
    native = config["native_clob"]
    routed_fixed = nonnegative(config["distribution"]["fixed_mxn"])
    native_fixed = nonnegative(native["fixed_mxn"])
    margin = native_margin(config)
    routed = contribution(volume, routed_margin, routed_fixed)
    native_profit = contribution(volume * retention, margin, native_fixed)
    months = dec(native["build_cost_recovery_months"])
    if months <= 0:
        raise ValueError("Build cost recovery months must be positive")
    extra_build = nonnegative(native["incremental_build_cost_mxn"]) - nonnegative(config["distribution"]["incremental_build_cost_mxn"])
    monthly_build_gap = extra_build / months
    gap = margin - routed_margin
    cost_gap = native_fixed - routed_fixed + monthly_build_gap
    if gap > 0:
        equal_volume_crossover = max(ZERO, cost_gap * BPS / gap)
        comparison_mode = "native_wins_above_threshold" if cost_gap >= 0 else "native_wins_at_all_volumes"
    elif gap == 0 and cost_gap <= 0:
        equal_volume_crossover = ZERO
        comparison_mode = "equal_at_all_volumes" if cost_gap == 0 else "native_wins_at_all_volumes"
    elif gap < 0 and cost_gap < 0:
        equal_volume_crossover = cost_gap * BPS / gap
        comparison_mode = "native_wins_below_threshold"
    else:
        equal_volume_crossover = None
        comparison_mode = "native_never_wins_at_positive_volume"
    required_retention = max(ZERO, (routed + native_fixed + monthly_build_gap) * BPS / (volume * margin)) if volume > 0 and margin > 0 else None
    gross_fee_gap = volume * (nonnegative(native["proposed_fee_bps"]) * fraction(native["fee_retention_fraction"]) - gross_bps) / BPS
    return {
        "native_volume_retention": wire(retention),
        "native_filled_mxn": money(volume * retention),
        "distribution_contribution_mxn": money(routed),
        "proposed_native_clob_contribution_mxn": money(native_profit),
        "native_minus_distribution_mxn": money(native_profit - routed),
        "native_minus_distribution_after_build_recovery_mxn": money(native_profit - routed - monthly_build_gap),
        "gross_native_fee_gap_at_equal_volume_mxn": money(gross_fee_gap),
        "native_required_volume_retention": wire(required_retention),
        "equal_volume_native_crossover_mxn": money(equal_volume_crossover) if equal_volume_crossover is not None else None,
        "equal_volume_comparison_mode": comparison_mode,
    }


def pool_scenario(config, volume, loss_bps):
    pool = config["native_v2_pool"]
    volume, loss_bps = nonnegative(volume), nonnegative(loss_bps)
    buy_share = fraction(pool["buy_fraction_of_filled_notional"])
    fee_bps = (nonnegative(pool["buy_fee_bps"]) * buy_share + nonnegative(pool["sell_fee_bps"]) * (1 - buy_share)) * fraction(pool["fee_retention_fraction"])
    seed = max(nonnegative(pool["seed_floor_mxn"]), volume * fraction(pool["seed_fraction_of_volume"]))
    capital_cost = seed * nonnegative(pool["annual_capital_rate"]) / 12
    loss = volume * loss_bps / BPS
    margin = fee_bps - nonnegative(pool["variable_bps"]) - loss_bps
    result = contribution(volume, margin, pool["fixed_mxn"]) - capital_cost
    return {"inventory_loss_bps": wire(loss_bps), "blended_gross_fee_bps": wire(fee_bps),
            "seed_committed_mxn": money(seed), "monthly_capital_cost_mxn": money(capital_cost),
            "inventory_loss_before_fees_mxn": money(loss),
            "inventory_loss_exceeds_initial_seed": loss > seed,
            "contribution_mxn": money(result)}


def run(config):
    gross, margin, venue_cost = distribution_rates(config)
    funding_cost = funding_bps(config)
    fixed = nonnegative(config["distribution"]["fixed_mxn"])
    funding = config["funding"]
    float_rate = fraction(funding["treasury_float_fraction_of_volume"])
    annual = nonnegative(funding["annual_capital_rate"])
    fx = fraction(funding["adverse_fx_move"])
    rows = []
    for amount in config["volumes"]:
        volume = nonnegative(amount)
        base = contribution(volume, margin, fixed)
        float_value = volume * float_rate
        float_cost = float_value * annual / 12
        fx_loss = float_value * fx
        rows.append({
            "filled_notional_mxn": money(volume),
            "gross_credited_builder_fees_mxn": money(volume * gross / BPS),
            "distribution_customer_pays_funding_mxn": money(base),
            "distribution_subsidizes_funding_mxn": money(base - volume * funding_cost / BPS),
            "distribution_subsidizes_venue_fees_mxn": money(base - volume * venue_cost / BPS),
            "distribution_subsidizes_both_mxn": money(base - volume * (venue_cost + funding_cost) / BPS),
            "treasury_float_mxn": money(float_value),
            "monthly_float_financing_cost_mxn": money(float_cost),
            "distribution_with_treasury_float_mxn": money(base - float_cost),
            "separate_adverse_fx_event_loss_mxn": money(fx_loss),
            "distribution_after_financing_and_fx_stress_mxn": money(base - float_cost - fx_loss),
            "current_zero_fee_native_clob_mxn": money(contribution(volume, native_margin(config, current=True), config["native_clob"]["fixed_mxn"])),
            "proposed_native_comparisons": [compare_native(config, volume, retention=dec(r)) for r in config["volume_retention_sensitivities"]],
            "native_v2_pool_sensitivities": [pool_scenario(config, volume, loss) for loss in config["native_v2_pool"]["inventory_loss_bps_sensitivities"]],
        })
    prices = [Decimal("0.1"), Decimal("0.5"), Decimal("0.9")]
    polymarket = next((venue for venue in config["venues"] if "sports_fee_parameter" in venue), None)
    sports_examples = []
    if polymarket is not None:
        builder_fee = nonnegative(polymarket["builder_fee_bps"])
        sports_examples = [{
            "price": wire(p),
            "venue_fee_bps_of_cash_notional": wire(sports_fee_bps(polymarket["sports_fee_parameter"], p)),
            "builder_fee_bps": wire(builder_fee),
            "with_configured_builder_total_bps": wire(sports_fee_bps(polymarket["sports_fee_parameter"], p) + builder_fee),
        } for p in prices]
    return {
        "assumptions": config,
        "effective_builder_fee_bps": wire(gross), "distribution_variable_margin_bps": wire(margin),
        "full_funding_subsidy_bps": wire(funding_cost), "weighted_venue_fee_scenario_bps": wire(venue_cost),
        "distribution_break_even_volume_mxn": money(required_volume(fixed, margin)) if margin > 0 else None,
        "funding_subsidy_break_even_volume_mxn": money(required_volume(fixed, margin - funding_cost)) if margin > funding_cost else None,
        "polymarket_sports_taker_fee_examples": sports_examples,
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assumptions", type=Path, default=HERE / "economics-assumptions.json")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = run(json.loads(args.assumptions.read_text()))
        encoded = json.dumps(result, indent=2) + "\n"
        if args.output:
            args.output.write_text(encoded)
        else:
            print(encoded, end="")
    except (ValueError, KeyError, OSError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
