import { timingSafeEqual } from 'node:crypto';

export function validateResolverWorker(env,source) {
  const target = new URL(source.target);
  if (env.VERCEL_ENV !== 'production' || !env.PREVIEW_RESOLVER_PROJECT_ID || env.VERCEL_PROJECT_ID !== env.PREVIEW_RESOLVER_PROJECT_ID
    || ['prj_Cq2kBrGtvtU7nVOH3T6yBGJWGRKi','prj_2bv4NAl9EBvRdkOVw1RpAIzbDJNA'].includes(env.VERCEL_PROJECT_ID)
    || source.branch !== 'onchain-sepolia' || source.mode !== 'active' || !/^[a-f0-9]{40}$/.test(source.sha || '')
    || target.protocol !== 'https:' || !/^pronos-[a-z0-9]+-mezcalpapieth-jpgs-projects\.vercel\.app$/.test(target.hostname)
    || target.pathname !== '/api/cron/sepolia-resolve' || target.search || target.hash || target.username || target.password || target.port
    || typeof env.RESOLVER_TRIGGER_SECRET !== 'string' || env.RESOLVER_TRIGGER_SECRET.length<32
    || typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length<32 || env.CRON_SECRET===env.RESOLVER_TRIGGER_SECRET
    || Object.keys(env).some(k=>/DATABASE|TURNKEY|PRIVATE_KEY|RPC_URL/.test(k))) throw Error('resolver_worker_isolation_failed');
}
export function createResolverWorker({env,sourceFor,fetcher=fetch}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    const actual=Buffer.from(req.headers?.authorization||''),expected=Buffer.from(`Bearer ${env.CRON_SECRET||''}`);
    if(!env.CRON_SECRET || env.CRON_SECRET.length<32 || actual.length!==expected.length || !timingSafeEqual(actual,expected))return res.status(401).json({error:'unauthorized'});
    if(Object.keys(req.query||{}).length)return res.status(400).json({error:'overrides_forbidden'});
    if(env.ONCHAIN_RESOLVER_WORKER_ENABLED!=='true')return res.status(200).json({status:'disabled'});
    try {
      const source=await sourceFor(); validateResolverWorker(env,source);
      const headers={'Content-Type':'application/json',authorization:`Bearer ${env.RESOLVER_TRIGGER_SECRET}`,
        'x-pronos-resolver-source':source.sha};
      if(env.PREVIEW_PROTECTION_BYPASS_SECRET)headers['x-vercel-protection-bypass']=env.PREVIEW_PROTECTION_BYPASS_SECRET;
      const response=await fetcher(source.target,{method:'POST',headers,body:'{}',redirect:'error',signal:AbortSignal.timeout(240000)});
      if(!response.ok || !response.headers.get('content-type')?.includes('application/json'))throw Error('resolver_target_failed');
      const result=await response.json();
      if(!['ok','skipped','disabled'].includes(result.status))throw Error('resolver_target_failed');
      return res.status(200).json(result);
    } catch { return res.status(503).json({error:'resolver_schedule_failed'}); }
  };
}
