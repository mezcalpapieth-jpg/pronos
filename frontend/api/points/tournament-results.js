import { applyCors } from '../_lib/cors.js';
import { readSession } from '../_lib/session.js';
import { publicSeasonResult, readRuntimeSeason, seasonSettings } from '../_lib/sepolia-tournament-season.js';

// Read-only and disabled in production/Pointbreak and the current preview.
export function createTournamentResultsHandler({env=process.env,readSeason=readRuntimeSeason,sessionFor=readSession}={}) {
  return async function handler(req,res) {
    const cors=applyCors(req,res,{methods:'GET, OPTIONS',credentials:true});
    if (cors) return cors;
    if (req.method!=='GET') return res.status(405).json({error:'method_not_allowed'});
    res.setHeader('Cache-Control','private, no-store');
    if (!seasonSettings(env).enabled) return res.status(404).json({error:'tournament_results_disabled'});
    try {
      const season=await readSeason({env});
      if (!season.closure) return res.status(409).json({error:'tournament_results_not_frozen'});
      return res.status(200).json(publicSeasonResult(season.closure,sessionFor(req,res)?.username));
    } catch {return res.status(503).json({error:'tournament_results_unavailable'});}
  };
}
export default createTournamentResultsHandler();
