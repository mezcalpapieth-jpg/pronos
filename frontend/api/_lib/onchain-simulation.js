// Some RPC/provider combinations return revert bytes from eth_call instead
// of throwing. Validate the ABI result before allowing a signature.
export async function simulateContractCall(provider, transaction, iface, method) {
  const result = await provider.call(transaction);
  const decoded = iface.decodeFunctionResult(method, result);
  if (iface.encodeFunctionResult(method, decoded).toLowerCase() !== result.toLowerCase()) {
    throw new Error('unexpected_simulation_result');
  }
  return decoded;
}
