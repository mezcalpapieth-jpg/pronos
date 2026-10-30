function json(value) { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value); } catch { return {}; } }
export function impossibleAicmBuckets(buckets, confirmedDepartures) {
  const count = Number(confirmedDepartures);
  if (!Array.isArray(buckets) || !Number.isInteger(count) || count < 0) return [];
  return buckets.flatMap((bucket,index) => {
    if (bucket.max == null || bucket.max === '') return [];
    const max = Number(bucket.max), min = Number(bucket.min);
    return Number.isInteger(min) && min >= 0 && Number.isInteger(max) && max >= min && count > max ? [index] : [];
  });
}
export function decidedAicmBucket(buckets,count) {
  if (!Array.isArray(buckets) || !buckets.length || !Number.isInteger(Number(count))) return null;
  let nextMin=0;
  for(let i=0;i<buckets.length;i++) {
    const bucket=buckets[i];
    if(Number(bucket.min)!==nextMin) return null;
    if(bucket.max==null) return i===buckets.length-1 && Number(count)>=nextMin ? i : null;
    if(!Number.isInteger(Number(bucket.max)) || Number(bucket.max)<nextMin) return null;
    nextMin=Number(bucket.max)+1;
  }
  return null;
}
export async function readConfirmedAicmDepartures(db,cfg) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cfg.fromDateYmd || '') || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.toDateYmd || '') || cfg.direction !== 'departure') throw new Error('aicm_invalid_window');
  const threshold=Number(cfg.thresholdMinutes ?? 30);
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('aicm_invalid_threshold');
  const result=await db.query(`SELECT COUNT(*)::int AS count FROM points_aicm_timetable_observations
    WHERE direction='departure' AND flight_date >= $1::date AND flight_date <= $2::date
      AND delay_minutes > $3 AND NULLIF(actual_local,'') IS NOT NULL
      AND LOWER(status) IN ('active','landed','departed','en-route')`, [cfg.fromDateYmd,cfg.toDateYmd,threshold]);
  return Number((Array.isArray(result)?result:result.rows)?.[0]?.count || 0);
}
export async function airportOutcomeTradeLock(market,{db}={}) {
  if (market?.parent_resolver_type !== 'aicm_delay_minutes_live') return null;
  try {
    const cfg=json(market.parent_resolver_config);
    if (!db || !Array.isArray(cfg.buckets) || !market.leg_label) throw new Error('missing_airport_metadata');
    const index=cfg.buckets.findIndex(bucket=>bucket.label===market.leg_label);
    if (index<0) throw new Error('airport_outcome_identity_mismatch');
    const count=await readConfirmedAicmDepartures(db,cfg);
    return impossibleAicmBuckets(cfg.buckets,count).includes(index) || decidedAicmBucket(cfg.buckets,count) != null
      ? { error:'outcome_closed',status:400,detail:'Trading is closed because confirmed delayed departures have made this outcome impossible or the final bucket certain.' } : null;
  } catch {
    return { error:'airport_status_unavailable',status:503,detail:'Departure totals could not be verified. Please try again shortly.' };
  }
}
