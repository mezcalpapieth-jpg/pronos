import test from 'node:test';import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readCoordinatedTrading,summarizeCoordinatedTrading,coordinationScore} from './points-risk-coordination.js';
const match=(name,id)=>({donor_username:name,donor_trade_id:id,donor_spend:600,market_id:5,donor_at:'2026-10-29T01:01:00Z',signup_at:'2026-10-29T01:00:00Z',beneficiary:'target',beneficiary_side:'buy',beneficiary_outcome:0,beneficiary_trade_id:9,beneficiary_at:'2026-10-29T01:02:00Z',reserves_before:[100,100],reserves_after:[150,50],question:'fixture'});
test('risk evidence deduplicates fills and counts independent accounts, never treating IP or referral links as guilt',()=>{
 const a=match('a',1),b=match('b',2);const groups=summarizeCoordinatedTrading([a,a,b]);assert.equal(groups.length,1);assert.equal(groups[0].donorCount,2);assert.equal(groups[0].donorSpend,1200);assert.deepEqual(groups[0].beneficiaryTradeIds,[9]);
 assert.deepEqual(coordinationScore(groups,'target'),{coordinatedMarketCount:1,coordinatedDonorCount:2,coordinationRiskScore:30});assert.equal(coordinationScore(groups,'unrelated').coordinationRiskScore,0);
 assert.deepEqual(summarizeCoordinatedTrading([a]),[]);assert.deepEqual(summarizeCoordinatedTrading([{...a,reserves_after:[100,100]},b]),[]);assert.deepEqual(summarizeCoordinatedTrading([{...a,reserves_before:'invalid'},b]),[]);
});
test('SQL finds VPN-independent favorable price sequences and rejects old, selling, treasury, or irrelevant-side donors',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE points_users(username text,created_at timestamptz);CREATE TABLE points_markets(id int,question text,mode text);
 CREATE TABLE points_trades(id int,username text,market_id int,side text,outcome_index int,collateral numeric,created_at timestamptz,reserves_before jsonb,reserves_after jsonb);
 CREATE TABLE points_referrals(referred text,referrer text);
 INSERT INTO points_markets VALUES(5,'fixture','points');
 INSERT INTO points_users VALUES('a','2026-10-29T01:00Z'),('b','2026-10-29T01:00Z'),('old','2026-09-01T00:00Z'),('target','2026-10-01T00:00Z');
 INSERT INTO points_trades VALUES(1,'a',5,'buy',1,600,'2026-10-29T01:01Z','[100,100]','[150,50]'),(2,'b',5,'buy',1,600,'2026-10-29T01:01:10Z','[150,50]','[200,25]'),(3,'old',5,'buy',1,600,'2026-10-29T01:01:20Z','[200,25]','[250,20]'),(9,'target',5,'buy',0,1000,'2026-10-29T01:02Z','[250,20]','[100,100]');`);
 const groups=await readCoordinatedTrading(db,{now:new Date('2026-10-30T00:00Z')});assert.equal(groups.length,1);assert.deepEqual(groups[0].donors.map(d=>d.username),['a','b']);
 assert.deepEqual(await readCoordinatedTrading(db,{username:'unrelated',now:new Date('2026-10-30T00:00Z')}),[]);
 await db.exec(`INSERT INTO points_trades VALUES(10,'b',5,'sell',1,50,'2026-10-29T02:00Z','[100,100]','[100,100]');`);
 assert.deepEqual(await readCoordinatedTrading(db,{now:new Date('2026-10-30T00:00Z')}),[]);
 }finally{await db.close();}
});
