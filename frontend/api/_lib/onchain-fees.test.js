import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { onchainFeeData } from './onchain-fees.js';

test('Sepolia quotes avoid Ethereum default tips and fund the runtime gas reserve', async () => {
  const gasPrice = ethers.utils.parseUnits('0.020092', 'gwei');
  const fees = await onchainFeeData({
    getGasPrice: async () => gasPrice,
    getFeeData: async () => { throw new Error('must not use Ethereum defaults'); },
  }, 421614);
  assert.ok(fees.maxFeePerGas.eq(gasPrice.mul(2)));
  assert.ok(fees.maxPriorityFeePerGas.isZero());
  const multiMarketReserve = fees.maxFeePerGas.mul(6_500_000).mul(2);
  assert.ok(multiMarketReserve.lt(ethers.utils.parseEther('0.001')));
});

test('other chains retain their provider fee policy', async () => {
  const fees = { maxFeePerGas: ethers.BigNumber.from(10), maxPriorityFeePerGas: ethers.BigNumber.from(2) };
  for (const chain of [42161, 1, 8453]) {
    assert.equal(await onchainFeeData({ getFeeData: async () => fees }, chain), fees);
  }
});

test('Sepolia fails closed for unavailable or zero gas quotes', async () => {
  await assert.rejects(onchainFeeData({ getGasPrice: async () => ethers.constants.Zero }, 421614), /invalid_sepolia_gas_price/);
  await assert.rejects(onchainFeeData({ getGasPrice: async () => { throw new Error('RPC unavailable'); } }, 421614), /RPC unavailable/);
});
