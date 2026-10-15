# Automatic resolution audit: October 15, 2026

## Scope and deployment status

Prepared on the isolated `pointbreak` worktree for review and commit. This audit
does not authorize production deployment or changes to live market data.
The live inventory was read-only: 26 active manual/manual-review parent markets,
12 with the tournament trophy and 14 hidden without it.

Existing published rules, prices, reserves, balances, and share quantities are
unchanged. Legacy upgrades below require an exact match of source, event identity,
published criteria, and the applicable outcome/configuration guards. Customized
contracts remain manual. Upgrades run when a market becomes due; they do not
rewrite every market in advance.

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

## Visible markets still requiring manual handling

| Market | Why it is not safely automatic yet |
| --- | --- |
| #317488, CDMX seismic alert in October | Need a complete authoritative archive of actual CDMX activations, not earthquakes or alerts for other cities. No record found is not sufficient proof of No. |
| #317495, Q3 Mexican GDP flash estimate | The published rule does not distinguish the original annual-change series from the seasonally adjusted series. Specify the intended measure before adding an initial-release parser. |
| #317524, Gilberto Mora transfer to Europe | Binding transfer/loan, geographic destination, timing, and announcement conditions require semantic verification. A matching news headline is insufficient. |
| #317675, Street Fighter Rotten Tomatoes score | Requires the exact movie URL and a snapshot at the published 08:00 CDMX cutoff. A current score read later cannot reconstruct that historical score. |
| #332130, return of Jesus Christ | Consensus/judgment condition without an objective API settlement criterion. |
| #332178, UIF/FGR investigation of Amilcar Olan | Requires a qualifying official investigation announcement, correct identity and scope. Keyword matches and incomplete negative coverage are unsafe. |
| #332179, best AI lab at month end | Needs a closing-time Artificial Analysis Intelligence Index snapshot, index version, public ranking tie order and suitable data-use permission. Today's API response is not a historical cutoff snapshot. |
| #337989, GPT Astra 6.1+ release | Title says October, but the published criteria reference December 31. Resolve that discrepancy before automating; public release, private access and renaming also need explicit treatment. |

The other 14 active manual parents lack the trophy and are hidden: #42537 annual
inflation, #65882 GTA VI, #65883 Avengers Doomsday, and #161676 through #161686
international-politics markets. They remain unchanged. Many require nuanced
official announcements or complete coverage to prove a negative; they should not
be paid by a generic scraper.

## Validation and rollout

Focused tests cover archive completeness and audit policies, official release
identity, exact legacy-rule guards, bucket boundaries, unsafe redirects, stale or
speculative articles, changing nominee fields, and label-based parallel settlement.
The focused run passed all 99 tests with no failures or skips.

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
