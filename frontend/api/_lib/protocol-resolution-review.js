import { ethers } from 'ethers';

export const REVIEW_EVENT_ABI = [
  'event ResolutionRulesCommitted(uint256 indexed marketId, bytes32 rulesHash)',
  'event ResolutionProposed(uint256 indexed marketId, bytes32 indexed proposalId, address indexed proposer, uint8 outcome, bytes32 evidenceHash, uint64 revision, uint256 reviewEndsAt)',
  'event ResolutionApproved(uint256 indexed marketId, bytes32 indexed proposalId, address indexed reviewer)',
  'event ResolutionFlagged(uint256 indexed marketId, bytes32 indexed proposalId, address indexed reporter, bytes32 objectionHash)',
  'event ResolutionReviewFinalized(uint256 indexed marketId, bytes32 indexed proposalId)',
];

const capability = new ethers.utils.Interface(['function requiresResolutionReview() view returns (bool)']);

export async function isReviewedFactory(provider, chainId, address) {
  if (chainId !== 42161) return false;
  let result;
  try {
    result = await provider.call({ to: address, data: capability.encodeFunctionData('requiresResolutionReview') });
  } catch (error) {
    if (error.code === 'CALL_EXCEPTION' && error.data === '0x') return false;
    throw error;
  }
  return result !== '0x' && capability.decodeFunctionResult('requiresResolutionReview', result)[0];
}

function applyEvent(previous, kind, args, transactionHash) {
  if (kind === 'ResolutionRulesCommitted') {
    if (previous) throw new Error('Duplicate resolution rules commitment');
    return { rulesHash: args.rulesHash, state: 'open' };
  }
  if (!previous) throw new Error('Missing resolution rules commitment; replay from factory deployment');

  if (kind === 'ResolutionProposed') {
    const revision = Number(args.revision);
    if (revision !== (previous.revision ?? 0) + 1) throw new Error('Missing prior resolution proposal');
    return {
      rulesHash: previous.rulesHash, state: 'under_review', proposalId: args.proposalId,
      proposer: args.proposer, evidenceHash: args.evidenceHash, revision, outcome: Number(args.outcome),
      reviewEndsAt: new Date(Number(args.reviewEndsAt) * 1000).toISOString(), approved: false,
    };
  }
  if (kind === 'ResolutionDisputeOpened') return { ...previous, state: 'disputed', approved: false };
  if (kind === 'MarketCanceled') return { ...previous, state: 'canceled', approved: false };
  if (previous.state !== 'under_review' || previous.proposalId !== args.proposalId) {
    throw new Error('Resolution event does not match the current proposal');
  }
  if (kind === 'ResolutionApproved') return { ...previous, approved: true };
  if (kind === 'ResolutionReviewFinalized' && previous.approved) {
    return { ...previous, state: 'finalized', finalizedTxHash: transactionHash };
  }
  throw new Error('Finalization event without indexed approval');
}

// Reviewed factories also emit the legacy MarketResolved event on proposal.
// Only the reviewed event stream can make these markets claimable.
export async function indexReviewedResolution(sql, chainId, factory, { kind, event }) {
  const contractMarketId = Number(event.args.marketId);
  const [market] = await sql`
    SELECT id, resolution_review, resolution_review_block, resolution_review_log
    FROM protocol_markets
    WHERE chain_id = ${chainId} AND factory_address = ${factory} AND market_id = ${contractMarketId}
  `;
  if (!market) throw new Error('Missing reviewed market; replay from factory deployment');

  if (kind === 'ResolutionFlagged') {
    const { proposalId, reporter, objectionHash } = event.args;
    await sql`
      INSERT INTO protocol_resolution_objections
        (market_id, proposal_id, source, source_key, reporter_address, objection_hash, tx_hash)
      VALUES (${market.id}, ${proposalId}, 'chain', ${`${event.transactionHash}:${event.logIndex}`},
        ${reporter.toLowerCase()}, ${objectionHash}, ${event.transactionHash})
      ON CONFLICT (market_id, proposal_id, source, source_key) DO NOTHING
    `;
    return;
  }
  const block = Number(market.resolution_review_block ?? -1);
  const log = Number(market.resolution_review_log ?? -1);
  if (block > event.blockNumber || (block === event.blockNumber && log >= event.logIndex)) return;

  const review = applyEvent(market.resolution_review, kind, event.args, event.transactionHash);
  const status = { open: 'active', finalized: 'resolved' }[review.state] ?? review.state;
  const outcome = status === 'resolved' ? review.outcome : null;
  const [updated] = await sql`
    UPDATE protocol_markets SET
      resolution_review = ${JSON.stringify(review)}::jsonb,
      resolution_review_block = ${event.blockNumber}, resolution_review_log = ${event.logIndex},
      status = ${status}, outcome = ${outcome}, lifecycle_updated_at = NOW(),
      resolved_at = CASE WHEN ${status} = 'resolved' THEN NOW() END,
      canceled_at = CASE WHEN ${status} = 'canceled' THEN COALESCE(canceled_at, NOW()) END,
      dispute_opened_at = CASE WHEN ${status} = 'disputed' THEN COALESCE(dispute_opened_at, NOW()) END
    WHERE id = ${market.id} AND COALESCE(resolution_review_block, -1) = ${block}
      AND COALESCE(resolution_review_log, -1) = ${log}
    RETURNING id
  `;
  if (!updated) throw new Error('Concurrent review index update; retry the range');
}
