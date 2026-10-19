# Future tournament status and frozen archives

Implemented locally on `onchain-sepolia` after the verified `feefe49f` release. This work is uncommitted, undeployed and inactive for the current token and cycle. It performs no signing, transfers, funding, minting, migrations, closing or activation.

The existing future-season flag (`ONCHAIN_TOURNAMENT_SEASON_ENABLED=true`) and configured future cycle expose the tournament navigation only on the isolated `onchain-sepolia` Arbitrum Sepolia preview. Production and Pointbreak remain disabled. Without the flag, current preview behavior is unchanged.

## Presentation

`/torneo` shows the reviewed future season's label and Mexico City closing time. Before opening it shows the start time. During the tournament it shows its active status. At the exclusive end it shows that results await closing review. After the separate reviewed close, it shows frozen top-20 standings and the signed-in participant's final rank, market PnL, conviction bonus, inactivity penalty and qualifying-market count, even when their rank is outside the top 20.

The browser does not calculate scores or use Points standings as a fallback. The subsequent [provisional standings continuation](./onchain-sepolia-provisional-standings-2026-10-19.md) supplies reviewed ongoing scores with their capture time and delayed-update notice. The page does not advertise a prize or treat qualification as reward approval. Every stored result remains `readyForRewards: false`. Later trades, transfers, redemptions or resolutions cannot change a frozen final ranking. Points retains its existing tournament page and social-task indicators.

Archived seasons have their own query parameter (`/torneo?season=<cycle-id>`). Selection never changes the current token, current season or trading mode. The picker includes the most recent 20 frozen seasons; older saved links can still select their exact cycle. A result from a different selected cycle is rejected by the client. Account changes cancel prior loads, errors remain errors and no failed read can fall back to Points.

## Read-only API

- `GET /api/points/tournament-results`: existing current frozen-results response, or 409 before results are frozen.
- `GET /api/points/tournament-results?action=overview`: reviewed current-season status/rules and bounded archive metadata.
- `GET /api/points/tournament-results?action=standings`: latest reviewed provisional standings, pending initial publication, or frozen final results after closing.
- `GET /api/points/tournament-results?cycleId=<cycle-id>`: one frozen season, validated against its own immutable reviewed plan and result hash. Previous token/router bindings are independent of the newly active runtime. Unknown seasons return 404; invalid query combinations return 400.

All responses use `private, no-store`. Disabled runtimes return 404 without database reads. Misconfigured opted-in runtimes fail closed. Only SELECTs run. Overview/history do not return private enrollment data or full archived rows. Result detail returns explicit public fields for at most 20 leaders plus the session user's row, omitting account ages, wallet/suborganization identifiers and future operator audit fields. SQL/provider errors are sanitized.

The future tournament/enrollment/closure schema is still absent from the live preview and was not applied. This implementation uses local PostgreSQL fixtures to exercise archive reads; it does not create fictitious live results.

## Validation and remaining work

94 focused tests passed without skips: 35 backend/closing/API checks, 23 adapter/loading/rendering checks and 36 existing Points tournament/admin UI checks. Tests cover archived results after a token change, plan/cutoff/hash mismatches, bounds, session isolation, privacy, feature gates, error handling, pending closing and bilingual rendered results. Points and MVP builds passed and generated artifacts were restored.

The subsequent continuation implements the reviewed provisional publication workflow; automatic scheduling and reward eligibility/payout remain separate. A real future-cycle rehearsal still requires explicit authorization for the new token/factories/router, funding, migration and activation. None was executed here.
