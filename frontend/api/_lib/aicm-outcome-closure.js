import { impossibleAicmBuckets, decidedAicmBucket, readConfirmedAicmDepartures } from './aicm-outcome-policy.js';
import { releaseOpenLimitOrdersForMarkets } from './points-limit-orders.js';

// Run inside a transaction after each timetable poll. Only departed flights
// count toward irreversible elimination; waiting/cancelled flights never do.
export async function closeImpossibleAicmOutcomes(client,{releaseOrders=releaseOpenLimitOrdersForMarkets}={}) {
  const result=await client.query(`SELECT id,outcomes,resolver_config FROM points_markets
    WHERE status='active' AND parent_id IS NULL AND amm_mode='parallel'
      AND COALESCE(mode,'points')='points' AND resolver_type='aicm_delay_minutes_live'
    ORDER BY id FOR UPDATE`);
  const closed=[];
  for (const parent of result.rows || result) {
    const cfg=typeof parent.resolver_config==='string'?JSON.parse(parent.resolver_config):parent.resolver_config;
    const outcomes=typeof parent.outcomes==='string'?JSON.parse(parent.outcomes):parent.outcomes;
    if (!Array.isArray(cfg?.buckets) || !Array.isArray(outcomes) || cfg.buckets.length!==outcomes.length
      || cfg.buckets.some((bucket,i)=>bucket.label!==outcomes[i])) throw new Error('aicm_bucket_identity_mismatch');
    const count=await readConfirmedAicmDepartures(client,cfg);
    const indexes=impossibleAicmBuckets(cfg.buckets,count);
    if (!indexes.length) continue;
    const labels=indexes.map(i=>outcomes[i]);
    const legs=await client.query(`SELECT id,leg_label FROM points_markets WHERE parent_id=$1
      AND status='active' AND leg_label=ANY($2::text[]) ORDER BY id FOR UPDATE`,[parent.id,labels]);
    for (const leg of legs.rows || legs) {
      await releaseOrders(client,[Number(leg.id)],{reason:'outcome_impossible'});
      const evidence={reason:'confirmed_departure_threshold_exceeded',confirmedDelayedDepartures:count,
        bucket:cfg.buckets[outcomes.indexOf(leg.leg_label)],closedAt:new Date().toISOString(),source:'aviation-edge-timetable'};
      await client.query(`UPDATE points_markets SET status='resolved',outcome=1,resolved_at=NOW(),
        resolved_by='resolver:aicm-impossible-outcome',final_score=$2,
        resolver_config=COALESCE(resolver_config,'{}'::jsonb)||$3::jsonb WHERE id=$1 AND status='active'`,
        [leg.id,`${count} salidas demoradas confirmadas; ${leg.leg_label} ya no es posible`,JSON.stringify({earlyClosure:evidence})]);
      closed.push({marketId:Number(parent.id),legId:Number(leg.id),label:leg.leg_label,confirmedDelayedDepartures:count});
    }
    // Once the unbounded final bucket is certain, stop trading there too.
    // The parent still waits for its published full-window resolution time.
    if (decidedAicmBucket(cfg.buckets,count) != null) {
      const stopped = await client.query(`UPDATE points_markets SET end_time=LEAST(end_time,NOW()),
        resolver_config=COALESCE(resolver_config,'{}'::jsonb)||jsonb_build_object('tradingClosure',
          jsonb_build_object('reason','airport_bucket_decided','confirmedDelayedDepartures',$2::int,
            'closedAt',NOW(),'originalEndTime',COALESCE(resolver_config->'tradingClosure'->'originalEndTime',to_jsonb(end_time))))
        WHERE (id=$1 OR parent_id=$1) AND status='active' AND (end_time IS NULL OR end_time>NOW())
        RETURNING id`,[parent.id,count]);
      const stoppedIds = (stopped.rows || stopped).map(row => Number(row.id));
      if (stoppedIds.length) await releaseOrders(client,stoppedIds,{reason:'outcome_decided'});
    }
  }
  return closed;
}
