import { ethers } from 'ethers';
import { tradingFactories } from './trading-router.js';

const abis = [
  ['event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
    'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
    'event WinningsRedeemed(address indexed user,uint256 shares,uint256 payout)'],
  ['event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)',
    'event SharesSold(address indexed seller,uint8 indexed outcomeIndex,uint256 sharesIn,uint256 collateralOut,uint256 fee)',
    'event WinningsRedeemed(address indexed user,uint8 indexed outcomeIndex,uint256 shares,uint256 payout)'],
].map(abi => new ethers.utils.Interface(abi));
const rowsOf = result => Array.isArray(result) ? result : result.rows;

// Indexed rows are hints only. Require a canonical successful receipt, the
// user's economic event and an actual factory membership read before promotion.
export async function confirmedTradingActivity({ sql, provider, ownerAddr, env = process.env,
  contractAt = (a, abi) => new ethers.Contract(a, abi, provider) }) {
  const owner = ownerAddr.toLowerCase(), factories = tradingFactories(env);
  const candidates = rowsOf(await sql`
    SELECT m.pool_address, m.factory_address, m.market_id, m.protocol_version, a.tx_hash, a.block_number, a.log_index
    FROM (
      SELECT market_id, tx_hash, block_number, log_index FROM trades WHERE LOWER(trader) = ${owner}
      UNION ALL
      SELECT market_id, tx_hash, block_number, log_index FROM redemptions WHERE LOWER(user_address) = ${owner}
    ) a JOIN protocol_markets m ON m.id = a.market_id
    WHERE m.chain_id = 421614 AND LOWER(m.factory_address) = ANY(${factories}::text[])
    ORDER BY a.block_number DESC, a.log_index DESC LIMIT 10`);
  for (const row of candidates) {
    if (!factories.includes(row.factory_address?.toLowerCase())) continue;
    const receipt = await provider.getTransactionReceipt(row.tx_hash);
    if (!receipt || receipt.status !== 1 || !Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < 2
      || receipt.transactionHash.toLowerCase() !== row.tx_hash.toLowerCase()
      || receipt.blockNumber !== Number(row.block_number)) continue;
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) continue;
    const log = receipt.logs.find(l => l.logIndex === Number(row.log_index));
    if (!log || log.removed || log.address.toLowerCase() !== row.pool_address.toLowerCase()) continue;
    let event;
    try { event = abis[row.protocol_version === 'v2' ? 1 : 0].parseLog(log); } catch { continue; }
    const actor = event.args.buyer || event.args.seller || event.args.user;
    const amount = event.args.sharesOut || event.args.sharesIn || event.args.shares;
    if (actor?.toLowerCase() !== owner || !amount?.gt(0)) continue;
    const factory = contractAt(row.factory_address, ['function markets(uint256) view returns(address pool)']);
    if ((await factory.markets(row.market_id)).toLowerCase() !== row.pool_address.toLowerCase()) continue;
    // Bracket membership and receipt reads against an observed reorg.
    if ((await provider.getBlock(receipt.blockNumber)).hash.toLowerCase() !== block.hash.toLowerCase()) continue;
    return true;
  }
  return false;
}
