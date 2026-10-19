import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { confirmedTradingActivity } from './sepolia-gas-activity.js';

const a=n=>`0x${String(n).repeat(40)}`,h=n=>`0x${String(n).repeat(64)}`;
function fixture(version='v1') {
  const abi=new ethers.utils.Interface([version==='v1'
    ? 'event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)'
    : 'event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)']);
  const event=abi.encodeEventLog(abi.getEvent('SharesBought'),[a(1),version==='v1'?true:2,100,1,180]);
  const candidate={pool_address:a(2),factory_address:a(3),market_id:'0',protocol_version:version,tx_hash:h(1),block_number:'10',log_index:'1'};
  const receipt={status:1,transactionHash:h(1),blockNumber:10,blockHash:h(2),confirmations:2,logs:[{...event,address:a(2),logIndex:1}]};
  const args={ownerAddr:a(1),env:{ONCHAIN_MARKET_FACTORY_ADDRESS:a(3)},sql:async()=>[candidate],
    provider:{getTransactionReceipt:async()=>receipt,getBlock:async()=>({hash:h(2)})},
    contractAt:()=>({markets:async()=>a(2)})};
  return {args,receipt,candidate};
}
test('only canonical confirmed user economic events promote binary and multi wallets',async()=>{
  for(const version of ['v1','v2']) assert.equal(await confirmedTradingActivity(fixture(version).args),true);
  for(const mutate of [f=>f.receipt.status=0,f=>f.receipt.confirmations=1,f=>f.receipt.blockHash=h(3),
    f=>f.receipt.logs[0].address=a(9),f=>f.receipt.logs[0].removed=true,f=>f.receipt.logs[0].topics=[],
    f=>f.args.ownerAddr=a(9),f=>f.candidate.block_number='11',
    f=>f.args.contractAt=()=>({markets:async()=>a(9)})]) {
    const f=fixture();mutate(f);assert.equal(await confirmedTradingActivity(f.args),false);
  }
});
test('empty index and transient RPC failure cannot manufacture activity',async()=>{
  const f=fixture();f.args.sql=async()=>({rows:[]});assert.equal(await confirmedTradingActivity(f.args),false);
  f.args.sql=async()=>[f.candidate];f.args.provider.getTransactionReceipt=async()=>{throw Error('rpc down');};
  await assert.rejects(confirmedTradingActivity(f.args),/rpc down/);
});
