import { SEPOLIA_REVIEW_CHAIN, sepoliaReviewEnabled } from './sepolia-resolution-review.js';

export const REVIEWED_CHAIN_ID = 42161;
export const REVIEWED_RULES_PATH = '/api/points/resolution-review?document=';

export function hasGeneratedReviewedRules(market) {
  return market.mode === 'onchain' && [REVIEWED_CHAIN_ID, SEPOLIA_REVIEW_CHAIN].includes(Number(market.chain_id))
    && market.resolution_src?.startsWith(REVIEWED_RULES_PATH);
}

export function reviewedCreationError(code, detail, status = 409) {
  return Object.assign(new Error(code), { status, detail });
}

export function reviewedCreationEnabled(env = process.env) {
  const chainId = env.ONCHAIN_CHAIN_ID;
  const indexerChains = [env.CHAIN_ID, env.PROTOCOL_CHAIN_ID].filter(Boolean);
  if (env.ONCHAIN_REVIEWED_CREATION_ENABLED !== 'true' || indexerChains.some(chain => chain !== chainId)) return false;
  if (chainId === String(SEPOLIA_REVIEW_CHAIN)) {
    // The app indexer's implicit default is Arbitrum One.
    return indexerChains.length > 0 && sepoliaReviewEnabled(env);
  }
  return chainId === String(REVIEWED_CHAIN_ID) && env.ONCHAIN_MAINNET_REVIEW_ENABLED === 'true';
}
