/**
 * Crypto over/under market generator.
 *
 * Reads current BTC and ETH spot from Chainlink Price Feeds on Arbitrum
 * One, rounds up to a "neat" strike, and proposes one weekly binary
 * market per asset: "¿<ASSET> cerrará por encima de $X el {date}?".
 *
 * Markets are tagged with resolver_type='chainlink_price' + enough
 * resolver_config for the points auto-resolve cron to settle them
 * automatically at end_time — no admin needed once approved.
 *
 * source_event_id is namespaced by asset + week + strike so re-running
 * the generator the same week is a no-op (the ON CONFLICT DO NOTHING
 * upsert on (source, source_event_id) in points_pending_markets handles
 * the dedup).
 */
import { readChainlinkPrice, FEEDS_ARBITRUM_ONE } from '../chainlink.js';

// Round up to the nearest multiple of `step`.
function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

// Next Sunday 23:59 UTC. If today IS Sunday, skip to the one after so
// we never generate a market whose end_time is less than a few hours
// away (not enough depth to build open interest).
function nextSundayEndUtc(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();            // 0 = Sun
  const daysAhead = (7 - day) % 7 || 7; // today Sun → next Sun
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(23, 59, 0, 0);
  return d;
}

function formatDateYmd(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function formatDateEs(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

// Per-asset strike granularity. Gets a round, memorable number near spot
// (e.g. BTC 67,842 → strike 70,000 with step 5k; ETH 2,510 → strike 3,000
// with step 500). Intentionally generous so we're not picking too close
// to spot — otherwise the market opens at ~50/50 and resolves on a
// small wick.
const ASSET_CONFIG = {
  BTC: { feed: FEEDS_ARBITRUM_ONE.BTC_USD, step: 5000, icon: '₿' },
  ETH: { feed: FEEDS_ARBITRUM_ONE.ETH_USD, step: 500,  icon: 'Ξ' },
};

export async function generateCryptoMarkets() {
  const specs = [];
  const end = nextSundayEndUtc();
  const endIso = end.toISOString();
  const endYmd = formatDateYmd(end);
  const endEs = formatDateEs(end);

  for (const [asset, cfg] of Object.entries(ASSET_CONFIG)) {
    let spot;
    try {
      spot = await readChainlinkPrice(cfg.feed);
    } catch (e) {
      console.error('[market-gen/crypto] feed read failed', {
        asset,
        feed: cfg.feed.feedAddress,
        message: e?.message,
      });
      continue;
    }
    if (!Number.isFinite(spot) || spot <= 0) continue;

    const strike = nextRoundStrike(spot, cfg.step);
    const strikeStr = strike.toLocaleString('es-MX');

    specs.push({
      source: 'chainlink',
      source_event_id: `crypto:${asset}:${endYmd}:${strike}`,
      question: `¿${asset} cerrará por encima de $${strikeStr} USD el ${endEs}?`,
      category: 'crypto',
      icon: cfg.icon,
      outcomes: ['Sí', 'No'],
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'unified',
      resolver_type: 'chainlink_price',
      resolver_config: {
        feedAddress: cfg.feed.feedAddress,
        chainId: cfg.feed.chainId,
        symbol: cfg.feed.symbol,
        threshold: strike,
        op: 'gt',
        yesOutcome: 0, // outcomes[0] = 'Sí' (price > threshold at resolve time)
      },
      source_data: {
        asset,
        spotAtGeneration: spot,
        strike,
        step: cfg.step,
        feed: cfg.feed.feedAddress,
      },
    });
  }

  return specs;
}
