import { timingSafeEqual } from 'node:crypto';

export function validateStandingsWorker(env,source) {
  const db=new URL(env.DATABASE_URL),rpc=new URL(env.ARB_RPC_URL);
  if(env.VERCEL_ENV!=='production' || !env.PREVIEW_STANDINGS_PROJECT_ID
    || env.PREVIEW_STANDINGS_PROJECT_ID!==env.VERCEL_PROJECT_ID
    || env.VERCEL_PROJECT_ID==='prj_Cq2kBrGtvtU7nVOH3T6yBGJWGRKi'
    || source?.branch!=='onchain-sepolia' || !/^[a-f0-9]{40}$/.test(source.sha||'')
    || !['postgres:','postgresql:'].includes(db.protocol)
    || !/^ep-delicate-glitter-amp7yrkv(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(db.hostname)
    || decodeURIComponent(db.username)!=='sepolia_standings' || rpc.protocol!=='https:'
    || env.CHAIN_ID!=='421614' || !/^[a-f0-9]{64}$/.test(env.STANDINGS_POLICY_HASH||'')
    || typeof env.CRON_SECRET!=='string' || env.CRON_SECRET.length<32
    || Object.keys(env).some(k=>/PRIVATE_KEY|TURNKEY|CRON_SECRET_MAIN/.test(k)))throw Error('standings_worker_isolation_failed');
}
const authorized=(header,secret)=>{
  const a=Buffer.from(header||''),b=Buffer.from(`Bearer ${secret||''}`);
  return a.length===b.length && timingSafeEqual(a,b);
};
export function createStandingsWorker({env,source,sourceFor,tick}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
    if(!env.CRON_SECRET || !authorized(req.headers?.authorization,env.CRON_SECRET))return res.status(401).json({error:'unauthorized'});
    if(env.ONCHAIN_STANDINGS_ENABLED!=='true')return res.status(200).json({status:'disabled'});
    try {
      const reviewedSource=source||await sourceFor();
      validateStandingsWorker(env,reviewedSource);
      // Configuration is server-side, hash-reviewed and never supplied in query
      // parameters. The shared tick checks chain ID before touching SQL.
      return res.status(200).json(await tick({source:reviewedSource}));
    } catch {
      // Driver/RPC messages can contain credentials; store only a safe status.
      console.error('[sepolia-standings] publication_failed');
      return res.status(500).json({error:'standings_publication_failed'});
    }
  };
}
