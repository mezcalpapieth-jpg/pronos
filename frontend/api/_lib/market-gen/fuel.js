/**
 * Gasoline price market generator (Mexico, monthly).
 *
 * Reads the current national-average retail price for each fuel type
 * from CRE's public XML dump, rounds up to a $0.50 strike, and
 * proposes one binary over/under per fuel type per month:
 *   "Gasolina Regular cierre de abril > $24.00"
 *
 * resolver_type='api_price', resolver_config.source='cre-gasolina'.
 * The auto-resolver re-reads the average at close (last UTC minute of
 * the month) and compares to the stored threshold.
 *
 * Idempotent across re-runs within the same month because
 * source_event_id encodes fuel type + month + strike.
 */
import { readCreAverages, FUEL_TYPES, fuelLabel } from '../fuel.js';

function nextRoundStrike(current, step) {
  return Math.ceil(current / step) * step;
}

// Last UTC second of the current calendar month. Using UTC consistently
// with the rest of the generator pool so end_time compares cleanly
// against NOW() in the DB. Admin can edit in local tz if needed.
function endOfMonthUtc(now = new Date()) {
  // first day of NEXT month at 00:00 UTC, minus 1 minute
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  d.setUTCMinutes(d.getUTCMinutes() - 1);
  return d;
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export async function generateFuelMarkets() {
  let averages;
  try {
    averages = await readCreAverages();
  } catch (e) {
    console.error('[market-gen/fuel] CRE read failed', { message: e?.message });
    return [];
  }

  const end = endOfMonthUtc();
  const endIso = end.toISOString();
  const month = MONTH_ES[end.getUTCMonth()];
  const mKey = monthKey(end);

  const specs = [];
  for (const fuelType of FUEL_TYPES) {
    const avg = averages[fuelType];
    if (!Number.isFinite(avg) || avg <= 0) {
      console.warn('[market-gen/fuel] no average for', fuelType);
      continue;
    }
    // $0.50 strikes — gasoline moves 1–3% per month in typical conditions;
    // finer granularity would land too close to spot and resolve on noise.
    const strike = nextRoundStrike(avg, 0.5);
    const strikeStr = strike.toFixed(2);
    const label = fuelLabel(fuelType);

    specs.push({
      source: 'cre',
      source_event_id: `fuel:${fuelType}:${mKey}:${strikeStr}`,
      question: `${label} promedio nacional cierre de ${month} > $${strikeStr}`,
      category: 'finanzas',
      icon: '⛽',
      outcomes: ['Sí', 'No'],
      seed_liquidity: 1000,
      end_time: endIso,
      amm_mode: 'unified',
      resolver_type: 'api_price',
      resolver_config: {
        source: 'cre-gasolina',
        fuelType,
        threshold: strike,
        op: 'gt',
        yesOutcome: 0,
      },
      source_data: {
        fuelType,
        fuelLabel: label,
        spotAtGeneration: avg,
        sampleSize: averages.sampleSize?.[fuelType] ?? null,
        strike,
        month: mKey,
      },
    });
  }
  return specs;
}
