import { applyCors } from '../_lib/cors.js';
import { readSession } from '../_lib/session.js';
import { publicSeasonResult, readRuntimeSeason, seasonSettings } from '../_lib/sepolia-tournament-season.js';
import { publicSeasonSummary,readArchivedSeason,readSeasonHistory,seasonIdValid,
  readProvisionalStandings,publicProvisionalStandings,readRewardEligibility } from '../_lib/sepolia-tournament-presentation.js';

// Read-only and disabled in production/Pointbreak and the current preview.
export function createTournamentResultsHandler({env=process.env,readSeason=readRuntimeSeason,sessionFor=readSession,
  readArchive=readArchivedSeason,readHistory=readSeasonHistory,readStandings=readProvisionalStandings,
  readEligibility=readRewardEligibility,now=()=>new Date()}={}) {
  return async function handler(req,res) {
    const cors=applyCors(req,res,{methods:'GET, OPTIONS',credentials:true});
    if (cors) return cors;
    if (req.method!=='GET') return res.status(405).json({error:'method_not_allowed'});
    res.setHeader('Cache-Control','private, no-store');
    if (!seasonSettings(env).enabled) return res.status(404).json({error:'tournament_results_disabled'});
    const {cycleId,action}=req.query||{};
    if ((cycleId!==undefined && !seasonIdValid(cycleId)) || (action!==undefined && !['overview','standings'].includes(action))
      || (cycleId!==undefined && action!==undefined)) return res.status(400).json({error:'invalid_tournament_query'});
    try {
      const finalPayload=async result=>{
        const username=sessionFor(req,res)?.username,payload=publicSeasonResult(result,username);
        if(env.ONCHAIN_TOURNAMENT_REWARDS_ENABLED==='true')payload.rewardEligibility=await readEligibility({env,result,username});
        return payload;
      };
      if (cycleId!==undefined) {
        const result=await readArchive({env,cycleId});
        if (!result) return res.status(404).json({error:'tournament_results_not_found'});
        return res.status(200).json(await finalPayload(result));
      }
      const season=await readSeason({env});
      if (action==='overview') return res.status(200).json({current:publicSeasonSummary(season,now()),
        history:await readHistory({env})});
      if (action==='standings') {
        if (season.closure) return res.status(200).json(await finalPayload(season.closure));
        const result=publicSeasonSummary(season,now()).status==='scheduled'?null:await readStandings({env,season});
        return res.status(200).json(publicProvisionalStandings(result,season,sessionFor(req,res)?.username,now()));
      }
      if (!season.closure) return res.status(409).json({error:'tournament_results_not_frozen'});
      return res.status(200).json(await finalPayload(season.closure));
    } catch {return res.status(503).json({error:'tournament_results_unavailable'});}
  };
}
export default createTournamentResultsHandler();
