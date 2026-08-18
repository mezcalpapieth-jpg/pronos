/**
 * USD/MXN FX market generator.
 *
 * Reads the latest Banxico FIX rate (the canonical reference everyone
 * quotes), rounds up to a neat strike (nearest $0.25), and proposes
 * one weekly binary market:
 *   "USD/MXN cierre del viernes > $X.XX"
 *
 * resolver_type='api_price', resolver_config.source='banxico-fix' so
 * the auto-resolver re-reads the same series at close time.
 *
 * Idempotent across re-runs within the same week because source_event_id
 * is namespaced by the Friday-of-week date + strike.
 */
import { BANXICO_FIX_RESOLUTION_CRITERIA, readBanxicoLatest, SERIES } from '../banxico.js';
import { formatMexicoDateEs, formatMexicoDateYmd, nextMexicoFridayClose } from './mexico-time.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

export async function generateFxMarkets() {
  if (!process.env.BANXICO_API_TOKEN) {
    console.warn('[market-gen/fx] BANXICO_API_TOKEN not set — skipping');
    return [];
  }

  let latest;
  try {
    latest = await readBanxicoLatest(SERIES.FX_USD_MXN);
  } catch (e) {
    console.error('[market-gen/fx] banxico read failed', { message: e?.message });
    return [];
  }
  if (!Number.isFinite(latest?.value) || latest.value <= 0) return [];

  const end = nextMexicoFridayClose();
  const endIso = end.toISOString();
  const endYmd = formatMexicoDateYmd(end);
  const endEs  = formatMexicoDateEs(end);

  // 0.25 MXN step → natural round numbers like $20.25 / $20.50 / $20.75.
  // Peso moves maybe 0.5-1% in a week, so a 0.25 strike keeps the
  // market roughly balanced and resolves with non-trivial signal.
  const strike = nextRoundStrike(latest.value, 0.25);
  const strikeStr = strike.toFixed(2);

  return [{
    source: 'banxico',
    source_event_id: `fx:USDMXN:${endYmd}:${strikeStr}`,
    question: `USD/MXN cierre del viernes > $${strikeStr}`,
    category: 'finanzas',
    icon: '🇲🇽',
    outcomes: ['Sí', 'No'],
    seed_liquidity: 1000,
    end_time: endIso,
    amm_mode: 'unified',
    resolver_type: 'api_price',
    resolver_config: {
      source: 'banxico-fix',
      seriesId: SERIES.FX_USD_MXN,
      threshold: strike,
      op: 'gt',
      yesOutcome: 0,
      resolveDateYmd: endYmd,
      criteria: BANXICO_FIX_RESOLUTION_CRITERIA,
      rationale: BANXICO_FIX_RESOLUTION_CRITERIA,
    },
    source_data: {
      pair: 'USD/MXN',
      seriesId: SERIES.FX_USD_MXN,
      seriesTitle: latest.title,
      spotAtGeneration: latest.value,
      spotFecha: latest.fecha,
      strike,
      resolveDateYmd: endYmd,
      endLabel: endEs,
      resolutionCriteria: BANXICO_FIX_RESOLUTION_CRITERIA,
    },
  }];
}
