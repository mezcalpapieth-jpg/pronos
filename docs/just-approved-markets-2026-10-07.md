# Just Approved Markets - 2026-10-07

Source: `points_pending_markets` rows with `status = approved` and `reviewed_at` on 2026-10-07 CDMX, plus one direct manual market created in `points_markets` today.

Approval batch:
- Reviewed by: `frmm`
- Approved at UTC: 2026-10-07 15:02:48-15:03:52
- Approved at CDMX: 2026-10-07 09:02:48-09:03:52
- Count: 10 pending-approval markets
- Visibility: all 10 pending-approval markets are `featured = true` and `tournament_featured = true`

Direct manual addition:
- Created at UTC: 2026-10-07 14:42:45
- Created at CDMX: 2026-10-07 08:42:45
- Count: 1 direct manual market
- Visibility: `featured = true` and `tournament_featured = true`

Total included: 11 markets.

| Market ID | Pending ID | Category | Source | Market | Outcomes | Closes CDMX | Resolver | Pricing | Tags |
|---:|---:|---|---|---|---|---|---|---|---|
| 332173 | 24560 | deportes | `espn-mlb` | ¿Quién gana Los Angeles Dodgers @ Atlanta Braves? | Atlanta Braves / Los Angeles Dodgers | 2026-10-07 21:00 | `sports_api` | uniform-default (50/50%) | deportes |
| 332172 | 27966 | deportes | `espn-nba` | ¿Quién gana Milwaukee Bucks @ Oklahoma City Thunder? | Oklahoma City Thunder / Milwaukee Bucks | 2026-10-07 21:00 | `sports_api` | uniform-default (50/50%) | deportes |
| 332171 | 27967 | deportes | `espn-nba` | ¿Quién gana Phoenix Suns @ Chicago Bulls? | Chicago Bulls / Phoenix Suns | 2026-10-07 21:00 | `sports_api` | uniform-default (50/50%) | deportes |
| 332174 | 27968 | deportes | `espn-nba` | ¿Quién gana Golden State Warriors @ Portland Trail Blazers? | Portland Trail Blazers / Golden State Warriors | 2026-10-07 23:00 | `sports_api` | uniform-default (50/50%) | deportes |
| 332175 | 24559 | deportes | `espn-mlb` | ¿Quién gana Milwaukee Brewers @ San Diego Padres? | San Diego Padres / Milwaukee Brewers | 2026-10-08 01:00 | `sports_api` | uniform-default (50/50%) | deportes |
| 332182 | 30634 | mexico | `october-tournament-2026` | ¿Cuántas exhalaciones reporta el Popocatépetl el 08/10/2026? | 0 a 19 / 20 a 49 / 50 a 99 / 100 o más | 2026-10-08 21:59 | `manual_review` | cofounder-brief (25/25/25/25%) | mexico, general |
| 332176 | 24996 | deportes | `espn-nfl` | Tampa Bay Buccaneers @ Dallas Cowboys | Dallas Cowboys / Tampa Bay Buccaneers | 2026-10-08 22:15 | `sports_api` | admin-config (50/50%) | deportes |
| 332177 | 28989 | musica | `entertainment-api` | ¿East of Eden será #1 global en Netflix TV esta semana? | Sí / No | 2026-10-13 00:00 | `manual_review` | uniform-generated (50/50%) | musica, world, tv |
| 332178 | 30635 | politica | `october-tournament-2026` | ¿La UIF o la FGR anuncian oficialmente una investigación de Amílcar Olán antes del 31 de octubre? | Sí / No | 2026-10-30 23:59 | `manual_review` | cofounder-brief (50/50%) | politica, mexico |
| 332130 | n/a | general | `admin-manual-review` | ¿Jesucristo regresa antes del 1 de noviembre de 2026? | Sí / No | 2026-10-31 23:59 | `manual_review` | reserves-implied (13.7/86.3%) | general, world |
| 332179 | 29137 | ai | `ai-benchmark` | ¿Quién tendrá el mejor modelo de IA en Artificial Analysis al cierre de octubre 2026? | OpenAI / Google / Anthropic / xAI / Meta / Otro | 2026-10-31 23:59 | `manual_review` | source-signals:ai (25/21/20/14/8/12%) | ai, world |

## Notes

- Batch mix: 2 espn-mlb, 3 espn-nba, 2 october-tournament-2026, 1 espn-nfl, 1 entertainment-api, 1 ai-benchmark, 1 admin-manual-review.
- Pending-approval rows are active Points markets linked through `approved_market_id`.
- Market 332130 was created directly in `points_markets`, so its Pending ID is `n/a`.
- Close ordering above is by `end_time` ascending in CDMX.
- Generated markets should open with uniform generated pricing: binary markets at 50/50, unified multi-option markets evenly divided, and parallel market legs at 50/50 each.
- The Jesucristo market's pricing is reserve-implied from current reserves at lookup time, not from a pending-market `suggestedPricing` object.
