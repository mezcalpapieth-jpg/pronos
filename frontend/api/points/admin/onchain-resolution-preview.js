import {neon} from '@neondatabase/serverless';
import {ethers} from 'ethers';
import {applyCors} from '../../_lib/cors.js';
import {requirePointsAdmin} from '../../_lib/points-admin.js';
import {rateLimit,clientIp} from '../../_lib/rate-limit.js';
import {resolverSettings,previewSepoliaResolutions} from '../../_lib/sepolia-resolver.js';
export const config={maxDuration:90};
export function createResolutionPreviewHandler({env=process.env,adminFor=requirePointsAdmin,sqlFor=neon,inspect=previewSepoliaResolutions,
  providerFor=()=>new ethers.providers.JsonRpcProvider({url:env.ONCHAIN_RPC_URL,timeout:10000})}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const cors=applyCors(req,res,{methods:'GET, OPTIONS',credentials:true});if(cors)return cors;
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    const admin=adminFor(req,res);if(!admin)return;
    if(!resolverSettings(env).configured)return res.status(403).json({error:'resolver_isolation_failed'});
    if(Object.keys(req.query||{}).length||Object.keys(req.body||{}).length)return res.status(400).json({error:'overrides_forbidden'});
    if(rateLimit(req,res,{key:`resolution-preview:${admin.username}:${clientIp(req)}`,limit:2,windowMs:60000}))return;
    try{return res.status(200).json(await inspect({sql:sqlFor(env.DATABASE_URL),provider:providerFor(),env}));}
    catch{return res.status(503).json({error:'resolution_preview_unavailable'});}
  };
}
export default createResolutionPreviewHandler();
