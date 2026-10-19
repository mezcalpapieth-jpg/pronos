const cycleIdValid=id=>typeof id==='string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);

// No request can fall back to Points standings or submit a wallet operation.
export async function loadTournamentPresentation(get,cycleId='') {
  if (cycleId && !cycleIdValid(cycleId)) throw Error('invalid_cycle_id');
  const overview=await get('/api/points/tournament-results?action=overview');
  const selected=cycleId || overview.current.cycleId;
  const shouldRead=Boolean(cycleId) || overview.current.frozen;
  const ongoing=!shouldRead && ['active','awaiting_close'].includes(overview.current.status);
  const result=shouldRead?await get(`/api/points/tournament-results?cycleId=${encodeURIComponent(selected)}`)
    :ongoing?await get('/api/points/tournament-results?action=standings'):null;
  const frozen=result?.status==='closed' && result.frozen===true;
  const provisional=ongoing && ['provisional','pending'].includes(result?.status) && result.frozen===false;
  if (result && ((!frozen && !provisional) || result.cycleId!==selected || result.readyForRewards!==false
    || (result.status==='provisional' && (!Number.isFinite(Date.parse(result.asOf)) || !['fresh','stale'].includes(result.freshness))))) {
    throw Error('invalid_tournament_result');
  }
  return {overview,result,selected};
}
