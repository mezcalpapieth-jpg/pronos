# October Tournament Readiness

Operational checklist for the October 1, 2026 Points tournament launch. Treat this
as a launch runbook, not product copy.

## Preconditions

- The intended branch/SHA is deployed to production before final checks.
- An admin can open `/points/admin`.
- Ops has `PROD_URL` and `CRON_SECRET` available locally. Do not paste the
  secret into tickets, docs, screenshots, or chat.
- No unresolved critical generator, resolver, schema, or deployment issue is
  known before starting the checks below.

## Admin Launch Checklist

1. Open `/points/admin` and select the `Launch` tab.
2. Click `Actualizar`.
3. Confirm `Health y schema` is `Listo`.
4. Confirm `Ciclo activo` is `Listo`. If cycles are paused, restart them from
   `Ciclos` before opening the tournament publicly.
5. Click `Correr dry-runs`.
6. Confirm `Generador octubre 2026` reports `october-tournament-2026 > 0`.
7. Confirm `Resolver dry-run` has no fatal errors. Nonfatal deferred markets
   should have a clear reason and owner.
8. Confirm `Cola manual y resolvers` has `missingResolver = 0`.
9. Review `Mercados pendientes`: every tournament market should have source,
   Spanish/English translation, suggested pricing, seed liquidity,
   `resolver_config`, and `tournamentFeatured` checked before approval.

## Production Cron Probes

Run probes against production with local shell variables. Keep the command output
in the evidence log below.

```bash
curl "$PROD_URL/api/cron/generate-markets-pending?dry=1&key=$CRON_SECRET"
curl "$PROD_URL/api/cron/points-auto-resolve?dry=1&key=$CRON_SECRET"
curl "$PROD_URL/api/cron/points-maker-rewards?dry=1&key=$CRON_SECRET"
curl "$PROD_URL/api/cron/points-snapshot-prices?dry=1&key=$CRON_SECRET"
```

Do not invoke `/api/cron/points-tournament-snapshot` before cutoff unless the
team intentionally wants to write a snapshot. Its production schedule is
`59 5 * * *`, matching the 11:59 PM Mexico City cutoff during October.

Required production schedules:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/generate-markets-pending` | `0 15 * * *` | Generate October markets at 09:00 CDMX |
| `/api/cron/points-auto-resolve` | `*/15 * * * *` | Auto-resolve closed markets |
| `/api/cron/points-parlay-settle` | `*/15 * * * *` | Settle parlays after legs resolve |
| `/api/cron/points-maker-rewards` | `0 16 * * *` | Pay maker rewards |
| `/api/cron/points-snapshot-prices` | `0 * * * *` | Store price snapshots |
| `/api/cron/points-tournament-snapshot` | `59 5 * * *` | Freeze tournament standings at cutoff |

## Market Drop Sequence

1. Run the generator dry-run from the Launch tab.
2. Generate pending markets for real through `Generar ahora` or the production
   cron.
3. Inspect each pending market:
   - objective resolution criteria
   - credible source URL
   - Spanish and English question/outcomes
   - suggested pricing and seed liquidity
   - `resolver_type` and `resolver_config`
   - `tournamentFeatured` placement
4. Approve clean markets. Reject or edit anything ambiguous.
5. Refresh the public category pages and tournament module after approval.

## Resolver And Settlement

1. Run resolver diagnostic from admin.
2. Backfill resolvers for any market with `missingResolver > 0`.
3. Run the resolver dry-run from the Launch tab.
4. Assign an owner for manual-review markets before the tournament opens.
5. After a real resolution run, spot-check active market state, parlay
   settlement, and leaderboard movement.

## Scoring And Rewards

1. Confirm live leaderboard loads after market approval.
2. After the cutoff snapshot, export the conviction multiplier audit CSV.
3. Run the maker rewards dry-run before any real reward run.
4. Keep fill volume, seed liquidity, maker rewards, and tournament score as
   separate evidence lines.

## Cutoff And Rollover

1. At the 11:59 PM Mexico City cutoff, confirm that the tournament snapshot was
   created by cron or intentionally trigger it from admin.
2. Verify the snapshot row count and top positions before rollover.
3. Do not rollover while the snapshot is missing, incomplete, or still under
   dispute.
4. After rollover, re-open the Launch tab and confirm the next cycle is active.

## Stop Conditions

Stop the launch and escalate if any of these are true:

- Production deploy SHA does not match the intended branch/SHA.
- `Health y schema` is blocked.
- There is no active cycle.
- Generator dry-run returns zero October specs.
- A critical feed needed by the October markets is unavailable.
- `missingResolver > 0` for tournament markets.
- Resolver dry-run has fatal errors.
- `CRON_SECRET` is unavailable or production cron probes cannot be authenticated.
- Cutoff snapshot is missing before rollover.

## Evidence Log

| Timestamp | Check | Result | Notes / Link |
| --- | --- | --- | --- |
|  | Health y schema |  |  |
|  | Active cycle |  |  |
|  | Generator dry-run |  |  |
|  | Pending market review |  |  |
|  | Resolver dry-run |  |  |
|  | Cron probes |  |  |
|  | Cutoff snapshot |  |  |
|  | Maker rewards dry-run |  |  |
