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
