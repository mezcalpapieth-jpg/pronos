import {neon} from '@neondatabase/serverless';
import {ethers} from 'ethers';
import {applyCors} from '../../_lib/cors.js';
import {requirePointsAdmin} from '../../_lib/points-admin.js';
import {rateLimit,clientIp} from '../../_lib/rate-limit.js';
import {resolverSettings,previewSepoliaResolutions,reviewSepoliaResolution} from '../../_lib/sepolia-resolver.js';
export const config={maxDuration:90};
export function createResolutionPreviewHandler({env=process.env,adminFor=requirePointsAdmin,sqlFor=neon,inspect=previewSepoliaResolutions,
  review=reviewSepoliaResolution,
  providerFor=()=>new ethers.providers.JsonRpcProvider({url:env.ONCHAIN_RPC_URL,timeout:10000})}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const cors=applyCors(req,res,{methods:'GET, OPTIONS',credentials:true});if(cors)return cors;
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    const admin=adminFor(req,res);if(!admin)return;
    if(!resolverSettings(env).configured)return res.status(403).json({error:'resolver_isolation_failed'});
    const query=req.query||{}, target=Object.hasOwn(query,'marketId');
    if(Object.keys(query).some(key=>key!=='marketId')||Object.keys(req.body||{}).length)return res.status(400).json({error:'overrides_forbidden'});
    const marketId=target?Number(query.marketId):null;
    if(target&&(typeof query.marketId!=='string'||!/^[1-9]\d{0,9}$/.test(query.marketId)||marketId>2147483647)) {
      return res.status(400).json({error:'invalid_market_id'});
    }
    if(rateLimit(req,res,{key:`resolution-preview:${target?'market':'batch'}:${admin.username}:${clientIp(req)}`,limit:target?12:2,windowMs:60000}))return;
    try {
      const context={sql:sqlFor(env.DATABASE_URL),provider:providerFor(),env};
      return res.status(200).json(target?await review({...context,marketId}):await inspect(context));
    }catch(error) {
      if([404,409].includes(error.status))return res.status(error.status).json({error:'resolution_market_unavailable'});
      return res.status(503).json({error:'resolution_preview_unavailable'});
    }
  };
}
export default createResolutionPreviewHandler();
