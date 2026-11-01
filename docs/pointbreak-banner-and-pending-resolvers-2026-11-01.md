# Pointbreak banner and pending-market fixes — 2026-11-01

Worktree: `codex/pointbreak-market-display`, based on `7bdcbb59`. The owner authorized committing and pushing these source changes to Pointbreak; production deployment remains excluded. Sepolia and other branch refs/checkouts were preserved.

## Code changes

- Tournament banner: localized, keyboard-accessible 44px dismiss button. Browser storage remembers dismissal for this tournament announcement; a changed tournament/cutoff gets a new key. Storage failure still permits dismissal for the current visit. Existing expiration remains enforced.
- LMP: MLB Stats may return a postponed record and its makeup under the same game ID. The reader follows explicit reschedule links, validates all participant/league identities, rejects unrelated dates and conflicting finals, and accepts the authoritative makeup final regardless of response order. Cron and shared resolver both use this reader.
- Boxing: The Odds API supports schedules/odds, [but not boxing results](https://the-odds-api.com/sports-odds-data/sports-apis). New boxing markets require manual review; legacy sports configurations enter the existing review queue rather than poll an unsupported scores endpoint or assume fabricated 1/0 results.

## Live settlements

| Market | Result | Evidence |
| --- | --- | --- |
| 398788, Naranjeros @ Cañeros | Cañeros 4–2, outcome 0 | [Official MLB Stats schedule, game 850496](https://statsapi.mlb.com/api/v1/schedule?sportId=17&leagueId=132&hydrate=team,linescore&gamePk=850496); final is the explicitly linked makeup of the October 30 postponed game. |
| 402026, Canelo vs Mbilli | Canelo by unanimous decision, outcome 0 | [AP match report](https://abcnews.com/amp/Sports/wireStory/canelo-alvarez-regains-wbc-super-middleweight-title-unanimous-137741744). Child 402027 resolves Sí; child 402028 resolves No. |
| 332178, Amílcar official investigation announcement | No, outcome 1 | Manual review of [FGR](https://fgr.org.mx/es/FGR/Nacional), [SHCP](https://www.gob.mx/shcp/archivo/prensa) and [UIF](https://www.gob.mx/uif/archivo/prensa). No qualifying announcement was found before the original October 30, 23:59 CDMX cutoff. Leaks, third-party complaints, legislative requests and announcements by other authorities are explicitly excluded by the original contract. |

The Amílcar review covered six FGR national archive pages spanning October through September 28, the full bodies of 16 relevant FGR releases (including general announcements, huachicol and Iván/El Tanque), October SHCP releases and UIF releases, plus official-source/name searches. This is a manual conclusion from reviewed public evidence; the resolver did not infer No from an unavailable request. Source URLs, timestamps and SHA-256 evidence hashes are preserved in the settlement record.

Checkpoint before settlements: `br-square-forest-amhay5a4` in project `tiny-heart-17710833`. Transactions preserved position shares, immutable trades and original criteria, released open orders using the standard helper, stored resolved holder snapshots and recorded final-result banners/evidence. Winning positions were visible and passed the current-cycle redemption checks. No users were redeemed on their behalf.

## Still pending from the original six

| Market | Reason |
| --- | --- |
| 398787, Yaquis @ Guasave | Game 850497 was postponed for rain. The official makeup is scheduled for November 1 CDMX; no final exists yet. |
| 398789, Águilas @ Mayos | Game 850495 was postponed for rain. The official makeup is scheduled for November 1 CDMX; no final exists yet. |
| 393923, presidenta says “tecnología” on October 29 | The complete official October 29 transcript remains unavailable. The official index now lists October 28 and 30 but omits October 29. The existing manual-review candidate and retries remain active. The contract requires complete, speaker-attributed evidence; a missing transcript or unverified automatic transcription cannot establish No. |

Other markets crossed their deadlines during this review; this table tracks the six reported at the beginning of the task.

## Validation

- 42 focused backend tests passed across LMP, sports readers, boxing generation and shared resolver; the final duplicate-participant guard also passed the focused LMP suite.
- Pointbreak production build succeeded into a temporary output directory; versioned production assets were not replaced.
- Browser checks passed for desktop/mobile, Spanish/English, keyboard dismissal, persistence after refresh/navigation, announcement-key separation, unavailable storage, and automatic expiry. Mobile layout was visually inspected.
- Public production API verified the Cañeros and Canelo resolved banners and `[1, 0]` final prices. Live database verification confirmed all three parent settlements and both boxing legs.
- No production build upload, deployment or promotion was performed. The banner/resolver source fixes require a later release to affect the live application. Commit/push authorization covers only the reviewed Pointbreak files and this audit; unrelated work is excluded.

Claimability at settlement: 14 winning positions, 31518.245658 points in winning shares; no hidden winning positions required restoration.

## Authorized follow-up: reopen postponed LMP markets

At the owner's request, markets 398787 and 398789 were reopened live on November 1 UTC. Their original contracts already wait for an official final after postponement; the participants, event IDs, outcomes and criteria are unchanged.

| Market | Makeup start (November 1 CDMX) | Updated closing time (November 1 CDMX) |
| --- | --- | --- |
| 398787, Yaquis @ Guasave | 18:05 | 23:05 |
| 398789, Águilas @ Mayos | 17:05 | 22:05 |

The official feed marks both starts `startTimeTBD=true`; these are provisional listed times. Closing times retain the generator's existing five-hour window. Both published rows and approved-source rows now carry the updated dates, kickoff metadata and context resolution date, with official-source rescheduling evidence and original dates retained in the audit history. Positions, trades, orders, reserves and curation flags were preserved. Checkpoint: `br-raspy-tooth-am0wj3sv`.

A one-time follow-up in this chat is scheduled for November 1 at 23:30 CDMX (November 2 at 06:30 Europe/Rome), automation `resolve-postponed-pointbreak-markets`. The owner corrected the schedule to run before the November 1, 23:59 CDMX tournament cutoff. The two LMP settlements take priority; unavailable evidence still leaves a market pending. It is authorized to settle supported official finals and other eligible pending Pointbreak markets, while preserving claimability and leaving incomplete evidence pending. The October 29 complete official transcript was checked again and remains unavailable. No code was committed, pushed or deployed as part of reopening the markets or correcting the schedule.
