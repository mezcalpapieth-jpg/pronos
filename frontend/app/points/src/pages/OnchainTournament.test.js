import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{MemoryRouter}=require('react-router-dom');
const {buildSync}=require('esbuild');
const {outputFiles}=buildSync({entryPoints:[new URL('./OnchainTournamentView.jsx',import.meta.url).pathname],bundle:true,write:false,
  format:'cjs',platform:'node',external:['react','react-router-dom']});
const compiled={exports:{}};new Function('require','module','exports',outputFiles[0].text)(require,compiled,compiled.exports);
const {TournamentPresentation}=compiled.exports;
const rules={minEntryMxnp:100,qualifyingMarkets:10,inactivityPenalty:50};
const current={cycleId:'current-season',label:'Current season',startsAt:'2026-11-01T06:00:00Z',cutoffAt:'2026-12-01T06:00:00Z',status:'active',rules};
const data={overview:{current,history:{seasons:[{cycleId:'old-season',label:'Old season'}],hasMore:false}},selected:'current-season',result:null};
const render=(payload,lang='en')=>renderToStaticMarkup(React.createElement(MemoryRouter,null,React.createElement(TournamentPresentation,{data:payload,lang,choose:()=>{}})));

test('active and pending-closing views do not show fabricated standings, wallet plumbing or prizes',()=>{
  const active=render(data);assert.match(active,/In progress/);assert.match(active,/Final scores will appear/);assert.doesNotMatch(active,/Top 20|Final standings|0x[a-f0-9]{40}|ETH|router|wallet|\$3,500/);
  const waiting=render({...data,overview:{...data.overview,current:{...current,status:'awaiting_close'}}});
  assert.match(waiting,/Results are awaiting review/);assert.doesNotMatch(waiting,/View markets|Top 20/);
  assert.match(render({...data,overview:{...data.overview,current:{...current,status:'scheduled'}}}),/Starts/);
});
test('archive view shows linked final standings and personal breakdown with rewards pending in both languages',()=>{
  const row={username:'alice',rank:27,score:50,marketPnl:100,convictionBonus:50,inactivityPenalty:100,qualifyingMarkets:10,qualified:true};
  const result={status:'closed',label:'Old season',cycleId:'old-season',cutoffAt:current.cutoffAt,totalParticipants:27,rules,top:[{...row,username:'winner',rank:1}],me:row};
  const payload={...data,selected:'old-season',result};
  const html=render(payload);assert.match(html,/Old season/);assert.match(html,/Final standings/);assert.match(html,/href="\/u\/winner"/);
  assert.match(html,/#27/);assert.match(html,/Market PnL/);assert.match(html,/Conviction bonus/);assert.match(html,/Inactivity penalty/);assert.match(html,/Rewards pending approval/);
  const es=render(payload,'es');assert.match(es,/Clasificación final/);assert.match(es,/Premios pendientes de aprobación/);
  const guest=render({...payload,result:{...result,me:null}});assert.match(guest,/Sign in with a participating account/);assert.doesNotMatch(guest,/@alice/);
});
test('ongoing rows are provisional, timestamped, and visibly delayed when stale in both languages',()=>{
  const row={username:'alice',rank:27,score:50,marketPnl:100,convictionBonus:50,inactivityPenalty:100,qualifyingMarkets:1,qualified:false};
  const result={...current,status:'provisional',frozen:false,readyForRewards:false,totalParticipants:27,top:[row],me:row,
    asOf:'2026-11-10T06:00:00Z',freshness:'stale'};
  const payload={...data,result},html=render(payload);
  assert.match(html,/Provisional standings/);assert.match(html,/Your provisional score/);assert.match(html,/Updated through/);
  assert.match(html,/Update delayed/);assert.match(html,/Scores can change/);assert.doesNotMatch(html,/Final standings|Frozen at|Your final score/);
  const es=render(payload,'es');assert.match(es,/Clasificación provisional/);assert.match(es,/Actualización demorada/);
  assert.doesNotMatch(render({...payload,result:{...result,freshness:'fresh'}}),/Update delayed/);
  const pending=render({...data,result:{...result,status:'pending',top:[],me:null,totalParticipants:null}});
  assert.match(pending,/first reviewed update/);assert.doesNotMatch(pending,/Top 20|Participants: 0/);
});

test('personal eligibility is separate from frozen rank and payment approval in both languages',()=>{
  const row={username:'alice',rank:27,score:50,marketPnl:100,convictionBonus:50,inactivityPenalty:100,qualifyingMarkets:10,qualified:true};
  const result={status:'closed',label:'Old season',cycleId:'old-season',cutoffAt:current.cutoffAt,totalParticipants:27,rules,top:[row],me:row,
    rewardEligibility:{status:'eligible',eligibilityRank:1,readyForRewards:false}};
  const payload={...data,selected:'old-season',result};
  assert.match(render(payload),/Eligible for reward consideration/);assert.match(render(payload),/No prize or payment is confirmed/);
  assert.match(render(payload,'es'),/Elegible para consideración/);assert.match(render(payload,'es'),/No confirma un premio/);
  assert.match(render({...payload,result:{...result,rewardEligibility:{status:'on_hold'}}}),/Eligibility under review/);
  assert.doesNotMatch(render({...payload,result:{...result,me:null}}),/Eligible for reward consideration/);
});
