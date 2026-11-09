import { applyCors } from '../_lib/cors.js';

export default async function handler(req,res) {
  const cors = applyCors(req,res,{methods:'POST, OPTIONS',credentials:true});
  if (cors) return cors;
  res.setHeader('Cache-Control','private, no-store');
  if (req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  // Older tabs posted here from a background balance refresh.
  return res.status(410).json({error:'tournament_join_trade_required'});
}
