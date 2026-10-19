# Final scoring and season closing

Implementation on `onchain-sepolia`, 2026-10-19. This is local preparation for a future funded tournament: no commit, push, deployment, live migration, runtime flag, cycle pointer, token deployment, mint, signature or chain transaction is performed by this implementation. Pointbreak and the current token/cycle are untouched.

## Scoring

The final adapter consumes a completed canonical capture with verified transfer reconciliation. It imports the existing Points conviction, inactivity, touch-market and tie-breaking functions and the existing qualification constants. It does not calculate scores from the off-chain Points balances or copy their positions.

- Market PnL is eligible cash plus eligible marked positions minus the reviewed opening allocation. Gross buys and net sells already include the existing trading fees. Incoming transfers remain excluded; outgoing transfers reduce eligible holdings. Subsequent trades use only their eligible portion.
- Resolved winning shares are worth one MXNP each whether claimed or unclaimed. Losing shares are zero. Active positions use their canonical cutoff prices; canceled positions use the reconciled remaining refund claim. Claiming does not create profit twice or remove conviction already earned.
- Conviction uses Points FIFO lots, the 100-MXNP market-entry minimum, maximum 0.85 entry price, 10% per holding day up to five days, the 50% positive market-PnL cap and touch-market exclusion. Outgoing eligible share gifts consume conviction lots without creating activity. Parent exposure groups share the profit cap.
- A qualifying market requires an individual eligible buy of at least 100 MXNP. Distinct parent exposure groups count once; ten are required. Eligible buys, sells and manual redemptions count as activity, as in Points. Refunds and transfers do not.
- Inactivity uses the existing 50-MXNP penalty per inactive Mexico City day. Late users start eligibility at their canonical grant, so earlier days do not penalize them. The exclusive ending instant is converted to the final included instant for the existing inclusive Points day calculation.
- Score is market PnL plus conviction minus inactivity. Ties follow Points: score, fewer inactive days, more qualifying markets, older account, username. Display amounts use the existing Points rounding. Values beyond the exact integer-unit range of Points' decimal-number calculations are refused.

There is no on-chain implementation of limit-order liquidity rewards, combinadas, stocks or wallet rewards in this flow. Their score fields are zero and the rules explicitly list them as unsupported. The result does not advertise off-chain rewards, trade limits or prizes as on-chain capabilities. `readyForRewards` remains `false`: frozen ranking is separate from reward approval and payout.

## Immutable cutoff and closing

The reviewed future plan defines an inclusive start and **exclusive end**. Final capture requires the last block strictly before the end, plus its adjacent block at or after the end. Both blocks need at least two confirmations. Canonical creation deadlines, resolution times, lifecycle history, transfers and historical balances are captured. Open disputes or incomplete evidence stop capture.

A final capture is version 3 and includes the boundary pair and the entire reviewed late-join ledger reference set. Normal shadow captures remain version 2. Final and ordinary resumable checkpoints have different identities: use a new private checkpoint directory for a final capture. Live cutoff hashes are checked again before persisting a close.

Points-only metadata is a separately reviewed input: original account creation dates, exact pool-to-Points-market mappings, parent exposure groups, start times and touch-market flags. Context export makes SELECTs only and requires complete coverage of captured registrants and pools. Both capture and context hashes must be supplied explicitly for final scoring. The RPC and reviewed metadata remain trusted inputs; hashes detect changes, not dishonesty by those sources.

Closing writes one immutable result to `sepolia_tournament_closures`. It shares the enrollment operations-wallet lease, refuses pending joins, and binds the confirmed join ledger to the captured references, including grants mined too late to participate. Repeating the same close returns the same result. A different close, or an UPDATE/DELETE of the saved result, fails. An expired lease cannot publish results.

The funded-plan status stays `funded`; closure is a separate immutable record. Nothing updates `points_cycles`, Points balances, wallet balances, the active cycle pointer, the token, contract market status, or mint records. No automatic redemption or reset is executed. Later claims, trades or market corrections cannot alter the saved result.

## Future operator workflow

These are instructions for a separately approved future rollout, not commands run against the live preview for this change. Keep all account/capture/result artifacts outside Git with mode 0600. Use the explicit isolated preview environment; the tools do not load the root `.env`.

1. Install the extended future-tournament schema only during that rollout, using the existing guarded `onchain-sepolia-tournament.mjs schema --apply` workflow. No request or cold start runs DDL. Review the migration before applying it.
2. After the season ends and indexing covers its cutoff, set `"final": true` in the existing private capture request, choose the last pre-end block, and run the existing read-only resumable capture command with a new checkpoint directory. Supply the reviewed complete registry and funding-plan hashes. Paused capture cannot publish partial results.
3. Export and review the Points metadata using the pinned preview destination. This step does not close anything:

```sh
node frontend/api/scripts/onchain-sepolia-close.mjs \
  --input=/private/tmp/final-capture.json \
  --export-context --output=/private/tmp/final-context.json \
  --expected-host=ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech
```

4. Review the context and the capture's complete coverage, then compute the frozen result offline. Replace hash placeholders with the actual reviewed SHA-256 values:

```sh
node frontend/api/scripts/onchain-sepolia-close.mjs \
  --input=/private/tmp/final-capture.json \
  --context=/private/tmp/final-context.json \
  --reviewed-snapshot-hash=REVIEWED_CAPTURE_SHA256 \
  --reviewed-context-hash=REVIEWED_CONTEXT_SHA256 \
  --output=/private/tmp/final-result.json
```

This default path uses no DB, RPC, signer or environment configuration. It refuses to overwrite an existing output file.

5. After reviewing the result, repeat with a new output filename, `--apply` and the same `--expected-host`. Apply requires Git branch `onchain-sepolia`, the existing preview approvals/chain guards, the pinned direct preview `DATABASE_URL` and an HTTPS `ONCHAIN_RPC_URL`. It verifies the live canonical boundary and writes the immutable DB result. It makes no chain writes. If local output fails after DB confirmation, retry with a new filename; the DB close is idempotent.
6. Future season runtime activation separately requires `ONCHAIN_TOURNAMENT_SEASON_ENABLED=true`, a funded `ONCHAIN_TOURNAMENT_CYCLE_ID`, matching preview token/factory/router settings and the installed schema. This new flag is absent/off by default and was not enabled for the current cycle. An enabled but incomplete/mismatched runtime fails closed.

## Runtime behavior and remaining work

For an opted-in future season, protocol buy/sell requests stop before signing when the plan has not started, has ended or has a saved closure. This application guard does not change individual contract deadlines or prevent users submitting direct chain transactions. The canonical cutoff excludes all later activity from tournament results. Redemption remains available through the existing paths.

`GET /api/points/tournament-results` exposes the frozen top 20 and the logged-in user's row. It uses private/no-store caching, does not expose wallet/suborganization mappings or account creation dates, returns 409 until frozen and fails closed on runtime/storage errors. It is disabled outside the explicit future Sepolia preview. The normal Points leaderboard is unchanged.

The full on-chain tournament page, ongoing leaderboard integration, archived-cycle presentation and independently reviewed reward eligibility/payout remain separate roadmap work. Closing is an explicit reviewed operator command; it is not scheduled automatically. Future-cycle deployment, funding, activation and a real end-of-season rehearsal remain deferred. Local tests do not establish a live future-cycle result.

## Validation

All **186 distinct tests passed across focused runs, with no skips**: 173 tournament/Points/frontend regression checks (including 18 final-scoring/closing tests), plus all 13 capture checks. The capture suite includes month-length coverage and 600 registered users with 102 pools. Both Points and MVP frontend builds passed; generated outputs were restored.

The new tests cover shared-rule outputs, midnight cutoff penalties, exact boundary/finality/reorg checks, claimed versus unclaimed winnings, active-position cutoff marks, touch/group metadata, transfer exclusions, late eligibility, cancellation refunds, corrected winners, resumable final capture, reviewed input tampering, SELECT-only context export, private results API behavior, local PostgreSQL immutable closing and enrollment fencing, and offline/explicit-apply CLI recovery without signing or chain writes. The extended migration is exercised twice in local PGlite. The existing funding test's local reset fixture now includes the new closure table to satisfy its foreign key; application reset behavior is unchanged.
