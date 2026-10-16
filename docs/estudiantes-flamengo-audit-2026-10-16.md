# Estudiantes LP vs Flamengo: closing-time audit

Read-only investigation on 2026-10-16. No production markets, trades or balances were changed.

## Match and trades

- Points market: **355387**; football-data match **576423**.
- ESPN event: **401912523**, Copa Libertadores, first semifinal leg.
- Final score: **0-0**.
- Scheduled kickoff: 2026-10-16 00:30 UTC / October 15, 18:30 Mexico City.
- Configured trading close: 2026-10-16 02:30 UTC / October 15, 20:30 Mexico City.
- ESPN play **53728290**, type **83 / End Regular Time**, records `wallclock: 2026-10-16T02:23:06Z`.
- Market remained active and unresolved when checked on October 16.

| Trade | User | Selection | Amount (MXNP) | UTC | Mexico City | After recorded full time |
| --- | --- | --- | ---: | --- | --- | ---: |
| 25843 | ivanggarcia_43 | Empate | 2,000 | 2026-10-16 02:23:08.938 | Oct 15, 20:23:08.938 | 2.938 seconds |
| 25844 | ivanggarcia_43 | Empate | 200 | 2026-10-16 02:23:56.450 | Oct 15, 20:23:56.450 | 50.450 seconds |

The database contains **2,200 MXNP**, not 4,000, in draw purchases for this match. Both timestamps are after the provider's recorded full time. That establishes a late-trading window, not the user's intent or when the provider first published its final flag.

The user explicitly chose to honor these winnings because the platform still allowed trading. Do not reverse the purchases, cancel their winnings, or deduct points as part of this fix.

## Reproduced defects

1. The resolver fallback builds `dateYmd: 2026-10-16` from UTC kickoff. ESPN's multi-day Libertadores scoreboard returns HTTP 400. Its October 16 single-day scoreboard is empty; the event is filed under October 15. The old lookup stops before checking that neighboring day and returns `notFound`.
2. The trading guard only checks `source: espn`. This market uses `source: football-data`, so it bypasses the final-status check.
3. The fast, minute-by-minute sports resolver pass filters out football-data markets. The general resolver has a fallback, but the date lookup above cannot find this event. Production is confirmed on commit `31f639bb648038a77806d3789e6764be87dad576`; these were real coverage gaps in that version.

The football-data primary provider's historical response at the time was not retained or independently established. The fallback failure is independently reproducible. No runtime error cluster was returned by Vercel for this route in the checked window; a missing event is a benign skip rather than a fatal runtime error.

## Implemented locally

- Check neighboring single-day scoreboards when team-based lookup misses.
- Refresh the identified event using its exact summary for trading checks.
- Guard football-data buys, sells, quotes, combinada entries and limit orders, using saved or legacy pending-market metadata; fail closed if game status cannot be verified.
- Include football-data events in the fast sports resolver pass.
- Store ESPN fallback metadata on newly generated football-data fixtures.

The corrected read-only lookup returns `completed: true`, `winner: draw`, scores `0-0`. No deployment or live settlement was performed. Feed publication latency remains possible; this is not a guarantee of zero milliseconds between the real whistle and the provider updating its final flag.

## Evidence

- [ESPN match commentary](https://www.espn.com/soccer/commentary/_/gameId/401912523)
- [ESPN final play, including wallclock](https://sports.core.api.espn.com/v2/sports/soccer/leagues/conmebol.libertadores/events/401912523/competitions/401912523/plays/53728290?lang=en&region=us)
- [ESPN summary](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/summary?event=401912523)
