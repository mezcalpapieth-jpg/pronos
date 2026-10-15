# Automatic resolution audit: October 15, 2026

## Scope and deployment status

Prepared on the isolated `pointbreak` worktree for review and commit. This audit
does not authorize production deployment or changes to live market data.
The live inventory was read-only: 26 active manual/manual-review parent markets,
12 with the tournament trophy and 14 hidden without it.

Prices, reserves, balances, and share quantities are unchanged. The four rule
clarifications approved later on October 15 are implemented below but have not
been applied to live records. Earlier legacy upgrades require an exact match of source, event identity,
published criteria, and the applicable outcome/configuration guards. Customized
contracts remain manual. Upgrades run when a market becomes due; they do not
rewrite every market in advance.

The GDP, Astra, Rotten Tomatoes and AI-lab contracts use an explicit Admin
preview/apply transition instead. They are not silently upgraded when due.

## Implemented automatic readers

| Market | Evidence and settlement behavior |
| --- | --- |
| Future temperature markets | Open-Meteo Archive `best_match` is the sole settlement source. Wait until the local day ends and require all 24 finite, correctly dated hourly readings. Daily and hourly maxima must agree when both exist. Other forecast models no longer veto the Archive result. |
| #335153, first-half October INPC annual inflation | Read INEGI's initial quincenal press release through its public newsroom API. Require the exact period, publication date, first-half bulletin path, and matching annual inflation in the headline and release body. Do not substitute the latest potentially revised historical series. Boundaries remain 3.00%, 3.50%, and 4.00%. |
| #317496, October 28 Fed decision | Compare both endpoints of the target federal-funds range in the exact October 28 and September 16 FOMC statements. Map a parallel decrease/unchanged/increase to Recorta/Mantiene/Sube. Missing or ambiguous statements do not pay. |
| #317514, World Series champion | Require four verified final World Series wins from MLB's official Stats API, correct season, game identities and scores. Match the champion to the listed outcome. Child markets settle by label rather than filtered row position; earlier NO resolutions are preserved and conflicting resolutions stop the transaction. |
| #317676, men's Ballon d'Or | Read the official UEFA/Ballon d'Or page and an explicit, already-published winner article for the correct year and men's award. Require agreement between headline and winner declaration. Select the named outcome, or Otro only after an explicit winner is confirmed. |
| Future Granja VIP elimination markets | Generate from dated current-week TV Azteca nominee evidence, not stale sidebar headlines or Corral VIP stories. Resolve only an explicit official elimination result for that gala and a matching contestant field. |
| Future Granja VIP Capataz markets | Generate after the dated official finalists are announced for that Monday. Close at 20:25 CDMX, before the announced 20:30 program. Resolve from the explicit official winner announcement; changed finalists, conflicting results, cancellations and ambiguity require review. |

Already-approved temperature market #352434 keeps its published cross-model audit
rule. Its Archive/forecast disagreement is not permission to retroactively remove
that rule. The new Archive-only policy applies to future generated contracts.

Source/network failures cannot be treated as proof of a negative outcome.
Unpublished results wait; ambiguous or overdue results retain a manual-review path.
These are public official-source readers, not AI-generated payout recommendations.

## Granja VIP investigation

The existing generator produced elimination markets only. Its latest saved draft
was for October 11; there was no saved October 18 draft in the inspected inventory.
Stale headlines and unrelated Corral VIP content could contaminate discovery.
The reader now uses dated article bodies and keeps eliminated participants out of
new fields without confusing historical settlement with today's roster.

The current official October 18 elimination field found on October 15 is:

- Bicolor, listed on the site as Kevin Contreras "Bicolor".
- Mono Osuna.
- Julio Camejo.
- Azalia "La Negra" / Azalia Ojeda.

The public-source smoke test generated this four-outcome draft in memory only,
closing Sunday October 18 at 19:55 CDMX. It was not inserted or approved. Nominees
can still change through the show's weekly mechanics; the result reader checks
the field again before settling.

Pablo Montero won the October 12 Capataz contest. Its finalists were Bebeshita,
Pablo Montero, Julio Camejo, and Ivonne Montero. That contest is already over and
must not be reopened. No dated official finalist list for October 19 was found,
so the new generator correctly withheld that draft. It can produce one when the
list is published and discovered through the official listings.

Other potential formats include El Duelo, Salvacion, El Mas Gallito, and Peon.
They were not existing generator types that silently failed. They need their own
contest dates, confirmed participants, and unambiguous winner rules before being
added; this change does not invent markets for them.

Official evidence:

- [Current nominees, October 14](https://www.tvazteca.com/aztecauno/la-granja-vip/oficial-lista-nominados-hoy-miercoles-14-octubre-corren-riesgo-eliminados/).
- [Pablo Montero wins Capataz](https://www.tvazteca.com/aztecauno/la-granja-vip/pablo-montero-se-convierte-en-el-nuevo-capataz-en-la-sexta-semana-reality/).
- [October 12 Capataz finalists](https://www.tvazteca.com/aztecauno/la-granja-vip/quienes-fueron-los-finalistas-estos-granjeros-lucharan-por-quedarse-el-puesto-de-capataz-en-la-granja-vip/).
- [Official show schedule and videos](https://www.tvazteca.com/aztecauno/la-granja-vip/videos).

## Four newly approved automated contracts

Implemented locally, including generator rules and readers. Not deployed or
activated on existing live markets in this change.

| Market | Approved rule and automated evidence |
| --- | --- |
| #317495, Q3 Mexican GDP | INEGI's first Estimacion Oportuna release: Total GDP, original-series real year-over-year change for Q3 2026. Not seasonally adjusted, quarterly or cumulative growth. Read the official Word bulletin's original-series table. No extra rounding; lower bounds inclusive, upper bounds exclusive. Delayed publication waits with trading closed; ambiguous identity or revisions require review. |
| #337989, GPT Astra 6.1+ | Deadline October 31, 2026, 23:59:59 CDMX, not December 31. Official announcement plus public access through ChatGPT or OpenAI API; paid and self-service public previews count. Sol, older Astra, renames, private/waitlist access and future-access announcements do not. Unclear successors require review. No requires complete official announcements, model documentation and ChatGPT release notes in a closing bundle from the final 60 seconds. |
| #317675, Street Fighter Rotten Tomatoes | Exact [2026 movie page](https://www.rottentomatoes.com/m/street_fighter_2026), All Critics integer Tomatometer only. Snapshot at October 19, 08:00:00 CDMX: last verified completed capture, request started within the previous 60 seconds. Top Critics, Popcornmeter and average ratings do not count. A valid page explicitly lacking a score cancels and refunds remaining cost basis using the existing Admin procedure. Blocked or incomplete pages require review. |
| #332179, best AI lab | Complete, unfiltered [Artificial Analysis text-model table](https://artificialanalysis.ai/leaderboards/models), descending Intelligence Index, October 31, 23:59:59 CDMX. Use visible scores and official visible row order for visible ties, with each reasoning configuration listed separately. Preserve the current primary index version and methodology. Last complete capture must be no more than five minutes old. Map the verified leader's creator to the listed lab, or Otro. Missing rows, disputed ordering or changed methodology during capture require review. |

Closing-time evidence is not reconstructed from a later live page. A new
authenticated minutely cron, `/api/cron/points-official-snapshots`, fetches only
contracts in their final ten minutes and retains only eligible closing captures.
Original source documents are privately gzip-archived with SHA-256 hashes in
`points_official_result_snapshots`; public market responses receive evidence
metadata, not complete archived pages. Settlement replays evidence for the exact
configuration and outcome hash. Config/outcome changes invalidate previous
captures and are guarded again in the settlement transaction.
Edited criteria or a changed cutoff hour also disable automatic settlement,
even if an Admin leaves the old rule-version field in place.

The public HTML reader for Artificial Analysis does not require an API key and
does not infer ranking from undocumented API array order. Operators still need
to confirm applicable automated-access and archival permissions with the source.

Read-only source checks on October 15 confirmed:

- INEGI's Q2 2026 original-series annual GDP value of 2.2%, distinct from the
  adjusted 2.1% and cumulative 1.2% values in the same bulletin.
- Structured and visible All Critics scores agree on the Street Fighter page.
- The complete Artificial Analysis table, leader and methodology version agree.
- OpenAI RSS is readable, but direct announcement pages returned HTTP 403 from
  this environment. No bypass was attempted. If production access also fails,
  Astra goes to review, never to No. Unattended Astra settlement is not proven.

These checks are parser smoke tests, not evidence of future closing outcomes.

### Activation runbook

After a separately authorized, SHA-verified deployment:

1. As an authenticated Points Admin, GET `/api/points/admin/official-contracts`
   for a read-only preview and `planHash`. It covers exactly #317495, #317675,
   #332179 and #337989. Review the before/after rules and Astra closing date.
2. Only after approval, POST the reviewed `planHash` to the same endpoint. All
   four changes are transactional. Changed identities, outcomes, modes, status,
   rules or dates invalidate the preview. Old pending resolution suggestions are
   denied, while the previous configuration and approving admin are preserved.
3. This operation updates rules, resolver metadata, approved-draft metadata and
   Astra's question/closing time only. It never changes reserves, odds, balances,
   shares or the three markets deliberately left manual.
4. Verify `CRON_SECRET`, the new cron schedule, its runtime authorization and
   readable source access on the production host. A cron dry run (`?dry=1`)
   reads candidate configuration only; it does not create tables, fetch pages
   or write evidence.
5. Before a real deadline, verify a stored eligible snapshot with matching
   contract hash, source hashes, start/completion times and private archive.
   After the deadline, verify one real resolution or the appropriate review/
   refund path. Missing snapshots cannot be repaired with post-deadline scores.

## Visible markets kept manual

| Market | Why it is not safely automatic yet |
| --- | --- |
| #317488, CDMX seismic alert in October | Need a complete authoritative archive of actual CDMX activations, not earthquakes or alerts for other cities. No record found is not sufficient proof of No. |
| #317524, Gilberto Mora transfer to Europe | Binding transfer/loan, geographic destination, timing, and announcement conditions require semantic verification. A matching news headline is insufficient. |
| #332130, return of Jesus Christ | Consensus/judgment condition without an objective API settlement criterion. |
| #332178, UIF/FGR investigation of Amilcar Olan | Requires a qualifying official investigation announcement, correct identity and scope. Keyword matches and incomplete negative coverage are unsafe. |

The other 14 active manual parents lack the trophy and are hidden: #42537 annual
inflation, #65882 GTA VI, #65883 Avengers Doomsday, and #161676 through #161686
international-politics markets. They remain unchanged. Many require nuanced
official announcements or complete coverage to prove a negative; they should not
be paid by a generic scraper.

## Validation and rollout

Focused tests cover archive completeness and audit policies, official release
identity, exact legacy-rule guards, bucket boundaries, unsafe redirects, stale or
speculative articles, changing nominee fields, and label-based parallel settlement.
The earlier focused run passed all 99 tests with no failures or skips. After the
four newly approved contracts were implemented, the expanded regression run
passed all 210 tests with no failures or skips, including PGlite snapshot replay,
refund accounting, unchanged balances/shares/reserves, activation rollback,
modified-rule guards, deadline boundaries, and Vercel dependency tracing. The
Points production build also passed; existing dependency-annotation and chunk-size
warnings remain. No production build output was deployed.

Read-only historical/live source checks succeeded for:

- [September 16, 2026 FOMC statement](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm): target range 3.75%-4.00%.
- [2025 MLB World Series schedule/results](https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2025&gameTypes=W): Dodgers four wins, Toronto three, seven verified finals.
- [Official 2025 men's Ballon d'Or winner](https://www.uefa.com/uefachampionsleague/news/029d-1ec96c30aa3f-f6868c869cbd-1000--ousmane-dembele-wins-2025-men-s-ballon-d-or/): Ousmane Dembele.
- [INEGI initial first-half April 2026 release](https://www.inegi.org.mx/app/saladeprensa/noticia/10773): 4.53% annual inflation, matching the [original bulletin](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_1q2026_04.pdf).
- Current Granja nominee discovery and generation of the October 18 draft in memory.

Deployment is still required before scheduled production runs use this code.
After an authorized deployment, verify the exact deployed SHA, a generator run,
the new pending draft, and a real due resolution. Passing local tests or reading
public evidence does not establish production cron execution or a live payout.
