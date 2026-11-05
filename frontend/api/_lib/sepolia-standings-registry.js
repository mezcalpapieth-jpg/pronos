import {ethers} from 'ethers';
import {validateTournamentPlan,planHash} from './sepolia-tournament.js';
import {tournamentMarketRegistry} from './sepolia-tournament-snapshot.js';
const events={v1:new ethers.utils.Interface(['event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)']),
  v2:new ethers.utils.Interface(['event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime,string resolutionSource,string[] outcomes)'])};
const rows=r=>Array.isArray(r)?r:r.rows;
// Discover all markets for the cycle-only factories. The result is a proposal,
// never an automatic amendment to the reviewed standings policy.
export async function discoverStandingsRegistry({sql,provider,cycleId,reviewedPlanHash,confirmations=12,
  contractAt=(a,abi)=>new ethers.Contract(a,abi,provider)}) {
  if(!/^[a-z0-9][a-z0-9-]{2,63}$/.test(cycleId||'')||!/^[a-f0-9]{64}$/.test(reviewedPlanHash||'')
    || !Number.isSafeInteger(confirmations)||confirmations<2||confirmations>100)throw Error('reviewed_registry_discovery_required');
  if(Number((await provider.getNetwork()).chainId)!==421614)throw Error('rpc_chain_mismatch');
  const [cycle]=rows(await sql`SELECT plan,plan_hash,status FROM sepolia_tournament_cycles WHERE cycle_id=${cycleId}`);
  if(!cycle||cycle.status!=='funded'||cycle.plan_hash!==reviewedPlanHash||planHash(cycle.plan)!==reviewedPlanHash)throw Error('reviewed_funded_cycle_required');
  const plan=validateTournamentPlan(cycle.plan),factories=[plan.deployment.factoryV1,plan.deployment.factoryV2];
  const tip=await provider.getBlockNumber(),blockNumber=tip-confirmations+1;
  if(!Number.isSafeInteger(blockNumber)||blockNumber<1)throw Error('confirmed_registry_anchor_required');
  const anchor=await provider.getBlock(blockNumber);
  if(!anchor?.hash)throw Error('confirmed_registry_anchor_required');
  const indexed=rows(await sql`SELECT factory_address,last_block FROM indexer_factory_state WHERE chain_id=421614 AND factory_address=ANY(${factories}::text[])`);
  if(factories.some(f=>!indexed.some(r=>r.factory_address===f&&Number(r.last_block)>=blockNumber)))throw Error('incomplete_indexer_coverage');
  const mappings=rows(await sql`SELECT m.factory_address,m.pool_address,m.market_id,m.tx_hash,m.protocol_version,p.id AS points_id
    FROM protocol_markets m JOIN points_markets p ON p.mode='onchain' AND p.chain_id=m.chain_id
      AND LOWER(p.chain_address)=LOWER(m.pool_address) AND p.chain_market_id::text=m.market_id::text
    WHERE m.chain_id=421614 AND LOWER(m.factory_address)=ANY(${factories}::text[]) ORDER BY m.factory_address,m.market_id LIMIT 1001`);
  if(mappings.length>1000)throw Error('registry_discovery_bounds_exceeded');
  const markets=[];
  for(let i=0;i<factories.length;i++) {
    const factory=factories[i],variant=i===0?'v1':'v2',iface=events[variant];
    const count=Number((await contractAt(factory,['function marketCount() view returns(uint256)']).marketCount({blockTag:blockNumber})).toString());
    if(!Number.isSafeInteger(count)||count<0||count>1000)throw Error('registry_discovery_bounds_exceeded');
    const found=mappings.filter(m=>m.factory_address.toLowerCase()===factory),ids=new Set();
    // Mappings from beyond the confirmed anchor are ignored only after proving
    // their creation receipt. A lagging index must not silently omit a market.
    for(const m of found) {
      if(m.protocol_version!==variant||!/^0x[\da-fA-F]{64}$/.test(m.tx_hash||''))throw Error('registry_mapping_requires_review');
      const receipt=await provider.getTransactionReceipt(m.tx_hash);
      if(!receipt||receipt.status!==1||receipt.transactionHash.toLowerCase()!==m.tx_hash.toLowerCase())throw Error('registry_creation_receipt_missing');
      if(receipt.blockNumber>blockNumber)continue;
      if((await provider.getBlock(receipt.blockNumber))?.hash?.toLowerCase()!==receipt.blockHash?.toLowerCase())throw Error('registry_creation_reorg');
      const matches=(receipt.logs||[]).filter(l=>{
        if(l.address.toLowerCase()!==factory||l.removed)return false;
        try{const e=iface.parseLog(l);return e.args.marketId.toString()===String(m.market_id)&&e.args.pool.toLowerCase()===m.pool_address.toLowerCase();}catch{return false;}
      });
      if(matches.length!==1||ids.has(String(m.market_id))||!Number.isSafeInteger(Number(m.points_id))||Number(m.points_id)<1)throw Error('registry_mapping_requires_review');
      ids.add(String(m.market_id));markets.push({factory,pool:m.pool_address,marketId:String(m.market_id),creationTxHash:m.tx_hash.toLowerCase(),creationLogIndex:matches[0].logIndex});
    }
    if(ids.size!==count||Array.from({length:count},(_,n)=>String(n)).some(id=>!ids.has(id)))throw Error('incomplete_registry_discovery');
  }
  if((await provider.getBlock(blockNumber))?.hash!==anchor.hash)throw Error('registry_creation_reorg');
  const registry=tournamentMarketRegistry({cycleId,planHash:reviewedPlanHash,markets});
  return {mode:'read_only',registry,registryHash:planHash(registry),anchor:{blockNumber,blockHash:anchor.hash},requiresPolicyReview:true,enabled:false};
}
