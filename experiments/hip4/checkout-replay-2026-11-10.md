# Pronos MXN checkout replay

Cutoff 2026-11-11T02:57:45+00:00 (`1794365865000` Unix ms). Window overall.

One hypothetical order per scheduled snapshot, ticket, side and rate. The 5% ceiling applies to combined venue and builder trading fees divided by swept gross notional. Buys use an all-in MXN budget and whole shares. Sells size whole shares at the venue midpoint and require a full sweep. Customer amounts use the recorded indicative FX ask for buys and bid for sells.

HIP-4 uses a 10 bps base venue-fee scenario on both sides. Polymarket uses the recorded taker curve. Fee estimates omit settlement fees and per-fill rounding. Gross modeled builder fees use midpoint FX and count only passing quotes. The model assumes customers pay their own trading and funding costs. Gross fees exclude operating costs and do not represent credits, forecasts, or net profit.

| Listing | Capture counts | Final-hour window covered |
|---|---|---|
| Rockets win on HIP-4 | complete 5 | pending or incomplete |
| Rockets win on Polymarket | complete 3, stale 2 | pending or incomplete |

Each ticket cell shows quotes passed / scheduled and modeled builder fees in MXN.

| Venue | Builder bps | 100 buy | 300 buy | 1,000 buy | 100 sell | 300 sell | 1,000 sell | Total | Fee cap fails | Other fails |
|---|---|---|---|---|---|---|---|---|---|---|
| hip4 | 0 | 5/5 · 0.00 | 5/5 · 0.00 | 5/5 · 0.00 | 5/5 · 0.00 | 5/5 · 0.00 | 5/5 · 0.00 | 30/30 · 0.00 | 0 | — |
| hip4 | 50 | 5/5 · 2.43 | 5/5 · 7.28 | 5/5 · 24.56 | 5/5 · 2.43 | 5/5 · 7.28 | 5/5 · 24.86 | 30/30 · 68.83 | 0 | — |
| hip4 | 100 | 5/5 · 4.85 | 5/5 · 14.55 | 5/5 · 49.12 | 5/5 · 4.85 | 5/5 · 14.55 | 5/5 · 49.73 | 30/30 · 137.66 | 0 | — |
| polymarket | 0 | 3/5 · 0.00 | 3/5 · 0.00 | 3/5 · 0.00 | 3/5 · 0.00 | 3/5 · 0.00 | 3/5 · 0.00 | 18/30 · 0.00 | 0 | stale 12 |
| polymarket | 50 | 3/5 · 1.29 | 3/5 · 4.23 | 3/5 · 14.54 | 3/5 · 1.45 | 3/5 · 4.35 | 3/5 · 14.87 | 18/30 · 40.73 | 0 | stale 12 |
| polymarket | 100 | 3/5 · 2.58 | 3/5 · 8.47 | 3/5 · 29.08 | 3/5 · 2.90 | 3/5 · 8.70 | 3/5 · 29.73 | 18/30 · 81.46 | 0 | stale 12 |

| Builder bps | Combined venue tests and modeled fees MXN |
|---:|---:|
| 0 | 48/60 · 0.00 |
| 50 | 48/60 · 109.56 |
| 100 | 48/60 · 219.12 |

This replay covers one fixture before its final hour. It can compare fee scenarios at the observed prices and liquidity. Customer conversion at each rate and actual builder credits require separate evidence.

A separate synthetic regression uses a 5% Polymarket curve and a 50 bps builder rate. At a 10¢ ask the combined rate is exactly 5.00% and passes. At a 9¢ bid it is 5.05% and fails. The table uses recorded books only. [Polymarket fee formula](https://docs.polymarket.com/programs/builders/fees#fee-calculation)

Reproduce from the repository root with the recorder's local SQLite file.

```sh
python3 experiments/hip4/replay_checkout.py \
  experiments/hip4/.local-orderbooks/2026-11-11-warriors-rockets/samples.sqlite3 \
  --as-of-ms 1794365865000
```

Add `--json` for detailed counts or `--final-hour` to restrict the evaluation window. The source database stays local and is read-only during replay.
