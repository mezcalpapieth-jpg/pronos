import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buildTournamentPlan, planHash, MINT_ABI } from './sepolia-tournament.js';
import { tournamentMarketRegistry } from './sepolia-tournament-snapshot.js';

export const addr = n => `0x${n.toString(16).padStart(40,'0')}`;
export const hash = n => `0x${n.toString(16).padStart(64,'0')}`;
export const base = Date.parse('2026-11-01T00:00:00Z') / 1000;
const routerCode = '0x6001';
export function fixture({ resolved=false, asOfBlock=200 }={}) {
  const deployment = (n=0) => ({ chainId:421614, token:addr(n+1), factoryV1:addr(n+2),
    factoryV2:addr(n+3), shareV1:addr(n+4), shareV2:addr(n+5), router:addr(n+6),
    owner:addr(90), operations:addr(91), routerCodeHash:ethers.utils.keccak256(routerCode) });
  const plan = buildTournamentPlan({ deployment:deployment(), previousDeployment:deployment(100),
    users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'}],
    cycleId:'cycle-two',label:'Second cycle', startsAt:'2026-11-01T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',
    liquidityMxnp:'1000',maxTotalMxnp:'1500' });
  const contracts = new Map(), receipts = new Map(), transactions = new Map(), logs = [];
  function contract(at, signatures, state) {
    contracts.set(at,{abi:new ethers.utils.Interface(signatures.map(s=>`function ${s}`)),state});
  }
  contract(addr(1),['totalSupply() view returns(uint256)','decimals() view returns(uint8)'],{totalSupply:plan.totalUnits,decimals:6});
  contract(addr(6),['factoryV1','factoryV2','collateral','tokenV1','tokenV2'].map(s=>`${s}() view returns(address)`),
    {factoryV1:addr(2),factoryV2:addr(3),collateral:addr(1),tokenV1:addr(4),tokenV2:addr(5)});
  const block = n => ({ number:n,hash:hash(n),timestamp:base+n-100 });
  function addReceipt(txHash,n,rows) {
    const enriched = rows.map(row=>({...row,blockNumber:n,blockHash:hash(n),transactionHash:txHash,removed:false}));
    receipts.set(txHash,{status:1,transactionHash:txHash,blockNumber:n,blockHash:hash(n),logs:enriched});
    logs.push(...enriched);return enriched;
  }
  function encoded(abi,name,args,at,logIndex=0) {
    return {address:at,...abi.encodeEventLog(abi.getEvent(name),args),logIndex};
  }
  const mint = new ethers.utils.Interface(MINT_ABI), batch=plan.batches[0];
  addReceipt(hash(500),90,batch.recipients.map((r,i)=>encoded(mint,'Transfer',[ethers.constants.AddressZero,r.wallet,r.units],addr(1),i)));
  transactions.set(hash(500),{hash:hash(500),blockHash:hash(90),blockNumber:90,chainId:421614,
    from:addr(90),to:addr(1),value:0,data:mint.encodeFunctionData('batchMint',[batch.recipients.map(r=>r.wallet),batch.recipients.map(r=>r.units)])});
  const registryRows = [], eventAbis = {};
  for (const v of [1,2]) {
    const pool=addr(39+v),factory=addr(1+v),shares=addr(3+v);
    contract(factory,['marketCount() view returns(uint256)','collateral() view returns(address)',
      'token() view returns(address)','tradingRouter() view returns(address)',
      `markets(uint256) view returns(address pool,string question,string category,uint256 endTime,string resolutionSource,${v===2?'uint8 outcomeCount,':''}bool active)`],
    {marketCount:1,collateral:addr(1),token:shares,tradingRouter:addr(6),markets:[pool,'Question','test',base+1000,'source',...(v===2?[3]:[]),true]});
    contract(shares,['owner() view returns(address)'],{owner:factory});
    contract(pool,['factory() view returns(address)','collateral() view returns(address)','token() view returns(address)',
      'marketId() view returns(uint256)','outcomeCount() view returns(uint8)',
      ...['initialized','canceled','disputed','resolved'].map(s=>`${s}() view returns(bool)`),
      'outcome() view returns(uint8)','priceYes() view returns(uint256)','priceNo() view returns(uint256)','prices() view returns(uint256[])'],
    {factory,collateral:addr(1),token:shares,marketId:0,outcomeCount:3,initialized:true,canceled:false,disputed:false,
      resolved,outcome:v===1?1:2,priceYes:'500000',priceNo:'500000',prices:['333333','333333','333333']});
    const created = new ethers.utils.Interface([v===1
      ? 'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)'
      : 'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime,string resolutionSource,string[] outcomes)']);
    addReceipt(hash(500+v),94+v,[encoded(created,'MarketCreated',[0,pool,'Question','test',base+1000,...(v===2?['source',['A','B','C']]:[])],factory)]);
    registryRows.push({factory,pool,marketId:'0',creationTxHash:hash(500+v),creationLogIndex:0});
    const abi = new ethers.utils.Interface([
      v===1?'event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)'
        :'event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
      'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
      v===1?'event WinningsRedeemed(address indexed user,uint256 shares,uint256 payout)'
        :'event WinningsRedeemed(address indexed user,uint8 indexed outcomeIndex,uint256 shares,uint256 payout)',
      'event MarketResolved(uint256 indexed marketId,uint8 outcome)',
      'event ResolutionDisputeOpened(uint256 indexed marketId,uint8 outcome)',
      'event ResolutionDisputeCleared(uint256 indexed marketId,uint8 outcome)',
      'event MarketResolutionCorrected(uint256 indexed marketId,uint8 oldOutcome,uint8 newOutcome)',
      'event MarketCanceled(uint256 indexed marketId)',
    ]);
    eventAbis[v]=abi;
    addReceipt(hash(600+v),110,[encoded(abi,'SharesBought',[addr(30),v===1?true:2,v===1?'100000000':'60000000','1000000',v===1?'180000000':'170000000'],pool,v-1)]);
    if (v===1) addReceipt(hash(610),120,[encoded(abi,'SharesSold',[addr(30),true,'90000000','45000000','1000000'],pool)]);
    if (resolved) {
      addReceipt(hash(620+v),130,[encoded(abi,'MarketResolved',[0,v===1?1:2],pool,v-1)]);
      addReceipt(hash(630+v),140,[encoded(abi,'WinningsRedeemed',[addr(30),...(v===2?[2]:[]),v===1?'90000000':'170000000',v===1?'90000000':'170000000'],pool,v-1)]);
    }
  }
  const calls=[];
  const provider = {
    getNetwork:async()=>({chainId:421614}),getBlockNumber:async()=>asOfBlock+1,getBlock:async n=>block(n),
    getTransactionReceipt:async h=>receipts.get(h),getTransaction:async h=>transactions.get(h),
    getCode:async(at,n)=>{assert.equal(at,addr(6));assert.equal(n,asOfBlock);return routerCode;},
    call:async(tx,n)=>{
      assert.equal(n,asOfBlock,'every mark/binding must use the pinned historical block');calls.push(tx);
      const c=contracts.get(tx.to), decoded=c.abi.parseTransaction(tx);
      const value=typeof c.state[decoded.name]==='function'?c.state[decoded.name](decoded.args):c.state[decoded.name];
      return c.abi.encodeFunctionResult(decoded.name,decoded.name==='markets'?value:[value]);
    },
    getLogs:async filter=>logs.filter(l=>(Array.isArray(filter.address)?filter.address:[filter.address]).includes(l.address) && l.blockNumber>=filter.fromBlock
      && l.blockNumber<=filter.toBlock && filter.topics[0].includes(l.topics[0])),
    sendTransaction:()=>assert.fail('snapshot must never send a transaction'),
    getSigner:()=>assert.fail('snapshot must never request a signer'),
  };
  const registry=tournamentMarketRegistry({cycleId:plan.cycleId,planHash:planHash(plan),markets:registryRows});
  const input={cycle:{plan,plan_hash:planHash(plan),status:'funded'},reviewedPlanHash:planHash(plan),
    registry,reviewedRegistryHash:planHash(registry),funding:[{batchIndex:0,txHash:hash(500)}],fromBlock:100,asOfBlock};
  const options={provider,readIndexerCoverage:async()=>[2,3].map(n=>({chainId:421614,factory:addr(n),lastBlock:asOfBlock}))};
  return {input,options,contracts,receipts,transactions,logs,calls,eventAbis,addReceipt,encoded,block};
}
