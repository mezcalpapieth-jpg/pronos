/**
 * CRE gasoline-price reader (México).
 *
 * Pulls CRE's public XML dump of station-level retail prices and
 * computes a national average per fuel type. Used by:
 *   - market-gen/fuel.js         → pick a monthly strike near the
 *                                   current national average
 *   - cron/points-auto-resolve   → settle api_price markets with
 *                                   source='cre-gasolina' by
 *                                   re-reading the average at close
 *
 * Data source: https://publicacionexterna.azurewebsites.net/publicaciones/prices
 * (hosted by CRE via Azure, ~2.5MB, ~17k stations, XML, no auth).
 *
 * We average across all reporting stations — duplicates from multiple
 * permisos at the same place_id are fine here; every retail point of
 * sale adds signal to the national baseline.
 */

const CRE_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/prices';

const FUEL_LABELS = {
  regular: 'Gasolina Regular',
  premium: 'Gasolina Premium',
  diesel:  'Diésel',
};

export const FUEL_TYPES = Object.keys(FUEL_LABELS); // ['regular','premium','diesel']

export function fuelLabel(type) {
  return FUEL_LABELS[type] || type;
}

/**
 * Fetch the CRE XML dump and extract every `<gas_price type="X">N</gas_price>`
 * entry, computing a mean per fuel type.
 *
 * Returns `{ regular, premium, diesel, sampleSize: { regular, premium, diesel } }`
 * with numeric means (or null if a type had zero valid samples). Throws
 * on network failure — caller catches and skips.
 *
 * Regex parse is intentional: xml2js is not worth the 200KB dep just
 * to average flat key/value tuples. The CRE schema is stable enough
 * that a tag-match pass is robust.
 */
export async function readCreAverages() {
  const res = await fetch(CRE_URL, {
    headers: { 'Accept': 'application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`cre: HTTP ${res.status}`);
  const xml = await res.text();

  const re = /<gas_price type="(regular|premium|diesel)">([\d.]+)<\/gas_price>/g;
  const sums = { regular: 0, premium: 0, diesel: 0 };
  const counts = { regular: 0, premium: 0, diesel: 0 };
  let m;
  while ((m = re.exec(xml)) !== null) {
    const type = m[1];
    const price = Number(m[2]);
    // Sanity bounds — MXN retail gasoline sits roughly $18–$35 per
    // liter; anything wildly outside is a bad data point or typo.
    if (!Number.isFinite(price) || price < 5 || price > 100) continue;
    sums[type] += price;
    counts[type] += 1;
  }

  const pick = (type) => counts[type] > 0 ? sums[type] / counts[type] : null;
  return {
    regular: pick('regular'),
    premium: pick('premium'),
    diesel:  pick('diesel'),
    sampleSize: { ...counts },
  };
}

/**
 * Convenience wrapper — read one fuel type's national average only.
 * Used by the auto-resolver where we already know the fuel type from
 * `resolver_config.fuelType`.
 */
export async function readCreAverageFor(fuelType) {
  const averages = await readCreAverages();
  const value = averages[fuelType];
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`cre: empty average for ${fuelType}`);
  }
  return { value, sampleSize: averages.sampleSize[fuelType] };
}
