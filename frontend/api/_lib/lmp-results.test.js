import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeLmpResult,readLmpEvent} from './lmp-results.js';
import {generateLmpMarkets} from './market-gen/lmp.js';
const team=id=>({id,name:`Team ${id}`,league:{id:132},sport:{id:17}});
const game=(patch={})=>({gamePk:123,gameDate:'2026-10-31T02:00:00Z',officialDate:'2026-10-30',status:{abstractGameState:'Preview',codedGameState:'S',startTimeTBD:false},teams:{home:{team:team(1),score:3},away:{team:team(2),score:1}},...patch});
const response=games=>async()=>({ok:true,json:async()=>({dates:[{games}]})});
test('LMP generates only real scheduled future games with known start times and stable game IDs',async()=>{
 const good=game();const specs=await generateLmpMarkets({now:new Date('2026-10-30T00:00Z'),fetchImpl:response([good,good,game({gamePk:124,status:{abstractGameState:'Live',codedGameState:'I'}}),game({gamePk:125,status:{abstractGameState:'Preview',codedGameState:'S',startTimeTBD:true}}),game({gamePk:126,gameDate:'2026-10-29T00:00Z'})])});
 assert.equal(specs.length,1);assert.equal(specs[0].source_event_id,'123');assert.equal(specs[0].league,'lmp');assert.equal(specs[0].resolver_type,'sports_api');assert.deepEqual(specs[0].resolver_config,{source:'mlb-stats',shape:'binary',eventId:'123',leagueId:132,homeId:1,awayId:2,dateYmd:'2026-10-30'});
});
test('official LMP finals resolve home/away; live, interrupted and tied results do not settle',()=>{
 const cfg={eventId:'123',homeId:1,awayId:2};const final=game({status:{abstractGameState:'Final',codedGameState:'F',detailedState:'Final'}});
 assert.equal(normalizeLmpResult(final,cfg).winner,'home');final.teams.away.score=5;assert.equal(normalizeLmpResult(final,cfg).winner,'away');
 for(const status of [{abstractGameState:'Live',codedGameState:'I'},{abstractGameState:'Final',codedGameState:'O',detailedState:'Game Over'},{abstractGameState:'Live',codedGameState:'F',detailedState:'Suspended'}])assert.equal(normalizeLmpResult(game({status}),cfg).completed,false);
 final.teams.home.score=5;assert.equal(normalizeLmpResult(final,cfg).completed,false);final.teams.home.score=null;assert.equal(normalizeLmpResult(final,cfg).completed,false);
});
test('LMP resolver rejects mismatched event/team/league identity and missing official evidence',async()=>{
 const bad=game();bad.teams.home.team.league.id=103;assert.throws(()=>normalizeLmpResult(bad,{eventId:'123'}),/mismatch/);
 assert.throws(()=>normalizeLmpResult(game(),{eventId:'124'}),/mismatch/);assert.throws(()=>normalizeLmpResult(game(),{eventId:'123',homeId:99}),/mismatch/);
 await assert.rejects(readLmpEvent({eventId:'123'},{fetchImpl:response([])}),/not_found/);
 await assert.rejects(readLmpEvent({eventId:'123'},{fetchImpl:async()=>({ok:false,status:503})}),/503/);
});

test('LMP follows a postponed game to its official makeup final in either feed order', async () => {
 const cfg={eventId:'123',homeId:1,awayId:2};
 const postponed=game({status:{codedGameState:'D',detailedState:'Postponed'},rescheduleDate:'2026-11-01T00:05:00Z'});
 const makeup=game({gameDate:'2026-11-01T00:05:00Z',rescheduledFrom:postponed.gameDate,status:{codedGameState:'F',detailedState:'Final'}});
 for(const games of [[postponed,makeup],[makeup,postponed]]) {
  const result=await readLmpEvent(cfg,{fetchImpl:response(games)});
  assert.equal(result.completed,true);assert.equal(result.winner,'home');assert.equal(result.gameDate,makeup.gameDate);
 }
 const scheduled={...makeup,status:{abstractGameState:'Preview',codedGameState:'S'}};
 const pending=await readLmpEvent(cfg,{fetchImpl:response([postponed,scheduled])});
 assert.equal(pending.completed,false);assert.equal(pending.winner,null);assert.equal(pending.state,'pre');
});
test('LMP rejects unrelated dates, participant changes and conflicting finals under one game ID', async () => {
 const cfg={eventId:'123',homeId:1,awayId:2};
 const final=game({status:{codedGameState:'F',detailedState:'Final'}});
 const conflicting=structuredClone(final);conflicting.teams.away.score=7;
 await assert.rejects(readLmpEvent(cfg,{fetchImpl:response([final,conflicting])}),/conflicting_final/);
 const otherDate=game({gameDate:'2026-11-01T00:05:00Z',status:{codedGameState:'F'}});
 await assert.rejects(readLmpEvent(cfg,{fetchImpl:response([game(),otherDate])}),/ambiguous_reschedule/);
 const wrongTeam=structuredClone(final);wrongTeam.teams.home.team.id=99;
 await assert.rejects(readLmpEvent(cfg,{fetchImpl:response([game(),wrongTeam])}),/mismatch/);
 await assert.rejects(readLmpEvent({eventId:'123'},{fetchImpl:response([game(),wrongTeam])}),/mismatch/);
 const wrongLeague=structuredClone(final);wrongLeague.teams.home.team.league.id=103;
 await assert.rejects(readLmpEvent(cfg,{fetchImpl:response([final,wrongLeague])}),/mismatch/);
 const otherId=game({gamePk:456,status:{codedGameState:'F'}});
 const pending=await readLmpEvent(cfg,{fetchImpl:response([game(),otherId])});assert.equal(pending.completed,false);
 const linkedFinal={...otherDate,rescheduledFrom:final.gameDate};
 await assert.rejects(readLmpEvent(cfg,{fetchImpl:response([final,linkedFinal])}),/conflicting_final/);
});
