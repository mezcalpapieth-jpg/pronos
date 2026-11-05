import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { rateLimit, clientIp } from '../../_lib/rate-limit.js';
import { settlementSettings, loadSettlementMarket } from '../../_lib/onchain-admin-settlement.js';
import { refundInput, previewCancelRefunds, executeCancelRefunds, REFUND_BATCH_SIZE } from '../../_lib/onchain-cancel-refunds.js';
import { tradeRequestKey } from '../../_lib/trade-requests.js';
import { signDelegatedTransaction } from '../../_lib/turnkey-delegation.js';

export const config={maxDuration:90};
export function createRefundHandler({env=process.env,sqlFor=neon,adminFor=requirePointsAdmin,
  providerFor=()=>new ethers.providers.JsonRpcProvider({url:env.ONCHAIN_RPC_URL,timeout:10000}),
  preview=previewCancelRefunds,execute=executeCancelRefunds,sign=signDelegatedTransaction}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    const cors=applyCors(req,res,{methods:'GET, POST, OPTIONS',credentials:true});if(cors)return cors;
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'method_not_allowed'});
    const admin=adminFor(req,res);if(!admin)return;
    if(!settlementSettings(env).configured)return res.status(403).json({error:'onchain_settlement_unavailable'});
    if(rateLimit(req,res,{key:`onchain-refunds:${admin.username}:${clientIp(req)}`,limit:20,windowMs:60000}))return;
    try {
      if(req.method==='GET') {
        const q=req.query||{},id=Number(q.marketId),cursor=q.cursor||'';
        if(Object.keys(q).some(k=>!['marketId','cursor'].includes(k)) || !/^[1-9]\d*$/.test(q.marketId||'')
          || !Number.isSafeInteger(id) || (cursor && !/^0x[\da-f]{40}$/.test(cursor)))throw Object.assign(Error('invalid_refund_input'),{status:400});
        const sql=sqlFor(env.DATABASE_URL),market=await loadSettlementMarket(sql,id,env);
        if(market.status!=='canceled')throw Object.assign(Error('settlement_market_not_canceled'),{status:409});
        const rows=await sql`SELECT DISTINCT LOWER(trader) AS holder FROM trades WHERE market_id=${market.protocol_id}
          AND LOWER(trader)>${cursor} ORDER BY holder LIMIT ${REFUND_BATCH_SIZE+1}`;
        const holders=rows.slice(0,REFUND_BATCH_SIZE).map(r=>r.holder);
        return res.status(200).json({marketId:id,holders,nextCursor:rows.length>REFUND_BATCH_SIZE?holders.at(-1):null,
          discovery:'indexed_traders_only',note:'Additional holders can be reviewed by address. Payout requires native cost basis.'});
      }
      if(Object.keys(req.query||{}).length)throw Object.assign(Error('invalid_refund_input'),{status:400});
      const input=refundInput(req.body),key=req.body.operation==='execute'?tradeRequestKey(req):null;
      const args={sql:sqlFor(env.DATABASE_URL),provider:providerFor(),env,input};
      if(!key)return res.status(200).json(await preview(args));
      const result=await execute({...args,key,actor:admin.username,sign});
      return res.status(result.httpStatus).json(result.body);
    }catch(error){
      const safe=/^(?:invalid_refund_[a-z_]+|settlement_[a-z_]+|onchain_settlement_unavailable|idempotency_[a-z_]+|trade_[a-z_]+|market_not_found|ambiguous_settlement_market)$/.test(error.message||'');
      return res.status(safe&&error.status?error.status:503).json({error:safe?error.message:'onchain_refunds_unavailable'});
    }
  };
}
export default createRefundHandler();
