import { randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, open, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { address, planHash, TOURNAMENT_CHAIN_ID } from './sepolia-tournament.js';
import { tournamentRegistrations } from './sepolia-tournament-scoring.js';
import { buildTournamentSnapshot, tournamentMarketRegistry, TOURNAMENT_CAPTURE_LIMITS } from './sepolia-tournament-snapshot.js';

const fail = code => { throw new Error(code); };
const hash = value => {
  if (!/^0x[0-9a-f]{64}$/i.test(value || '')) fail('capture_hash_required');
  return value.toLowerCase();
};
const integer = value => {
  if (!Number.isSafeInteger(value) || value < 0) fail('capture_integer_required');
  return value;
};
const json = value => JSON.parse(JSON.stringify(value));
const PAGE = 2000, GROUP = 25, LOG_CAP = 1000;

async function privateDirectory(path) {
  await mkdir(path,{ recursive:true, mode:0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) fail('private_checkpoint_directory_required');
}
async function readPrivate(path) {
  let info;
  try { info=await lstat(path); } catch (e) { if(e.code==='ENOENT') return null; throw e; }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) || info.size > 64*1024*1024) fail('invalid_checkpoint_file');
  return JSON.parse(await readFile(path,'utf8'));
}
// Fsync a private temporary file, then publish without replacing an existing
// entry. A crash can leave an ignored temp file, never a half-written entry.
async function createJson(path, value) {
  const tmp=path+'.tmp-'+randomUUID();
  let file;
  try {
    file=await open(tmp,'wx',0o600);
    await file.writeFile(JSON.stringify(value)+'\n');await file.sync();await file.close();file=null;
    await link(tmp,path);
  } finally { if(file) await file.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
}
const sizeLimit = error => !/rate|429|timeout|network|unauthorized|forbidden/i.test(String(error.message))
  && (error.code===-32005 || /too many|query returned more|response size|block range|result.*limit/i.test(String(error.message)));

// All saved responses belong to one reviewed request and one immutable cutoff
// hash. A resume revalidates that hash against the live RPC before cache use.
// Private cache integrity detects corruption, not a malicious local operator.
export async function captureTournamentSnapshot(input, { provider, readIndexerCoverage,
  checkpointDirectory, maxRequests=500 }={}) {
  if (!checkpointDirectory || !Number.isSafeInteger(maxRequests) || maxRequests<1 || maxRequests>5000) fail('invalid_capture_options');
  const {plan,digest}=tournamentRegistrations(input);
  const registry=tournamentMarketRegistry(input.registry);
  if (planHash(registry)!==input.reviewedRegistryHash || registry.planHash!==digest
    || registry.cycleId!==plan.cycleId) fail('reviewed_market_registry_required');
  integer(input.fromBlock);integer(input.asOfBlock);
  if (input.fromBlock<1 || input.asOfBlock<input.fromBlock
    || input.asOfBlock-input.fromBlock>TOURNAMENT_CAPTURE_LIMITS.maxBlocks
    || registry.markets.length>TOURNAMENT_CAPTURE_LIMITS.maxMarkets) fail('snapshot_bounds_exceeded');
  if (!Array.isArray(input.funding)) fail('complete_funding_receipts_required');
  const identity={version:2,transferReconciliationVersion:1,cycleId:plan.cycleId,planHash:digest,registryHash:input.reviewedRegistryHash,
    lateJoins:input.lateJoins || [], ...(input.final ? {final:true} : {}),
    fromBlock:input.fromBlock,asOfBlock:input.asOfBlock,
    funding:input.funding.map(r=>({batchIndex:integer(r.batchIndex),txHash:hash(r.txHash)})).sort((a,b)=>a.batchIndex-b.batchIndex),
    limits:TOURNAMENT_CAPTURE_LIMITS,addressBatchSize:GROUP,pageBlocks:PAGE,logSplitThreshold:LOG_CAP,logPageFormat:1};
  await privateDirectory(checkpointDirectory);
  const lock=join(checkpointDirectory,'capture.lock');
  let lease;
  try { lease=await open(lock,'wx',0o600); } catch(e) { if(e.code==='EEXIST')fail('capture_locked');throw e; }
  const token=randomUUID();
  let lockWritten=false;
  try {
    try {await lease.writeFile(JSON.stringify({pid:process.pid,token})+'\n');lockWritten=true;}
    finally {await lease.close();}
    const manifestPath=join(checkpointDirectory,'manifest.json');
    let manifest=await readPrivate(manifestPath);
    if (manifest) {
      const {manifestHash,...body}=manifest;
      if (manifestHash!==planHash(body) || planHash(manifest.identity)!==planHash(identity)) fail('capture_context_mismatch');
    }
    const network=await provider.getNetwork(), tip=integer(await provider.getBlockNumber());
    if (network.chainId!==TOURNAMENT_CHAIN_ID) fail('rpc_chain_mismatch');
    const pinned=await provider.getBlock(input.asOfBlock);
    if (!pinned || pinned.number!==input.asOfBlock || tip-input.asOfBlock<1) fail('snapshot_needs_two_confirmations');
    const anchor={blockNumber:input.asOfBlock,blockHash:hash(pinned.hash)};
    if (input.expectedCutoffHash && anchor.blockHash!==hash(input.expectedCutoffHash)) fail('capture_anchor_reorg');
    if (manifest && (manifest.anchor.blockNumber!==anchor.blockNumber || manifest.anchor.blockHash!==anchor.blockHash)) fail('capture_anchor_reorg');
    if (!manifest) {
      const body={identity,anchor};manifest={...body,manifestHash:planHash(body)};
      await createJson(manifestPath,manifest);
    }
    const entries=join(checkpointDirectory,'entries');await privateDirectory(entries);
    const stats={newReads:0,cacheHits:0}, pause=new Error('capture_paused');
    async function live(read) {
      if(stats.newReads>=maxRequests)throw pause;
      stats.newReads++;return read();
    }
    async function cached(method,args,read) {
      const key={method,args}, keyHash=planHash(key), shard=join(entries,keyHash.slice(0,2));
      await privateDirectory(shard);
      const path=join(shard,keyHash+'.json'), saved=await readPrivate(path);
      if(saved) {
        const {responseHash,...body}=saved;
        if (body.manifestHash!==manifest.manifestHash || planHash(body.key)!==keyHash
          || responseHash!==planHash(body)) fail('capture_cache_corrupt');
        stats.cacheHits++;return body.result;
      }
      const result=await read();
      if(result==null)fail('capture_rpc_missing_result');
      const body={manifestHash:manifest.manifestHash,key,result:json(result)};
      await createJson(path,{...body,responseHash:planHash(body)});return body.result;
    }
    const groups=new Map();
    for(const factory of [plan.deployment.factoryV1,plan.deployment.factoryV2]) {
      const pools=registry.markets.filter(m=>m.factory===factory).map(m=>m.pool).sort();
      for(let i=0;i<pools.length;i+=GROUP) for(const pool of pools.slice(i,i+GROUP)) groups.set(pool,pools.slice(i,i+GROUP));
    }
    for (const token of [plan.deployment.token,plan.deployment.shareV1,plan.deployment.shareV2]) groups.set(token,[token]);
    async function page(query) {
      // Persist split decisions as well as complete leaf responses. Otherwise
      // a small per-run quota could repeatedly spend its last read on the same
      // oversized parent query without ever reaching a child on resume.
      const response=await cached('getLogs',[query],async()=>{
        let rows;
        try { rows=await live(()=>provider.getLogs(query)); }
        catch(error) { if(error===pause || !sizeLimit(error))throw error;return {split:true}; }
        if(!Array.isArray(rows))fail('capture_invalid_logs');
        if(rows.some(l=>!query.address.includes(address(l.address))
          || integer(l.blockNumber)<query.fromBlock || l.blockNumber>query.toBlock
          || !query.topics[0].includes(hash(l.topics?.[0])))) fail('log_outside_requested_range');
        return rows.length>=LOG_CAP?{split:true}:{rows};
      });
      let rows;
      if(response.split===true) {
        if(query.fromBlock<query.toBlock) {
          const mid=Math.floor((query.fromBlock+query.toBlock)/2);
          rows=[...await page({...query,toBlock:mid}),...await page({...query,fromBlock:mid+1})];
        } else if(query.address.length>1) {
          const mid=Math.floor(query.address.length/2);
          rows=[...await page({...query,address:query.address.slice(0,mid)}),...await page({...query,address:query.address.slice(mid)})];
        } else fail('capture_single_block_log_limit');
      } else if(Array.isArray(response.rows)) rows=response.rows;
      else fail('capture_invalid_logs');
      if(rows.length>50_000)fail('capture_page_log_limit');
      return rows;
    }
    const allowed=new Set([...Object.values(plan.deployment).filter(v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)),...groups.keys()]);
    const target = to => { const a=address(to);if(!allowed.has(a))fail('capture_target_outside_plan');return a; };
    const cutoff = n => {if(n!==input.asOfBlock)fail('capture_historical_cutoff_required');return n;};
    // Deliberately expose no send(), signer or transaction-broadcast method.
    const captured={
      getNetwork:async()=>network,getBlockNumber:async()=>tip,
      getBlock:async n=>{
        integer(n);if(n>input.asOfBlock+(input.final?1:0))fail('capture_future_block');
        return cached('getBlock',[n],()=>live(()=>provider.getBlock(n)));
      },
      getCode:async(to,n)=>cached('getCode',[target(to),cutoff(n)],()=>live(()=>provider.getCode(to,n))),
      call:async(tx,n)=>{
        const request={to:target(tx.to),data:tx.data};
        if(!/^0x[0-9a-f]*$/i.test(tx.data || '') || Object.keys(tx).some(k=>!['to','data'].includes(k)))fail('capture_invalid_call');
        return cached('call',[request,cutoff(n)],()=>live(()=>provider.call(request,n)));
      },
      getTransaction:async h=>cached('getTransaction',[hash(h)],()=>live(()=>provider.getTransaction(h))),
      getTransactionReceipt:async h=>cached('getTransactionReceipt',[hash(h)],()=>live(()=>provider.getTransactionReceipt(h))),
      getLogs:async filter=>{
        const pool=address(filter.address),group=groups.get(pool);
        const from=integer(filter.fromBlock),to=integer(filter.toBlock);
        if(!group || from>to || to>input.asOfBlock || to-from>=PAGE)fail('capture_invalid_log_range');
        const topics=[filter.topics[0].map(hash).sort()],rows=[];
        for(let first=Math.floor(from/PAGE)*PAGE;first<=to;first+=PAGE) {
          rows.push(...await page({address:group,fromBlock:first,toBlock:Math.min(first+PAGE-1,input.asOfBlock),topics}));
        }
        return rows.filter(l=>address(l.address)===pool&&l.blockNumber>=from&&l.blockNumber<=to);
      },
    };
    let artifact,error;
    try { artifact=await buildTournamentSnapshot(input,{provider:captured,readIndexerCoverage,fullTournamentCapture:true}); }
    catch(e) {error=e;}
    // A stable canonical cutoff commits to its ancestors. Revalidate the live
    // chain and cutoff after every run, including pauses and failures. Cached
    // per-block reads are reused only under that same independently read hash.
    const finalNetwork=await provider.getNetwork(), finalBlock=await provider.getBlock(input.asOfBlock);
    if(finalNetwork.chainId!==TOURNAMENT_CHAIN_ID || hash(finalBlock?.hash)!==anchor.blockHash)fail('capture_anchor_reorg');
    if (artifact?.cutoffBoundary) {
      const next=await provider.getBlock(input.asOfBlock+1);
      if (hash(next?.hash)!==artifact.cutoffBoundary.nextBlock.blockHash) fail('capture_anchor_reorg');
    }
    const progress={mode:'shadow',readyForRewards:false,checkpointHash:manifest.manifestHash,anchor,...stats};
    if(error===pause)return {status:'paused',...progress};
    if(error)throw error;
    return {status:'complete',...progress,artifact};
  } finally {
    if(!lockWritten) {await unlink(lock);}
    else {
    const current=await readPrivate(lock);
    if(current?.token===token)await unlink(lock);
    }
  }
}
