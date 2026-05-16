import { readChainlinkPrice, readChainlinkRoundAtOrBefore, comparePrice } from './chainlink.js';
import { formatDirectionFinalScore, resolveDirectionOutcome } from './crypto-5min.js';
import { readFinnhubQuote } from './stockprice.js';
import { readBanxicoLatest } from './banxico.js';
import { readCreAverageFor } from './fuel.js';
import { fetchMaxTempC, bucketIndexFor } from './weather.js';
import { readAppleMxTopArtist } from './charts.js';
import { readYouTubeTopMxChannel } from './youtube.js';
import {
  readEspnEvent,
  readFootballDataMatch,
  readJolpicaF1Result,
  readJolpicaF1Standings,
  readEspnPgaWinner,
  readEspnLivWinner,
  readLivTeamWinner,
  readEspnAtpTournamentWinner,
  readEspnMmaWinner,
  readOddsApiBoxingWinner,
  readNextOpponent,
} from './sports-results.js';
import { findParallelWinnerIndex } from './sports-resolver-policy.js';

export function parseAutoResolverJsonb(value, fallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function buildAutoResolverFinalScore({
  resolverType,
  cfg,
  result,
  resolverInfo,
  outcomes,
  winningIdx,
}) {
  const winLabel = Array.isArray(outcomes) ? outcomes[winningIdx] : null;
  const clip = (s) => (s == null ? null : String(s).slice(0, 240));

  try {
    if (resolverType === 'sports_api') {
      if (cfg.shape === 'binary' || cfg.shape === 'draw3') {
        const home = Number.isFinite(result.homeScore) ? result.homeScore : null;
        const away = Number.isFinite(result.awayScore) ? result.awayScore : null;
        const score = home != null && away != null ? `${home}-${away}` : null;
        const homeName = result.homeTeam || null;
        const awayName = result.awayTeam || null;
        if (homeName && awayName && score) return clip(`${homeName} ${score} ${awayName}`);
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
        const short = typeof sym === 'string' ? sym.slice(0, 20) : '';
        const priceStr = typeof price === 'number'
          ? price.toLocaleString('en-US', { maximumFractionDigits: 4 })
          : String(price);
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
      const top = resolverInfo?.topArtist
        || resolverInfo?.topChannel
        || resolverInfo?.topTrack
        || resolverInfo?.topTitle;
      if (top) return clip(`#1 ${top}`);
      return clip(winLabel);
    }
  } catch {
    // Fall through to the generic winning-label fallback.
  }

  return clip(winLabel);
}

export async function resolveAutoResolverCandidate(candidate = {}) {
  const cfg = parseAutoResolverJsonb(candidate.resolver_config, null);
  if (!cfg) throw new Error('missing_resolver_config');

  const resolverType = candidate.resolver_type;
  let winningIdx = null;
  let resolverInfo = {};
  let resolverConfigPatch = null;
  let result = null;

  if (resolverType === 'chainlink_price') {
    if (cfg.shape === 'binary-direction') {
      if (!cfg.feedAddress || cfg.threshold == null) {
        throw new Error('invalid chainlink_price binary-direction config');
      }
      const closesAt = cfg.closesAt || candidate.end_time;
      if (!closesAt) throw new Error('binary-direction: missing closesAt');

      const round = await readChainlinkRoundAtOrBefore({
        feedAddress: cfg.feedAddress,
        chainId: cfg.chainId,
        timestamp: closesAt,
      });
      winningIdx = resolveDirectionOutcome(round.price, cfg.threshold);
      if (winningIdx == null) throw new Error(`binary-direction tie at ${round.price}`);
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
  } else if (resolverType === 'api_price') {
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
  } else if (resolverType === 'weather_api') {
    if (!cfg.lat || !cfg.lng || !cfg.forecastDateYmd || !Array.isArray(cfg.buckets)) {
      throw new Error('invalid weather_api config');
    }
    const tempC = await fetchMaxTempC({
      lat: cfg.lat,
      lng: cfg.lng,
      dateYmd: cfg.forecastDateYmd,
      timezone: cfg.timezone,
    });
    winningIdx = cfg.buckets.findIndex(b =>
      tempC >= Number(b.minC) && tempC < Number(b.maxC),
    );
    if (winningIdx < 0) winningIdx = bucketIndexFor(tempC);
    if (winningIdx < 0) throw new Error(`temp ${tempC}°C didn't fit any bucket`);
    resolverInfo = { recordedMaxC: tempC, forecastDateYmd: cfg.forecastDateYmd };
  } else if (resolverType === 'api_chart') {
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
      pickWinnerIdx = cfg.legs.findIndex(l =>
        !l.artist && !l.channel && !l.channelId,
      );
      if (pickWinnerIdx < 0) {
        throw new Error('no matching leg and no Otro fallback configured');
      }
    }
    winningIdx = pickWinnerIdx;
    resolverInfo = { source: cfg.source, ...readerEcho };
  } else if (resolverType === 'sports_api') {
    if (!cfg.source || !cfg.shape) {
      throw new Error('invalid sports_api config: missing source/shape');
    }

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
      result = await readJolpicaF1Standings({
        season: cfg.season,
        kind: cfg.kind,
      });
    } else if (cfg.source === 'espn-pga') {
      result = await readEspnPgaWinner({ eventId: cfg.eventId });
    } else if (cfg.source === 'espn-liv') {
      result = await readEspnLivWinner({ eventId: cfg.eventId });
    } else if (cfg.source === 'odds-api-boxing') {
      result = await readOddsApiBoxingWinner({ eventId: cfg.eventId });
    } else if (cfg.source === 'next-opponent') {
      result = await readNextOpponent({
        fighterLabel: cfg.fighterLabel,
        resolverSource: cfg.resolverSource,
      });
    } else if (cfg.source === 'espn-mma') {
      result = await readEspnMmaWinner({
        eventId: cfg.eventId,
        fightId: cfg.fightId,
      });
    } else if (cfg.source === 'espn-liv-teams' || cfg.source === 'livgolf-teams') {
      result = await readLivTeamWinner({
        tournamentName: cfg.tournamentName,
        startDateIso: cfg.startDateIso,
      });
    } else if (cfg.source === 'espn-atp-tournament') {
      result = await readEspnAtpTournamentWinner({ eventId: cfg.eventId });
    } else {
      throw new Error(`unsupported sports_api source: ${cfg.source}`);
    }

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

    if (cfg.shape === 'binary') {
      if (result.winner === 'home') winningIdx = 0;
      else if (result.winner === 'away') winningIdx = 1;
      else throw new Error(`binary sport got draw/null winner: ${result.winner}`);
    } else if (cfg.shape === 'draw3') {
      if (result.winner === 'home') winningIdx = 0;
      else if (result.winner === 'draw') winningIdx = 1;
      else if (result.winner === 'away') winningIdx = 2;
      else throw new Error('draw3 sport got null winner');
    } else if (cfg.shape === 'parallel') {
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
    throw new Error(`unknown resolver_type: ${resolverType}`);
  }

  const outcomes = parseAutoResolverJsonb(candidate.outcomes, []);
  const finalScore = buildAutoResolverFinalScore({
    resolverType,
    cfg,
    result,
    resolverInfo,
    outcomes,
    winningIdx,
  });

  return {
    cfg,
    winningIdx,
    resolverInfo,
    resolverConfigPatch,
    result,
    finalScore,
  };
}
