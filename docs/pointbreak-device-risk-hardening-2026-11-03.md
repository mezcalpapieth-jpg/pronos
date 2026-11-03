# Pointbreak browser risk evidence — November 3, 2026

The change strengthens evidence for account coordination review. It does not establish who operates an account, change balances or tournament scores, or apply sanctions automatically.

## Scope

- Checkout: `/Users/Fran/.codex/worktrees/pointbreak-market-display/pronos`.
- Branch: `codex/pointbreak-market-display`; validation baseline HEAD `1071ee1b683fdbdcaa3ee5d35e3b0bbebb0d83c4`.
- This report records local implementation validation before the separately authorized Pointbreak-only commit and push. No deployment, production migration, or live database mutation is part of this change.
- All branch refs and the Sepolia checkout remain unchanged. The 32 preexisting protected Sepolia files and four preexisting Pointbreak edits have unchanged content hashes.

## Behavior

- A random browser ID is issued by the server in a signed, HttpOnly, SameSite=Lax cookie. Production uses the Secure, host-only `__Host-pronos_risk_device` cookie, with a one-year lifetime and no Domain attribute.
- Account switches, logout, session rotation and IP changes preserve the browser ID. JavaScript headers and the older readable device cookie cannot choose or override the signed ID.
- Tampered, expired or malformed tokens are replaced. Missing cookies receive a new ID; continuity is never inferred after cookies are cleared.
- Database events contain keyed hashes and server-controlled trust metadata, not raw browser tokens, session cookies or IP addresses. Only validated signed sessions count as verified session evidence.
- Authentication bootstrap provisions the cookie without anonymous event writes. Existing signed-in users receive one device-seen event when the server first issues their browser cookie. Login, username registration, market trades, claims, parlays, limit-order creation/cancellation and completed stock buys/sells record evidence. Stock idempotency replays do not duplicate stock-trade audit events.
- Capture remains best effort: an audit failure must not block authentication, trading or claims. No schema migration is required.
- Corrected absent market IDs to remain SQL NULL rather than the nonexistent market 0. This prevents foreign-key failures on authentication and stock events. Absent amounts/shares/outcomes also remain NULL, while real zeros are preserved.

## Admin review

- Signed browser/session matches count as 40 review points, shared IPs as 10, and historical unverified device/session signals as 5. These are review heuristics, not identity probabilities or automatic enforcement thresholds.
- The SQL ordering and score explanation use the same weights. Historical data is labeled unverified rather than rewritten or promoted to verified evidence.
- The existing admin risk panel, including its admin-only profile view, shows shared-browser activity and marks coordinated donors with a verified browser match. Activity includes human-readable actions, stock ticker when available, time and a shortened hash.
- The API remains admin guarded and private/no-store. Regular profiles neither render nor request risk evidence.

## Verification

- 38 focused tests passed: signature validation/tampering/expiry, client spoofing, cookie clearing, session coexistence/rotation/logout, metadata provenance and size, failure isolation, scoring, authentication/authorization, stock endpoint guards and coordinated trading.
- PGlite executed all six actual admin evidence queries, including target filtering and historical/signed separation. A further test used the actual risk table DDL and foreign key to confirm authentication and stock capture succeeds without a market ID.
- The Pointbreak production build passed from a private source copy, with only existing vendor annotation and large-chunk warnings. No generated files were written into either checkout.
- Chrome verified HttpOnly behavior, blocked JavaScript cookie replacement, account switches with different IPs and forged client headers, logout authorization, the actual auth/me handler with local database fixtures, one-time device-seen capture, admin evidence visibility, and absence of risk requests for non-admins. No browser page errors occurred.
- Private verification artifacts: `/private/tmp/pointbreak-device-browser-results-20261103.json`, `/private/tmp/pointbreak-device-isolation-results-20261103.json`, and `/private/tmp/pointbreak-device-admin-20261103.png`.

The new evidence begins after release and subsequent user visits. A shared browser can belong to several people, and clearing cookies, using another browser or copying a valid token can evade or confuse browser-level attribution. Continue reviewing coordinated trading and independent evidence before account enforcement.
