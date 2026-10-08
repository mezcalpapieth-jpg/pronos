# Just Approved Markets - 2026-10-06

Source: `points_pending_markets` rows with `status = approved` in the latest approval batch.

Approval batch:
- Reviewed by: `frmm`
- Approved at: 2026-10-06 15:02:27-15:02:32 UTC
- Approved at CDMX: 2026-10-06 09:02:27-09:02:32
- Count: 9 markets
- Visibility: all 9 are `featured = true` and `tournament_featured = true`

| Market ID | Pending ID | Category | Source | Market | Outcomes | Closes CDMX | Resolver |
|---:|---:|---|---|---|---|---|---|
| 329274 | 25754 | deportes | `espn-soccer` | Inglaterra vs Chequia | Inglaterra / Empate / Chequia | 2026-10-06 14:45 | `sports_api` |
| 329275 | 25753 | deportes | `espn-soccer` | Croacia vs España | Croacia / Empate / España | 2026-10-06 14:45 | `sports_api` |
| 329276 | 27934 | mexico | `open-meteo` | ¿Temperatura máxima en CDMX el 06/10/2026? | < 22°C / 22°C / 23°C / ≥ 24°C | 2026-10-06 21:00 | `weather_api` |
| 329281 | 24556 | deportes | `espn-mlb` | ¿Quién gana Los Angeles Dodgers @ Atlanta Braves? | Atlanta Braves / Los Angeles Dodgers | 2026-10-06 21:00 | `sports_api` |
| 329282 | 24555 | deportes | `espn-mlb` | ¿Quién gana Milwaukee Brewers @ San Diego Padres? | San Diego Padres / Milwaukee Brewers | 2026-10-07 00:30 | `sports_api` |
| 329283 | 28432 | mexico | `mananera` | ¿La presidenta mencionará "aranceles" en la mañanera del 07/10/2026? | Sí / No | 2026-10-07 07:59 | `api_transcript` |
| 329284 | 28431 | mexico | `mananera` | ¿La presidenta mencionará "Queretaro" en la mañanera del 07/10/2026? | Sí / No | 2026-10-07 07:59 | `api_transcript` |
| 329285 | 24558 | deportes | `espn-mlb` | ¿Quién gana Cleveland Guardians @ Chicago White Sox? | Chicago White Sox / Cleveland Guardians | 2026-10-07 19:00 | `sports_api` |
| 329286 | 24557 | deportes | `espn-mlb` | ¿Quién gana Tampa Bay Rays @ New York Yankees? | New York Yankees / Tampa Bay Rays | 2026-10-07 23:00 | `sports_api` |

## Notes

- Soccer markets are UEFA Nations League 3-way markets with draw outcomes.
- MLB markets are binary winner markets and include series metadata in resolver config.
- The CDMX weather market resolves from Open-Meteo Archive with bucketed maximum temperature outcomes.
- The mañanera markets resolve from the official gob.mx transcript, with official YouTube captions as fallback.
