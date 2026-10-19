# Reviewed provisional tournament standings

Implemented locally on `onchain-sepolia`, after importing the three Pointbreak commits through `c8aec58f`. The standings implementation and earlier tournament presentation work are uncommitted and undeployed. No live database, runtime flag, current cycle, token, contract or wallet was changed. No ETH was spent.

## Scoring and presentation

An ongoing version-2 shadow capture can produce a separate provisional result. Both provisional and final results use the same Points scoring functions for transfer-eligible PnL, conviction, qualification, rounding and tie-breaking. Provisional inactivity counts completed Mexico City days as of the capture, including no days before a late registrant's canonical grant. Unresolved positions use the capture's historical marks. Incoming gifts cannot create score or inflate qualifying buys; eligible portions of later trades still count. Unsupported reward components remain zero.

Final closing still requires the original version-3 capture and exact adjacent blocks around the exclusive season end. A provisional artifact cannot close a season. All results keep `readyForRewards: false`; qualification is separate from prize approval.

When a future funded season is explicitly configured and enabled, `/torneo` loads provisional top-20 standings and the session user's score breakdown from `GET /api/points/tournament-results?action=standings`. Before the first publication it shows a pending update, without inventing zero scores. The view identifies provisional scores, displays their capture time in Mexico City, and shows an update-delay notice when the capture is more than 15 minutes old. It refreshes every minute. Archived and frozen results retain their existing paths; published final results take precedence. There is no fallback to Points standings.

Responses use `private, no-store`, expose only an allowlist of public score fields, and return no wallet/suborganization identifiers, raw captures or audit data. Production, Pointbreak and the current disabled preview perform no provisional reads.

## Operator workflow for a future season

This is a reviewed publication workflow, not an automatic scoring scheduler. The following commands are examples for a later, explicitly activated future season; none was run against the live preview here.

1. Apply the existing explicit future-tournament migration only when authorized. Its additive code now includes the append-only `sepolia_tournament_standings` table and immutability trigger. There is no request-time migration.
2. Use the existing snapshot or resumable capture command with `final: false`, complete cycle factory registry and funding/enrollment references, and a fixed confirmed historical block. Review its snapshot and registry hashes.
3. Export the complete reviewed Points context with the existing closing command's read-only `--export-context` mode. It contains account ages, pool/exposure mappings and touch-market flags. Review its hash.
4. Calculate locally. The default has no database or RPC dependency:

   ```sh
   node frontend/api/scripts/onchain-sepolia-standings.mjs \
     --input /private/path/ongoing-capture.json \
     --context /private/path/points-context.json \
     --reviewed-snapshot-hash <sha256> \
     --reviewed-context-hash <sha256> \
     --output /private/path/new-provisional-result.json
   ```

5. Review the output. A later explicit `--publish --expected-host <isolated-preview-host>` invocation requires the `onchain-sepolia` checkout, preview approval environment, pinned isolated direct database host and HTTPS Arbitrum Sepolia RPC. It rechecks the anchor's canonical hash/timestamp and at least two confirmations before persisting. Supply a new output filename; exports are exclusive and mode `0600`.

Publication shares enrollment/closing's operations lease. It checks the funded reviewed plan and complete confirmed join ledger, rejects pending or newly changed enrollment, and only appends captures with increasing block/time. The same exact publication is idempotent; a different result at the same block is rejected. Expired leases and closed/ended seasons cannot publish. Once a final closure exists, further provisional publication is refused. If enrollment changes during capture/review, reconcile and recapture rather than excluding the new participants.

If a publication succeeds but the local output write fails, retry with the same inputs and a fresh filename while the season is active. No result is overwritten. A changed canonical anchor requires review and a new later capture; stored publications are an audit trail, not chain consensus proofs.

## Validation and next work

All **218 tests passed in one combined run with no skips** across parity, scoring, storage, API, adapters and rendered UI. Both Points/MVP builds passed (4.16/3.82 seconds); only existing chunk-size warnings remain. Outputs were directed to private temporary directories, leaving tracked build artifacts clean. Storage uses local PGlite PostgreSQL fixtures; RPCs and transactions in tests are mocks. The current runtime remains disabled for future seasons, so these checks are not a live funded-season rehearsal.

Next: independently reviewed reward eligibility/export, automatic reviewed-capture publication scheduling, then the separately authorized future-cycle rehearsal and launch checklist. New deployment/funding/activation and payout remain deferred.
