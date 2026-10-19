import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit } from '../_lib/rate-limit.js';
import { prepareTournamentJoin } from '../_lib/sepolia-tournament-user-join.js';

export default async function handler(req,res) {
  const cors = applyCors(req,res,{methods:'POST, OPTIONS',credentials:true});
  if (cors) return cors;
  res.setHeader('Cache-Control','private, no-store');
  if (req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const session = requireSession(req,res);
  if (!session) return;
  if (rateLimit(req,res,{key:`tournament-join:${session.sub}`,windowMs:60000,limit:10})) return;
  try {
    const result = await prepareTournamentJoin(session.sub);
    if (result.status==='disabled') return res.status(403).json({error:'late_joining_disabled'});
    return res.status(result.status==='pending'?202:200).json(result);
  } catch { return res.status(503).json({error:'tournament_join_unavailable'}); }
}
