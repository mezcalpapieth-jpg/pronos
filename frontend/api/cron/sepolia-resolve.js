import { timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { signDelegatedTransaction } from '../_lib/turnkey-delegation.js';
import { runSepoliaResolver, resolverSettings } from '../_lib/sepolia-resolver.js';

export const config = { maxDuration: 300 };
export function createResolverHandler({ env=process.env, sqlFor=neon,
  providerFor=()=>new ethers.providers.JsonRpcProvider({url:env.ONCHAIN_RPC_URL,timeout:10000}),run=runSepoliaResolver,sign=signDelegatedTransaction }={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
    const secret=env.ONCHAIN_RESOLVER_CRON_SECRET,actual=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(`Bearer ${secret||''}`);
    if(!secret || secret.length<32 || actual.length!==expected.length || !timingSafeEqual(actual,expected))return res.status(401).json({error:'unauthorized'});
    if(Object.keys(req.query||{}).length || Object.keys(req.body||{}).length)return res.status(400).json({error:'overrides_forbidden'});
    const settings=resolverSettings(env);
    if(!settings.enabled)return res.status(200).json({status:'disabled'});
    if(!settings.configured)return res.status(503).json({error:'resolver_isolation_failed'});
    if(req.headers?.['x-pronos-resolver-source']!==env.VERCEL_GIT_COMMIT_SHA)return res.status(409).json({error:'resolver_source_mismatch'});
    try{return res.status(200).json(await run({sql:sqlFor(env.DATABASE_URL),provider:providerFor(),env,sign}));}
    catch{return res.status(503).json({error:'resolver_failed'});}
  };
}
export default createResolverHandler();
