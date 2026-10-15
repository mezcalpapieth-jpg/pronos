# Combinada Settlement and Stock Audit

Audit date: 2026-10-16 (Europe/Rome). Production read-only snapshot: 2026-10-15, approximately 22:50 UTC.

## Scope

- All 94 combinada tickets across all cycles; 85 belong to the current October cycle.
- Compared each pick with the market's recorded status/outcome and each ticket with its entry, payout and refund ledger records.
- No live balances, outcomes or ticket statuses were changed during this audit.
- Code changes are isolated to Pointbreak. At audit time, no code had been committed, pushed or deployed for this request.

## Findings

1. Completed tickets were settled when their owner visited `/api/points/parlays`. The dedicated settlement handler exists, but is absent from the repository's cron/indexer schedule. This leaves offline users' completed tickets open.
2. The old Admin view inferred `Ganada` from market results while using the stored payout to calculate realized PnL. PostgreSQL's string `"0.000000"` is truthy, so the fallback to potential payout did not run. A still-open winner therefore appeared as a realized loss equal to its stake.
3. All 94 entry debits match the ticket's stake. All 17 settled wins and both void refunds match their ledger credits. No duplicate payments, wrong recipients, orphan parlay ledger entries or payments to losing tickets were found.
4. Three winners have no payout record and are still stored as open. Six already-losing tickets also remain open. Four tickets genuinely await a result.

## Unpaid Winners

| Ticket | User | Stake MXNP | Payout Due MXNP | Net Profit MXNP |
| --- | --- | ---: | ---: | ---: |
| 84 | @soy_dano | 100.00 | 211.00 | 111.00 |
| 86 | @reneborquez30 | 100.00 | 2,500.00 | 2,400.00 |
| 88 | @paulvazquezp | 200.00 | 1,478.00 | 1,278.00 |
| Total | | 400.00 | 4,189.00 | 3,789.00 |

Ticket #88 won under the recorded resolution: parent temperature market #352434 resolved at a maximum of 24.1 C; its >=25 C child #352438 resolved to No. The ticket selected No. The recorded manual confirmation was 2026-10-15 15:24:28 UTC.

Pending losing-ticket closure: #11, #33, #48, #89, #90 and #94. Still awaiting results: #13, #91, #92 and #93.

## Reconciliation Totals

| Stored Status | Result From Current Markets | Tickets | Credits MXNP |
| --- | --- | ---: | ---: |
| won | won | 17 | 27,435.475000 |
| void | void | 2 | 600.000000 |
| lost | lost | 62 | 0.000000 |
| open | won | 3 | 0.000000 |
| open | lost | 6 | 0.000000 |
| open | open | 4 | 0.000000 |

Total already credited: 28,035.475000 MXNP. Outstanding winning-ticket payouts: 4,189.000000 MXNP.
These are ticket-ledger reconciliations against recorded resolutions, not an independent re-adjudication of every event or a reconstruction of every user's unrelated wallet activity.

## Stock Usage

| Metric | Current Cycle |
| --- | ---: |
| Investors | 8 |
| Active operators in the cycle | 184 |
| Stock participation | 4.35% |
| User trades | 11 |
| Buys / sells | 10 / 1 |
| Traded tickers | 6 |
| Gross traded volume, excluding fees | 5,114.845553 MXNP |
| Purchase debits, including fees | 5,024.691278 MXNP |
| Sale proceeds, after fees | 95.078776 MXNP |
| Fees | 5.114849 MXNP |

Stock activity in the snapshot runs from 2026-10-14 15:33:30 UTC to 2026-10-15 22:15:04 UTC. This is early adoption data, not enough history to conclude that the feature succeeded or failed.

## Implemented Locally

- Admin now separates the stored ticket status, current leg-derived result, pending settlement, credited payout and realized PnL.
- Realized PnL is not displayed as a loss while a ticket is still open.
- Ledger mismatches are flagged; cycle totals cover all tickets, not just the displayed detail limit.
- Monetary audit totals retain six-decimal precision until final display rounding.
- Audit and settlement use the same result rules; missing market rows cannot silently disappear and produce a false win.
- Estrategias now has separate Combinadas, Long Hold and Stock views. Stock includes investor participation, per-asset volume, holdings, realized/open PnL and recent trades. Missing/stale prices are identified rather than treated as fresh zeros.
- Read-only production verification covered all generated audit queries. Unit/regression tests, real SQL settlement/rollback tests, a Points build and mocked desktop/mobile browser checks passed.

## Approval Still Required

- Credit the three winning tickets and close the six losing tickets listed above.
- Enable ongoing automatic combinada settlement through the minute indexer, without requiring Portfolio visits.
- Scheduling and production behavior remain unchanged pending approval and a subsequent deployment.

## All Tickets

Amounts below are ledger amounts in MXNP. `Due` is a winning/refund amount awaiting settlement, not money already credited.

| ID | User | Cycle | Stored | Current Result | Stake | Credited | Due |
| ---: | --- | ---: | --- | --- | ---: | ---: | ---: |
| 1 | @frmm | general | won | won | 100.000000 | 729.000000 | 0.000000 |
| 2 | @frmm | general | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 3 | @gg14 | general | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 4 | @parzival19 | general | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 5 | @parzival19 | general | lost | lost | 150.000000 | 0.000000 | 0.000000 |
| 6 | @parzival19 | general | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 7 | @parzival19 | general | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 8 | @parzival19 | general | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 9 | @parzival19 | general | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 10 | @parzival19 | 5 | lost | lost | 700.000000 | 0.000000 | 0.000000 |
| 11 | @genaro_hr | 5 | open | lost | 650.000000 | 0.000000 | 0.000000 |
| 12 | @mrtriangulo | 5 | won | won | 300.000000 | 441.000000 | 0.000000 |
| 13 | @soy_dano | 5 | open | open | 100.000000 | 0.000000 | 0.000000 |
| 14 | @parzival19 | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 15 | @parzival19 | 5 | lost | lost | 240.000000 | 0.000000 | 0.000000 |
| 16 | @champeleon | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 17 | @mrtriangulo | 5 | lost | lost | 1100.000000 | 0.000000 | 0.000000 |
| 18 | @daniel_r8 | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 19 | @karimvega | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 20 | @parzival19 | 5 | lost | lost | 300.000000 | 0.000000 | 0.000000 |
| 21 | @champeleon | 5 | won | won | 200.000000 | 506.000000 | 0.000000 |
| 22 | @reneborquez30 | 5 | lost | lost | 300.000000 | 0.000000 | 0.000000 |
| 23 | @swtdpstn_ | 5 | won | won | 920.000000 | 2419.600000 | 0.000000 |
| 24 | @memicks | 5 | lost | lost | 25.000000 | 0.000000 | 0.000000 |
| 25 | @memicks | 5 | lost | lost | 250.000000 | 0.000000 | 0.000000 |
| 26 | @soy_dano | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 27 | @romi | 5 | lost | lost | 250.000000 | 0.000000 | 0.000000 |
| 28 | @soy_dano | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 29 | @frmm | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 30 | @memicks | 5 | lost | lost | 800.000000 | 0.000000 | 0.000000 |
| 31 | @reneborquez30 | 5 | lost | lost | 300.000000 | 0.000000 | 0.000000 |
| 32 | @swtdpstn_ | 5 | won | won | 300.000000 | 738.000000 | 0.000000 |
| 33 | @chuycota6682344287 | 5 | open | lost | 200.000000 | 0.000000 | 0.000000 |
| 34 | @danielrr | 5 | won | won | 1000.000000 | 2010.000000 | 0.000000 |
| 35 | @romi | 5 | won | won | 2000.000000 | 3500.000000 | 0.000000 |
| 36 | @mrtriangulo | 5 | won | won | 200.000000 | 274.000000 | 0.000000 |
| 37 | @reneborquez30 | 5 | lost | lost | 180.000000 | 0.000000 | 0.000000 |
| 38 | @parzival19 | 5 | lost | lost | 150.000000 | 0.000000 | 0.000000 |
| 39 | @alex_grandson | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 40 | @karimvega | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 41 | @mrtriangulo | 5 | lost | lost | 510.000000 | 0.000000 | 0.000000 |
| 42 | @champeleon | 5 | won | won | 200.000000 | 5000.000000 | 0.000000 |
| 43 | @karimvega | 5 | won | won | 202.000000 | 1809.920000 | 0.000000 |
| 44 | @frmm | 5 | won | won | 200.000000 | 1516.000000 | 0.000000 |
| 45 | @danielrr | 5 | won | won | 1298.700000 | 4999.995000 | 0.000000 |
| 46 | @champeleon | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 47 | @mrtriangulo | 5 | lost | lost | 260.000000 | 0.000000 | 0.000000 |
| 48 | @chuycota6682344287 | 5 | open | lost | 1000.000000 | 0.000000 | 0.000000 |
| 49 | @parzival19 | 5 | lost | lost | 250.000000 | 0.000000 | 0.000000 |
| 50 | @reneborquez30 | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 51 | @danielrr | 5 | lost | lost | 833.000000 | 0.000000 | 0.000000 |
| 52 | @champeleon | 5 | lost | lost | 400.000000 | 0.000000 | 0.000000 |
| 53 | @karimvega | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 54 | @romi | 5 | lost | lost | 1000.000000 | 0.000000 | 0.000000 |
| 55 | @soy_dano | 5 | lost | lost | 92.500000 | 0.000000 | 0.000000 |
| 56 | @ricardo_nes | 5 | lost | lost | 1900.000000 | 0.000000 | 0.000000 |
| 57 | @mrtriangulo | 5 | lost | lost | 204.000000 | 0.000000 | 0.000000 |
| 58 | @mrtriangulo | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 59 | @danielrr | 5 | lost | lost | 851.780000 | 0.000000 | 0.000000 |
| 60 | @mansonbc1 | 5 | won | won | 100.000000 | 325.000000 | 0.000000 |
| 61 | @mexico | 5 | lost | lost | 400.000000 | 0.000000 | 0.000000 |
| 62 | @karimvega | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 63 | @junior121 | 5 | lost | lost | 25.000000 | 0.000000 | 0.000000 |
| 64 | @junior121 | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 65 | @frmm | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 66 | @anibaliv | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 67 | @alex_grandson | 5 | void | void | 400.000000 | 400.000000 | 0.000000 |
| 68 | @mansonbc1 | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 69 | @alan_pareddes | 5 | lost | lost | 700.000000 | 0.000000 | 0.000000 |
| 70 | @mxemanuel | 5 | lost | lost | 400.000000 | 0.000000 | 0.000000 |
| 71 | @soy_dano | 5 | won | won | 180.000000 | 766.800000 | 0.000000 |
| 72 | @junior121 | 5 | void | void | 200.000000 | 200.000000 | 0.000000 |
| 73 | @romi | 5 | lost | lost | 1000.000000 | 0.000000 | 0.000000 |
| 74 | @reneborquez30 | 5 | lost | lost | 500.000000 | 0.000000 | 0.000000 |
| 75 | @mrtriangulo | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 76 | @karimvega | 5 | lost | lost | 100.000000 | 0.000000 | 0.000000 |
| 77 | @alex_grandson | 5 | lost | lost | 550.390000 | 0.000000 | 0.000000 |
| 78 | @karimvega | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 79 | @alex_grandson | 5 | won | won | 252.000000 | 844.200000 | 0.000000 |
| 80 | @mrtriangulo | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 81 | @champeleon | 5 | won | won | 200.000000 | 670.000000 | 0.000000 |
| 82 | @mansonbc1 | 5 | lost | lost | 200.000000 | 0.000000 | 0.000000 |
| 83 | @karimvega | 5 | won | won | 107.000000 | 885.960000 | 0.000000 |
| 84 | @soy_dano | 5 | open | won | 100.000000 | 0.000000 | 211.000000 |
| 85 | @mxemanuel | 5 | lost | lost | 300.000000 | 0.000000 | 0.000000 |
| 86 | @reneborquez30 | 5 | open | won | 100.000000 | 0.000000 | 2500.000000 |
| 87 | @mansonbc1 | 5 | lost | lost | 300.000000 | 0.000000 | 0.000000 |
| 88 | @paulvazquezp | 5 | open | won | 200.000000 | 0.000000 | 1478.000000 |
| 89 | @cachodh | 5 | open | lost | 25.000000 | 0.000000 | 0.000000 |
| 90 | @missael6tos | 5 | open | lost | 310.000000 | 0.000000 | 0.000000 |
| 91 | @karimvega | 5 | open | open | 200.000000 | 0.000000 | 0.000000 |
| 92 | @ilovegroupies | 5 | open | open | 200.000000 | 0.000000 | 0.000000 |
| 93 | @karimvega | 5 | open | open | 300.000000 | 0.000000 | 0.000000 |
| 94 | @raps | 5 | open | lost | 50.000000 | 0.000000 | 0.000000 |
