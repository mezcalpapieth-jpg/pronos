import { ethers } from 'ethers';

export async function onchainFeeData(provider, chainId) {
  if (Number(chainId) === 421614) {
    // ethers v5 getFeeData() adds a 1.5 gwei Ethereum priority-fee default.
    // Use the Sepolia node's gas quote with headroom for this testnet runtime.
    const gasPrice = await provider.getGasPrice();
    if (!gasPrice || gasPrice.lte(0)) throw new Error('invalid_sepolia_gas_price');
    return {
      gasPrice,
      maxFeePerGas: gasPrice.mul(2),
      maxPriorityFeePerGas: ethers.constants.Zero,
    };
  }
  return provider.getFeeData();
}
