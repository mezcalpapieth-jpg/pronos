/**
 * Points-app auto-resolver.
 *
 * Scans points_markets for active rows whose trading window has closed
 * AND whose resolver_type is one we know how to settle automatically.
 * Active resolver types: chainlink_price, api_price, weather_api,
 * api_chart, sports_api (espn / espn-pga / espn-liv / etc.).
 *
 * NOTE: this is now the ONLY auto-resolver. The older
 * /api/cron/auto-resolve was a Polymarket-Gamma mirror for the
 * legacy MVP path; it's been deprecated (returns 410 Gone) since
 * Pronos no longer integrates Polymarket. See lib/protocol.js for
 * the architecture decision.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (required in production)
 *   CHAINLINK_RPC_URL  (optional — override default public RPC)
 *
 * GET /api/cron/points-auto-resolve              — run the resolver
 * GET /api/cron/points-auto-resolve?dry=1        — log candidates + feed
 *                                                  reads without writing
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import { readChainlinkPrice, readChainlinkRoundAtOrBefore, comparePrice } from '../_lib/chainlink.js';
import { formatDirectionFinalScore, resolveDirectionOutcome } from '../_lib/crypto-5min.js';
import { bestEffortPersistResolvedCryptoMarketSnapshot } from '../_lib/crypto-chart-snapshot.js';
import { readFinnhubQuote } from '../_lib/stockprice.js';
import { readBanxicoLatest } from '../_lib/banxico.js';
import { readCreAverageFor } from '../_lib/fuel.js';
import { fetchMaxTempC, bucketIndexFor } from '../_lib/weather.js';
import { readAppleMxTopArtist } from '../_lib/charts.js';
import { readYouTubeTopMxChannel } from '../_lib/youtube.js';
import { readEspnEvent, readFootballDataMatch, readJolpicaF1Result, readJolpicaF1Standings, readEspnPgaWinner, readEspnLivWinner, readLivTeamWinner, readEspnAtpTournamentWinner, readEspnMmaWinner, readOddsApiBoxingWinner, readNextOpponent } from '../_lib/sports-results.js';
import { NEXT_OPPONENT_RECHECK_INTERVAL_HOURS, findParallelWinnerIndex } from '../_lib/sports-resolver-policy.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql   = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const MAX_BINARY_DIRECTION_CATCHUP_PER_RUN = 12;

function parseJsonb(v, fb) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

/**
 * Build the free-form final-score string we store on points_markets.final_score.
 * Rendered under the question on resolved market cards and the detail page.
 *
 * `outcomes` is the market's outcomes array so we can reach for the winning
 * label as a fallback (e.g. price / weather resolvers where there's no
 * meaningful scoreline — we just echo "Subió a $98,421" or the winner label).
 * Cap at 240 chars to match resolve-market.js server validation.
 */
function buildFinalScore({ resolverType, cfg, result, resolverInfo, outcomes, winningIdx }) {
  const winLabel = Array.isArray(outcomes) ? outcomes[winningIdx] : null;
  const clip = (s) => (s == null ? null : String(s).slice(0, 240));

  try {
    if (resolverType === 'sports_api') {
      if (cfg.shape === 'binary' || cfg.shape === 'draw3') {
        const home = Number.isFinite(result.homeScore) ? result.homeScore : null;
        const away = Number.isFinite(result.awayScore) ? result.awayScore : null;
        const score = (home != null && away != null) ? `${home}-${away}` : null;
        const hName = result.homeTeam || null;
        const aName = result.awayTeam || null;
        if (hName && aName && score) return clip(`${hName} ${score} ${aName}`);
        if (score) return clip(score);
        return clip(winLabel);
      }
      if (cfg.shape === 'parallel') {
        const driver = result.winnerDriverLabel || resolverInfo?.winnerDriver;
        if (driver) return clip(`🏁 ${driver}`);
        return clip(winLabel);
      }
    }

    if (resolverType === 'chainlink_price' || resolverType === 'api_price') {
      const price = resolverInfo?.priceAtResolve;
      if (cfg.shape === 'binary-direction' && price != null && cfg.threshold != null) {
        return clip(formatDirectionFinalScore(cfg.threshold, price));
      }
      if (price != null) {
        const sym = cfg.symbol || cfg.feedAddress || resolverInfo?.source || '';
        const short = sym ? (typeof sym === 'string' ? sym.slice(0, 20) : '') : '';
        const priceStr = typeof price === 'number' ? price.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(price);
        return clip(short ? `${short} · ${priceStr}` : priceStr);
      }
      return clip(winLabel);
    }

    if (resolverType === 'weather_api') {
      const temp = resolverInfo?.recordedMaxC;
      if (Number.isFinite(temp)) return clip(`${Number(temp).toFixed(1)}°C máx`);
      return clip(winLabel);
    }

    if (resolverType === 'api_chart') {
      const top = resolverInfo?.topArtist || resolverInfo?.topChannel || resolverInfo?.topTrack || resolverInfo?.topTitle;
      if (top) return clip(`#1 ${top}`);
      return clip(winLabel);
    }
  } catch { /* fall through */ }

  return clip(winLabel);
}

/**
 * Core auto-resolve loop, extracted so the admin "Resolver ahora"
 * endpoint can trigger it without CRON_SECRET. Returns the same
 * `{ ok, tookMs, checked, resolved, errors, dryRun }` shape the
 * cron handler used to build inline.
 *
 * Also acts as a catch-up pass for BTC/ETH 5-minute markets. Their
 * preferred path is the exact boundary tick in _lib/crypto-5min.js,
 * but if that tick is missed, this loop resolves them later using the
 * Chainlink round at the market's close timestamp.
 *
 * Vercel cron jobs ONLY run on production deployments. On preview
 * URLs the every-15-min schedule never fires, so admins use the
 * admin endpoint to kick this off manually.
 */
export async function runAutoResolve({ dry = false } = {}) {
  const started = Date.now();
  await ensurePointsSchema(schemaSql);

    // Only parents — parallel legs are resolved via the parent cascade
    // below (weather_api). For price resolvers the market is already
    // unified binary so there's nothing to cascade.
    const candidates = await readSql`
      SELECT id, question, end_time, resolver_type, resolver_config,
             outcomes, amm_mode
      FROM points_markets
      WHERE status = 'active'
        AND resolver_type IN ('chainlink_price', 'api_price', 'weather_api', 'api_chart', 'sports_api')
        AND end_time IS NOT NULL
        AND (
          end_time < NOW()
          OR (
            resolver_type = 'sports_api'
            AND resolver_config->>'source' = 'espn'
            AND resolver_config->>'shape' IN ('binary', 'draw3')
            AND start_time IS NOT NULL
            AND start_time < NOW() - INTERVAL '90 minutes'
          )
          OR (
            resolver_type = 'sports_api'
            AND resolver_config->>'source' = 'next-opponent'
            AND end_time > NOW()
            AND (
              resolver_config->>'nextOpponentLastCheckedAt' IS NULL
              OR NULLIF(resolver_config->>'nextOpponentLastCheckedAt', '')::timestamptz
                   < NOW() - (${NEXT_OPPONENT_RECHECK_INTERVAL_HOURS}::int * INTERVAL '1 hour')
            )
          )
        )
        AND parent_id IS NULL
      ORDER BY
        CASE WHEN resolver_config->>'shape' = 'binary-direction' THEN 1 ELSE 0 END,
        end_time ASC
      LIMIT 100
    `;

    const report = {
      checked: candidates.length,
      resolved: [],
      errors: [],
      deferred: [],
      dryRun: dry,
    };

    let binaryDirectionCatchups = 0;

    for (const m of candidates) {
      const cfg = parseJsonb(m.resolver_config, null);
      if (!cfg) {
        report.errors.push({ id: m.id, error: 'missing_resolver_config' });
        continue;
      }
      const isBinaryDirectionCatchup = m.resolver_type === 'chainlink_price'
        && cfg.shape === 'binary-direction';
      if (isBinaryDirectionCatchup && binaryDirectionCatchups >= MAX_BINARY_DIRECTION_CATCHUP_PER_RUN) {
        report.deferred.push({ id: m.id, reason: 'binary_direction_catchup_limit' });
        continue;
      }
      if (isBinaryDirectionCatchup) binaryDirectionCatchups += 1;

      // Compute the winning outcome index per resolver type. Price
      // resolvers hit a feed / API and compare; weather_api resolves by
      // fetching the recorded high and picking the bucket index.
      // `result` is hoisted to the iteration scope so buildFinalScore
      // (called below outside this try-block) can read it for sports
      // markets without crashing on non-sports resolvers that never
      // assign it. Non-sports types pass `null` through and
      // buildFinalScore's branch logic falls back to winLabel.
      let winningIdx = null;
      let resolverInfo = {};
      let resolverConfigPatch = null;
      let result = null;
      try {
        if (m.resolver_type === 'chainlink_price') {
          if (cfg.shape === 'binary-direction') {
            if (!cfg.feedAddress || cfg.threshold == null) {
              throw new Error('invalid chainlink_price binary-direction config');
            }
            const closesAt = cfg.closesAt || m.end_time;
            if (!closesAt) throw new Error('binary-direction: missing closesAt');

            const round = await readChainlinkRoundAtOrBefore({
              feedAddress: cfg.feedAddress,
              chainId: cfg.chainId,
              timestamp: closesAt,
            });
            winningIdx = resolveDirectionOutcome(round.price, cfg.threshold);
            if (winningIdx == null) {
              throw new Error(`binary-direction tie at ${round.price}`);
            }
            const roundUpdatedAt = Number.isFinite(Number(round.updatedAt))
              ? new Date(Number(round.updatedAt) * 1000).toISOString()
              : null;
            resolverInfo = {
              priceAtResolve: round.price,
              threshold: cfg.threshold,
              source: cfg.symbol || 'chainlink',
              roundUpdatedAt,
            };
            resolverConfigPatch = {
              closePrice: round.price,
              resolvedRoundId: round.roundId?.toString?.() || String(round.roundId),
              resolvedRoundUpdatedAt: roundUpdatedAt,
            };
          } else {
            if (!cfg.feedAddress || !cfg.op || cfg.threshold == null || cfg.yesOutcome == null) {
              throw new Error('invalid chainlink_price config');
            }
            const price = await readChainlinkPrice({
              feedAddress: cfg.feedAddress,
              chainId: cfg.chainId,
            });
            const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
            const yesIdx = Number(cfg.yesOutcome);
            winningIdx = yes ? yesIdx : (1 - yesIdx);
            resolverInfo = { priceAtResolve: price, op: cfg.op, threshold: cfg.threshold };
          }
        } else if (m.resolver_type === 'api_price') {
          // api_price is a family — dispatch on cfg.source to pick the
          // right reader. Each reader returns a scalar price in the
          // same currency as cfg.threshold.
          if (!cfg.source || !cfg.op || cfg.threshold == null || cfg.yesOutcome == null) {
            throw new Error(`invalid api_price config (source=${cfg.source})`);
          }
          let price;
          let readerInfo;
          if (cfg.source === 'finnhub') {
            if (!cfg.symbol) throw new Error('finnhub: missing symbol');
            const quote = await readFinnhubQuote(cfg.symbol);
            price = quote.price;
            readerInfo = { symbol: cfg.symbol };
          } else if (cfg.source === 'banxico-fix') {
            if (!cfg.seriesId) throw new Error('banxico-fix: missing seriesId');
            const r = await readBanxicoLatest(cfg.seriesId);
            price = r.value;
            readerInfo = { seriesId: cfg.seriesId, fecha: r.fecha };
          } else if (cfg.source === 'cre-gasolina') {
            if (!cfg.fuelType) throw new Error('cre-gasolina: missing fuelType');
            const r = await readCreAverageFor(cfg.fuelType);
            price = r.value;
            readerInfo = { fuelType: cfg.fuelType, sampleSize: r.sampleSize };
          } else {
            throw new Error(`unsupported api_price source: ${cfg.source}`);
          }
          const yes = comparePrice(price, cfg.op, Number(cfg.threshold));
          const yesIdx = Number(cfg.yesOutcome);
          winningIdx = yes ? yesIdx : (1 - yesIdx);
          resolverInfo = {
            priceAtResolve: price,
            source: cfg.source,
            op: cfg.op,
            threshold: cfg.threshold,
            ...readerInfo,
          };
        } else if (m.resolver_type === 'weather_api') {
          if (!cfg.lat || !cfg.lng || !cfg.forecastDateYmd || !Array.isArray(cfg.buckets)) {
            throw new Error('invalid weather_api config');
          }
          const tempC = await fetchMaxTempC({
            lat: cfg.lat,
            lng: cfg.lng,
            dateYmd: cfg.forecastDateYmd,
            timezone: cfg.timezone,
          });
          // Bucket match — prefer the config's own ranges over the
          // library's defaults so regenerated buckets don't desync.
          winningIdx = cfg.buckets.findIndex(b =>
            tempC >= Number(b.minC) && tempC < Number(b.maxC),
          );
          if (winningIdx < 0) winningIdx = bucketIndexFor(tempC); // fallback
          if (winningIdx < 0) throw new Error(`temp ${tempC}°C didn't fit any bucket`);
          resolverInfo = { recordedMaxC: tempC, forecastDateYmd: cfg.forecastDateYmd };
        } else if (m.resolver_type === 'api_chart') {
          // Parallel music / trending markets. Each leg has a match
          // rule; the "Otro" leg's rule is all-null and wins when no
          // listed leg matches the current #1.
          if (!Array.isArray(cfg.legs) || cfg.legs.length === 0) {
            throw new Error('invalid api_chart config: missing legs');
          }
          let pickWinnerIdx;
          let readerEcho;

          if (cfg.source === 'apple-mx-songs') {
            const top = await readAppleMxTopArtist();
            const needle = (top.artist || '').toLowerCase().trim();
            pickWinnerIdx = cfg.legs.findIndex(l =>
              l.artist && String(l.artist).toLowerCase().trim() === needle,
            );
            readerEcho = { topArtist: top.artist, topTrack: top.trackName };
          } else if (cfg.source === 'youtube-trending-mx') {
            const top = await readYouTubeTopMxChannel();
            // Prefer channelId match (stable); fall back to display name.
            const idNeedle = (top.channelId || '').trim();
            const nameNeedle = (top.channel || '').toLowerCase().trim();
            pickWinnerIdx = cfg.legs.findIndex(l => {
              if (l.channelId && String(l.channelId).trim() === idNeedle) return true;
              if (l.channel && String(l.channel).toLowerCase().trim() === nameNeedle) return true;
              return false;
            });
            readerEcho = { topChannel: top.channel, topTitle: top.title };
          } else {
            throw new Error(`unsupported api_chart source: ${cfg.source}`);
          }

          if (pickWinnerIdx < 0) {
            // Fall back to "Otro" — the first leg whose match rule is
            // all-null. If no Otro leg exists the market is malformed
            // and we surface that as an error rather than pick arbitrarily.
            pickWinnerIdx = cfg.legs.findIndex(l =>
              !l.artist && !l.channel && !l.channelId,
            );
            if (pickWinnerIdx < 0) {
              throw new Error('no matching leg and no Otro fallback configured');
            }
          }
          winningIdx = pickWinnerIdx;
          resolverInfo = { source: cfg.source, ...readerEcho };
        } else if (m.resolver_type === 'sports_api') {
          // Sports scoreboards (MLB/NBA/F1 via ESPN + Jolpica +
          // football-data). Shape in cfg:
          //   source: 'espn' | 'football-data' | 'jolpica-f1'
          //   shape:  'binary' | 'draw3' | 'parallel'
          //   (+ source-specific fields: eventId/leaguePath/dateYmd,
          //    matchId, season/round, legs[])
          if (!cfg.source || !cfg.shape) {
            throw new Error('invalid sports_api config: missing source/shape');
          }

          // Read result from the configured source. Reuses the
          // iteration-scope `result` declared above so buildFinalScore
          // can see it after the dispatch.
          if (cfg.source === 'espn') {
            result = await readEspnEvent({
              leaguePath: cfg.leaguePath,
              eventId: cfg.eventId,
              dateYmd: cfg.dateYmd,
            });
          } else if (cfg.source === 'football-data') {
            result = await readFootballDataMatch(cfg.matchId);
          } else if (cfg.source === 'jolpica-f1') {
            result = await readJolpicaF1Result({ season: cfg.season, round: cfg.round });
          } else if (cfg.source === 'jolpica-f1-standings') {
            // F1 season-long markets — Drivers' / Constructors'
            // Championship. Cron only auto-resolves markets whose
            // end_time has passed; for these we set end_time to a
            // few days after the season finale, so by then the
            // standings are mathematically locked.
            result = await readJolpicaF1Standings({
              season: cfg.season,
              kind: cfg.kind, // 'drivers' | 'constructors'
            });
          } else if (cfg.source === 'espn-pga') {
            // PGA Tour: ESPN PGA scoreboard. Returns the order=1
            // player using the same winnerDriverId/Label shape as F1
            // so the parallel-shape branch below picks it up
            // unchanged (id-match → label-match → 'Otro' fallback).
            // Team events (Zurich Classic) fall through to 'Otro'.
            result = await readEspnPgaWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'espn-liv') {
            // LIV Golf — same scoreboard shape as PGA, just a
            // different leaguePath under ESPN's golf API. Same
            // winnerDriverId/Label envelope, same parallel-shape
            // matcher. LIV uses team scores too (4-man teams) but
            // the individual leaderboard always has order=1; we
            // resolve on the individual winner.
            result = await readEspnLivWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'odds-api-boxing') {
            // Boxing — the-odds-api scores endpoint. Returns the
            // winner by name (no id-system in their API), which
            // matches what we wrote into legs[].driverId at
            // generation time. Draws/no-contests come back as
            // completed=false; admin voids via /admin/void-market.
            result = await readOddsApiBoxingWinner({ eventId: cfg.eventId });
          } else if (cfg.source === 'next-opponent') {
            // "Next opponent" markets for marquee fighters. Hits
            // either ESPN MMA scoreboard or the-odds-api boxing
            // depending on cfg.resolverSource. Returns the opponent
            // name as winnerDriverLabel; cron's parallel-shape
            // matcher does loose name match against legs[].label
            // (case-insensitive substring either direction).
            result = await readNextOpponent({
              fighterLabel: cfg.fighterLabel,
              resolverSource: cfg.resolverSource,
            });
          } else if (cfg.source === 'espn-mma') {
            // UFC — per-fight winner from the MMA scoreboard.
            // Passes both eventId (the card) and fightId (the bout).
            // Draws return completed=false; admin handles those via
            // /api/points/admin/void-market.
            result = await readEspnMmaWinner({
              eventId: cfg.eventId,
              fightId: cfg.fightId,
            });
          } else if (cfg.source === 'espn-liv-teams' || cfg.source === 'livgolf-teams') {
            // LIV team-leaderboard — ESPN's API explicitly does NOT
            // expose team data ("Teams are not currently supported
            // for golf/liv"). We scrape livgolf.com/leaderboard
            // instead. Matched against the displayed event via
            // tournamentName + startDateIso; returns the same
            // winnerDriverId/Label envelope as the individual
            // readers so the parallel-shape matcher handles it
            // unchanged. See _lib/sports-results.js for the parser.
            result = await readLivTeamWinner({
              tournamentName: cfg.tournamentName,
              startDateIso: cfg.startDateIso,
            });
          } else if (cfg.source === 'espn-atp-tournament') {
            // ATP tournament-winner markets (Slams + Masters 1000
            // + ATP 500). Pulls /atp/scoreboard for the tournament
            // event, walks groupings → mens-singles → Final
            // (round.id='7'), and returns the competitor with
            // winner=true. Same envelope as the other parallel-
            // shape readers.
            result = await readEspnAtpTournamentWinner({ eventId: cfg.eventId });
          } else {
            throw new Error(`unsupported sports_api source: ${cfg.source}`);
          }

          // Not completed yet = benign skip. Cron will retry on the
          // next tick; a postponed game just keeps retrying until
          // admin intervenes (no auto-escalation for now).
          if (!result.completed) {
            const err = new Error('not_finished_yet');
            err.benign = true;
            err.info = {
              source: cfg.source,
              state: result.state || null,
              notFound: result.notFound === true,
            };
            throw err;
          }

          // Map winner → outcome index per shape.
          if (cfg.shape === 'binary') {
            // Outcomes [home, away] — MLB/NBA
            if (result.winner === 'home') winningIdx = 0;
            else if (result.winner === 'away') winningIdx = 1;
            else throw new Error(`binary sport got draw/null winner: ${result.winner}`);
          } else if (cfg.shape === 'draw3') {
            // Outcomes [home, 'Empate', away] — soccer 3-way
            if (result.winner === 'home')      winningIdx = 0;
            else if (result.winner === 'draw') winningIdx = 1;
            else if (result.winner === 'away') winningIdx = 2;
            else throw new Error(`draw3 sport got null winner`);
          } else if (cfg.shape === 'parallel') {
            // F1 / similar — cfg.legs is [{ label, driverId }]. Match
            // the winner driverId against the list; fallback to exact
            // and loose driver-label matching; finally fall back to the
            // "Otro" leg if present (driverId === null).
            if (!Array.isArray(cfg.legs) || cfg.legs.length === 0) {
              throw new Error('parallel sport: missing cfg.legs');
            }
            const idx = findParallelWinnerIndex(cfg.legs, result);
            if (idx < 0) {
              throw new Error(`no leg matched winner "${result.winnerDriverLabel}"`);
            }
            winningIdx = idx;
          } else {
            throw new Error(`unknown sports_api shape: ${cfg.shape}`);
          }

          resolverInfo = {
            source: cfg.source,
            shape: cfg.shape,
            winner: result.winner,
            homeScore: result.homeScore ?? null,
            awayScore: result.awayScore ?? null,
            winnerDriver: result.winnerDriverLabel ?? null,
          };
        } else {
          throw new Error(`unknown resolver_type: ${m.resolver_type}`);
        }
      } catch (e) {
        if (e?.benign) {
          const deferred = {
            id: m.id,
            reason: e.message || 'deferred',
            ...(e.info || {}),
          };
          if (!dry && m.resolver_type === 'sports_api' && cfg.source === 'next-opponent') {
            const checkedAt = new Date().toISOString();
            try {
              await schemaSql`
                UPDATE points_markets
                   SET resolver_config = COALESCE(resolver_config, '{}'::jsonb)
                     || ${JSON.stringify({ nextOpponentLastCheckedAt: checkedAt })}::jsonb
                 WHERE id = ${m.id}
                   AND status = 'active'
              `;
              deferred.nextOpponentLastCheckedAt = checkedAt;
            } catch (patchErr) {
              deferred.checkPatchError = patchErr?.message?.slice(0, 160) || 'patch_failed';
            }
          }
          report.deferred.push(deferred);
          continue;
        }
        report.errors.push({ id: m.id, error: `resolve_failed: ${e.message}` });
        continue;
      }

      if (winningIdx == null || !Number.isInteger(winningIdx) || winningIdx < 0) {
        report.errors.push({ id: m.id, error: `invalid winningIdx ${winningIdx}` });
        continue;
      }

      // Build the human-readable score string (e.g. "México 3-2 Brasil",
      // "🏁 Verstappen", "BTC · 98,421") from the same data we already
      // pulled from the source. Falls back to the winning outcome label
      // when the source doesn't give us a scoreline.
      const marketOutcomes = parseJsonb(m.outcomes, []);
      const finalScore = buildFinalScore({
        resolverType: m.resolver_type,
        cfg,
        result,
        resolverInfo,
        outcomes: marketOutcomes,
        winningIdx,
      });

      if (dry) {
        report.resolved.push({ id: m.id, winningIdx, finalScore, ...resolverInfo, dry: true });
        continue;
      }

      try {
        await withTransaction(async (client) => {
          // Two-step UPDATE: core resolution must always work; the
          // final_score patch is best-effort (column may not exist on
          // older schemas — treat 42703 as benign skip).
          const r = await client.query(
            `UPDATE points_markets
               SET status = 'resolved', outcome = $1,
                   resolved_at = NOW(), resolved_by = $2
             WHERE id = $3 AND status = 'active'
             RETURNING id, amm_mode`,
            [winningIdx, `resolver:${m.resolver_type}`, m.id],
          );
          if (r.rows.length === 0) {
            const err = new Error('not_active_at_write'); err.benign = true; throw err;
          }
          // Optional score — never blocks the resolution itself.
          if (finalScore != null && finalScore !== '') {
            try {
              await client.query(
                `UPDATE points_markets SET final_score = $1 WHERE id = $2`,
                [finalScore, m.id],
              );
            } catch (e) {
              if (e?.code !== '42703') throw e;
              // 42703 = column doesn't exist; the resolution itself is
              // already committed above, so we just skip the score.
            }
          }
          if (resolverConfigPatch && Object.keys(resolverConfigPatch).length > 0) {
            await client.query(
              `UPDATE points_markets
                  SET resolver_config = COALESCE(resolver_config, '{}'::jsonb) || $1::jsonb
                WHERE id = $2`,
              [JSON.stringify(resolverConfigPatch), m.id],
            );
          }
          // Cascade to parallel legs (mirrors admin resolve-market.js):
          // winning leg's YES side pays out; losing legs' NO side pays.
          if (m.amm_mode === 'parallel') {
            const legs = await client.query(
              `SELECT id FROM points_markets
                 WHERE parent_id = $1
                 ORDER BY id ASC
                 FOR UPDATE`,
              [m.id],
            );
            for (let i = 0; i < legs.rows.length; i++) {
              const legWinningOutcome = i === winningIdx ? 0 : 1;
              await client.query(
                `UPDATE points_markets
                   SET status = 'resolved', outcome = $1,
                       resolved_at = NOW(), resolved_by = $2
                 WHERE id = $3 AND status = 'active'`,
                [legWinningOutcome, `resolver:${m.resolver_type}`, legs.rows[i].id],
              );
            }
          }

          await bestEffortPersistResolvedCryptoMarketSnapshot(
            client,
            m.id,
            'cron/points-auto-resolve',
          );
        });
        report.resolved.push({ id: m.id, winningIdx, ...resolverInfo });
      } catch (e) {
        if (e.benign) continue; // already resolved by admin — fine
        report.errors.push({ id: m.id, error: `write_failed: ${e.message}` });
      }
    }

  return {
    ok: true,
    tookMs: Date.now() - started,
    ...report,
  };
}

export default async function handler(req, res) {
  // Same cron-guard pattern as every other /api/cron/* endpoint.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev — allow through.
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const result = await runAutoResolve({ dry });
    return res.status(200).json(result);
  } catch (e) {
    console.error('[cron/points-auto-resolve] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'resolve_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
