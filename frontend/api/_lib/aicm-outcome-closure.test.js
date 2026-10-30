import test from 'node:test';import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { impossibleAicmBuckets,decidedAicmBucket,airportOutcomeTradeLock,readConfirmedAicmDepartures } from './aicm-outcome-policy.js';
import {closeImpossibleAicmOutcomes} from './aicm-outcome-closure.js';
import {parallelLegResolutions} from './parallel-resolution.js';
const buckets=[{label:'0-1',min:0,max:1},{label:'2-3',min:2,max:3},{label:'4+',min:4,max:null}];
const cfg={buckets,fromDateYmd:'2026-10-29',toDateYmd:'2026-10-29',direction:'departure',thresholdMinutes:30};
test('a bucket closes only after exceeding its inclusive maximum, and the open-ended bucket stays open',()=>{
 assert.deepEqual(impossibleAicmBuckets(buckets,1),[]);assert.deepEqual(impossibleAicmBuckets(buckets,2),[0]);assert.deepEqual(impossibleAicmBuckets(buckets,3),[0]);assert.deepEqual(impossibleAicmBuckets(buckets,4),[0,1]);assert.equal(decidedAicmBucket(buckets,4),2);assert.equal(decidedAicmBucket(buckets,3),null);assert.equal(decidedAicmBucket([{min:1,max:null}],4),null);
 assert.deepEqual(impossibleAicmBuckets(buckets,NaN),[]);assert.deepEqual(impossibleAicmBuckets([{min:0,max:null}],9999),[]);
});
test('confirmed departed flights close impossible legs, release orders, allow No claims, and preserve the parent and remaining outcomes',async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE TABLE points_markets(id int,parent_id int,amm_mode text,mode text,resolver_type text,resolver_config jsonb,outcomes jsonb,status text,outcome int,leg_label text,resolved_at timestamptz,resolved_by text,final_score text,end_time timestamptz);
   CREATE TABLE points_aicm_timetable_observations(direction text,flight_date date,delay_minutes int,actual_local text,status text);
   INSERT INTO points_aicm_timetable_observations VALUES
   ('departure','2026-10-29',31,'2026-10-29T01:00','active'),('departure','2026-10-29',60,'2026-10-29T02:00','landed'),('departure','2026-10-29',80,'2026-10-29T03:00','departed'),
   ('departure','2026-10-29',100,NULL,'scheduled'),('departure','2026-10-29',100,'2026-10-29T04:00','cancelled'),('departure','2026-10-29',30,'2026-10-29T05:00','landed'),('arrival','2026-10-29',100,'2026-10-29T06:00','landed'),('departure','2026-10-28',100,'2026-10-28T06:00','landed');`);
  await db.query(`INSERT INTO points_markets(id,amm_mode,mode,resolver_type,resolver_config,outcomes,status) VALUES(1,'parallel','points','aicm_delay_minutes_live',$1::jsonb,$2::jsonb,'active')`,[JSON.stringify(cfg),JSON.stringify(buckets.map(b=>b.label))]);
  for(let i=0;i<3;i++)await db.query(`INSERT INTO points_markets(id,parent_id,status,leg_label) VALUES($1,1,'active',$2)`,[i+2,buckets[i].label]);
  const count=await readConfirmedAicmDepartures(db,cfg);assert.equal(count,3);
  const market={parent_resolver_type:'aicm_delay_minutes_live',parent_resolver_config:cfg,leg_label:'0-1'};
  assert.equal((await airportOutcomeTradeLock(market,{db})).error,'outcome_closed');
  assert.equal(await airportOutcomeTradeLock({...market,leg_label:'2-3'},{db}),null);
  const released=[];const closed=await closeImpossibleAicmOutcomes(db,{releaseOrders:async(_,ids)=>released.push(...ids)});
  assert.deepEqual(released,[2]);assert.equal(closed.length,1);
  const rows=(await db.query('SELECT * FROM points_markets ORDER BY id')).rows;
  assert.equal(rows[0].status,'active');assert.equal(rows[1].status,'resolved');assert.equal(rows[1].outcome,1);assert.equal(rows[2].status,'active');assert.equal(rows[3].status,'active');
  assert.deepEqual(await closeImpossibleAicmOutcomes(db,{releaseOrders:async()=>assert.fail('idempotent')}),[]);
  assert.equal(parallelLegResolutions(rows.slice(1),buckets.map(b=>b.label),1)[0].winningOutcome,1);
  assert.throws(()=>parallelLegResolutions(rows.slice(1),buckets.map(b=>b.label),0),/prior_resolution_conflict/);
  await db.exec("INSERT INTO points_aicm_timetable_observations VALUES('departure','2026-10-29',90,'2026-10-29T07:00','landed')");
  assert.equal((await airportOutcomeTradeLock({...market,leg_label:'4+'},{db})).error,'outcome_closed');
  const finalReleased=[];
  await closeImpossibleAicmOutcomes(db,{releaseOrders:async(_,ids)=>finalReleased.push(...ids)});
  assert.deepEqual(finalReleased.sort((a,b)=>a-b),[1,3,4]);
  const decided=(await db.query('SELECT id,status,end_time FROM points_markets WHERE id IN(1,4) ORDER BY id')).rows;
  assert.ok(decided.every(row=>row.status==='active' && Date.parse(row.end_time)<=Date.now()));
 }finally{await db.close();}
});
test('airport trades fail closed on missing or invalid evidence, while unrelated markets have no extra lookup',async()=>{
 assert.equal(await airportOutcomeTradeLock({parent_id:5},{}),null);
 const market={parent_resolver_type:'aicm_delay_minutes_live',parent_resolver_config:cfg,leg_label:'0-1'};
 assert.equal((await airportOutcomeTradeLock(market,{})).status,503);
 assert.equal((await airportOutcomeTradeLock({...market,leg_label:'wrong'},{db:{query:()=>assert.fail('mismatch')}})).status,503);
});
