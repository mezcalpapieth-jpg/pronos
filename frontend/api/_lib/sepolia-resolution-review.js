import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isReviewedFactory } from './protocol-resolution-review.js';
import { simulateContractCall } from './onchain-simulation.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { tradeError } from './trade-requests.js';

export const SEPOLIA_REVIEW_CHAIN = 421614;
export const sepoliaReviewEnabled = (env = process.env) => pendingApprovalSettings(env).previewEnabled
  && env.ONCHAIN_SEPOLIA_REVIEW_ENABLED === 'true'
  && isSepoliaGasDatabase(env.DATABASE_URL) && isSepoliaGasDatabase(env.DATABASE_READ_URL || env.DATABASE_URL);

const factoryInterface = new ethers.utils.Interface([
  'function approveResolution(uint256,bytes32)',
  'function openReviewedResolutionDispute(uint256,bytes32)',
  'function clearReviewedResolutionDispute(uint256,bytes32)',
  'function finalizeResolution(uint256,bytes32)',
  'function sweepDust(uint256,address)',
  'function proposeResolutionCorrection(uint256,bytes32,uint8,bytes32)',
]);
export const proposalInterface = new ethers.utils.Interface([
  'function proposeResolution(uint256,uint8,bytes32)',
]);

const actions = {
  approve: ['approveResolution', 'reviewer', 'under_review'],
  dispute: ['openReviewedResolutionDispute', 'reviewer', 'under_review'],
  clear_dispute: ['clearReviewedResolutionDispute', 'reviewer', 'disputed'],
  correct: ['proposeResolutionCorrection', 'resolver', 'disputed'],
  finalize: ['finalizeResolution', 'owner', 'under_review'],
  recover: ['sweepDust', 'owner', 'finalized'],
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export async function prepareSepoliaReviewTransaction({ market, action, proposalId, outcome, evidenceHash, env, provider,
  reviewedFactory = isReviewedFactory, contractAt = (address, abi) => new ethers.Contract(address, abi, provider) }) {
  if (!Object.hasOwn(actions, action)) throw tradeError('invalid_review_action', 400);
  const [method, role, state] = actions[action];
  const review = market.review;
  if (review.state !== state || review.proposalId !== proposalId) throw tradeError('proposal_changed', 409);
  if ((action === 'approve' && review.approved) || (action === 'finalize' && !review.approved)) {
    throw tradeError('review_approval_changed', 409);
  }
  if (action === 'approve' && (!market.rules_document || !market.evidence_document)) {
    throw tradeError('review_documents_missing', 409);
  }
  if (action === 'correct' && (!Number.isInteger(outcome) || outcome < 0 || outcome >= market.outcomes.length)) {
    throw tradeError('invalid_review_outcome', 400);
  }
  const to = market.factory_address;
  const factoryAddress = market.protocol_version === 'v2' ? env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS : env.ONCHAIN_MARKET_FACTORY_ADDRESS;
  if (!['v1', 'v2'].includes(market.protocol_version) || !ethers.utils.isAddress(to || '')
    || !same(to, factoryAddress) || Number((await provider.getNetwork()).chainId) !== SEPOLIA_REVIEW_CHAIN
    || !await reviewedFactory(provider, SEPOLIA_REVIEW_CHAIN, to)) throw tradeError('review_market_binding_mismatch', 409);

  const factory = contractAt(to, [
    'function collateral() view returns(address)', 'function owner() view returns(address)',
    'function resolutionReviewer() view returns(address)', 'function resolver() view returns(address)', 'function treasury() view returns(address)',
    'function resolutionRulesHash(uint256) view returns(bytes32)',
    'function resolutionProposals(uint256) view returns(bytes32 id,bytes32 evidenceHash,address proposer,uint64 revision,uint8 outcome,bool approved)',
    `function getMarket(uint256) view returns(address,string,string,uint256,string,${market.protocol_version === 'v2' ? 'uint8,' : ''}bool)`,
  ]);
  const id = market.contract_market_id;
  const roleMethod = { reviewer: 'resolutionReviewer', resolver: 'resolver', owner: 'owner' }[role];
  const [pool, collateral, rulesHash, proposal, from, recipient] = await Promise.all([
    factory.getMarket(id), factory.collateral(), factory.resolutionRulesHash(id), factory.resolutionProposals(id),
    factory[roleMethod](),
    action === 'recover' ? factory.treasury() : null,
  ]);
  if (!same(pool[0], market.pool_address) || !same(collateral, env.ONCHAIN_COLLATERAL_ADDRESS)
    || !same(rulesHash, review.rulesHash)) throw tradeError('review_market_binding_mismatch', 409);
  if (!same(proposal.id, proposalId) || proposal.approved !== review.approved) throw tradeError('proposal_changed', 409);
  if (action === 'finalize' && (await provider.getBlock('latest')).timestamp * 1000 < Date.parse(review.reviewEndsAt)) {
    throw tradeError('review_window_open', 409);
  }
  const args = action === 'correct' ? [id, proposalId, outcome + (market.protocol_version === 'v1' ? 1 : 0), evidenceHash]
    : [id, recipient || proposalId];
  const data = factoryInterface.encodeFunctionData(method, args);
  try { await simulateContractCall(provider, { from, to, data }, factoryInterface, method); }
  catch { throw tradeError('review_transaction_unavailable', 409); }
  return { chainId: SEPOLIA_REVIEW_CHAIN, from, to, data, value: '0', role, proposalId, recipient };
}
