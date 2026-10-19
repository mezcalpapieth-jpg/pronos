import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTournamentPresentation } from './tournamentResults.js';

test('scheduled seasons show status without reading or inventing final standings',async()=>{
  const calls=[],overview={current:{cycleId:'current-season',frozen:false},history:{seasons:[]}};
  const data=await loadTournamentPresentation(async path=>{calls.push(path);return overview;});
  assert.equal(data.result,null);assert.equal(data.selected,'current-season');assert.deepEqual(calls,['/api/points/tournament-results?action=overview']);
});
test('ongoing standings are loaded from their isolated route with pending, stale and final-race states',async()=>{
  for(const status of ['pending','provisional','closed']) {
    const calls=[],overview={current:{cycleId:'current-season',status:'active',frozen:false},history:{seasons:[]}};
    const result={cycleId:'current-season',status,frozen:status==='closed',readyForRewards:false,
      asOf:'2026-11-10T06:00:00Z',freshness:'stale'};
    const data=await loadTournamentPresentation(async path=>{calls.push(path);return path.endsWith('overview')?overview:result;});
    assert.equal(data.result.status,status);assert.equal(calls[1],'/api/points/tournament-results?action=standings');
  }
});
test('malformed provisional results never display rows for another cycle or claim freshness without a time',async()=>{
  const overview={current:{cycleId:'current-season',status:'active',frozen:false},history:{seasons:[]}};
  const result={cycleId:'current-season',status:'provisional',frozen:false,readyForRewards:false,
    asOf:'2026-11-10T06:00:00Z',freshness:'fresh'};
  for(const change of [{cycleId:'other-season'},{frozen:true},{readyForRewards:true},{asOf:null},{freshness:'unknown'}]) {
    await assert.rejects(loadTournamentPresentation(async path=>path.endsWith('overview')?overview:{...result,...change}),/invalid_tournament_result/);
  }
});
test('frozen current and selected archives use isolated read-only results routes',async()=>{
  for(const selected of ['', 'old-season']){
    const calls=[],id=selected||'current-season';
    const data=await loadTournamentPresentation(async path=>{
      calls.push(path);
      return path.endsWith('overview')?{current:{cycleId:'current-season',frozen:true},history:{seasons:[]}}
        :{status:'closed',frozen:true,cycleId:id,readyForRewards:false,me:{username:'alice'}};
    },selected);
    assert.equal(data.result.cycleId,id);assert.equal(data.result.me.username,'alice');
    assert.equal(calls[1],`/api/points/tournament-results?cycleId=${id}`);
    assert.ok(calls.every(path=>path.startsWith('/api/points/tournament-results?')));
  }
});
test('invalid or failed results never fall back to Points or a different season',async()=>{
  await assert.rejects(loadTournamentPresentation(()=>assert.fail('no request'),'bad/'),/invalid_cycle_id/);
  const overview={current:{cycleId:'current-season',frozen:true},history:{seasons:[]}};
  for(const result of [{status:'closed',frozen:true,readyForRewards:false,cycleId:'another-season'},
    {status:'active',frozen:false,readyForRewards:false,cycleId:'current-season'},
    {status:'closed',frozen:true,readyForRewards:true,cycleId:'current-season'}]){
    await assert.rejects(loadTournamentPresentation(async path=>path.endsWith('overview')?overview:result),/invalid_tournament_result/);
  }
  let n=0;await assert.rejects(loadTournamentPresentation(async()=>{n++;throw Error('unavailable');}),/unavailable/);assert.equal(n,1);
});
