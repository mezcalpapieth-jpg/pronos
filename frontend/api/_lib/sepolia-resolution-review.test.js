import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { prepareSepoliaReviewTransaction } from './sepolia-resolution-review.js';

const addr = n => `0x${String(n).repeat(40)}`;
const proposalId = ethers.utils.id('proposal');
const rulesHash = ethers.utils.id('rules');
const evidenceHash = ethers.utils.id('evidence');
const reviewEndsAt = '2026-11-11T00:00:00.000Z';
const deadline = Date.parse(reviewEndsAt) / 1000;

function fixture() {
  const calls = [];
  const market = { factory_address: addr(1), pool_address: addr(2), protocol_version: 'v1',
    contract_market_id: '0', outcomes: ['Lakers', 'Hawks'], rules_document: rulesHash, evidence_document: evidenceHash,
    review: { proposalId, rulesHash, reviewEndsAt, state: 'under_review', approved: false } };
  const factory = { getMarket: async () => [addr(2)], collateral: async () => addr(3),
    resolutionRulesHash: async () => rulesHash, resolutionProposals: async () => ({ id: proposalId, approved: market.review.approved }),
    resolutionReviewer: async () => addr(4), resolver: async () => addr(5), owner: async () => addr(6), treasury: async () => addr(7) };
  const provider = { getNetwork: async () => ({ chainId: 421614 }), getBlock: async () => ({ timestamp: deadline - 1 }),
    call: async tx => { calls.push(tx); return '0x'; } };
  const options = { market, proposalId, env: { ONCHAIN_MARKET_FACTORY_ADDRESS: addr(1), ONCHAIN_COLLATERAL_ADDRESS: addr(3) },
    provider, contractAt: () => factory, reviewedFactory: async () => true };
  return { market, factory, calls, provider, prepare: (action, extra) => prepareSepoliaReviewTransaction({ ...options, action, ...extra }) };
}

test('review transaction prepares reviewer and owner actions for the exact proposal and waits for the onchain deadline', async () => {
  const f = fixture();
  const approve = await f.prepare('approve');
  assert.deepEqual([approve.from, approve.to, approve.chainId, approve.value], [addr(4), addr(1), 421614, '0']);
  assert.ok(approve.data.endsWith(proposalId.slice(2)));
  await assert.rejects(f.prepare('finalize'), /review_approval_changed/);
  f.market.review.approved = true;
  await assert.rejects(f.prepare('finalize'), /review_window_open/);
  assert.equal(f.calls.length, 1);
  f.provider.getBlock = async () => ({ timestamp: deadline });
  const finalized = await f.prepare('finalize');
  assert.equal(finalized.from, addr(6));
  assert.ok(finalized.data.endsWith(proposalId.slice(2)));
  f.market.review.state = 'finalized';
  assert.equal((await f.prepare('recover')).recipient, addr(7));
});

test('review preparation fails for stale proposals, missing documents, wrong bindings and nonempty revert bytes', async () => {
  const f = fixture();
  f.market.evidence_document = null;
  await assert.rejects(f.prepare('approve'), /review_documents_missing/);
  f.factory.resolutionProposals = async () => ({ id: ethers.utils.id('replacement'), approved: false });
  await assert.rejects(f.prepare('dispute'), /proposal_changed/);
  f.factory.collateral = async () => addr(8);
  await assert.rejects(f.prepare('dispute'), /review_market_binding_mismatch/);
  assert.deepEqual(f.calls, []);
  f.factory.collateral = async () => addr(3);
  f.factory.resolutionProposals = async () => ({ id: proposalId, approved: false });
  f.provider.call = async () => '0x12345678';
  await assert.rejects(f.prepare('dispute'), /review_transaction_unavailable/);
});

test('a disputed binary proposal correction is bound to the resolver, revision, evidence and V1 outcome', async () => {
  const f = fixture();
  f.market.review.state = 'disputed';
  const correction = await f.prepare('correct', { outcome: 1, evidenceHash });
  assert.equal(correction.from, addr(5));
  const iface = new ethers.utils.Interface(['function proposeResolutionCorrection(uint256,bytes32,uint8,bytes32)']);
  const args = iface.decodeFunctionData('proposeResolutionCorrection', correction.data);
  assert.deepEqual([args[0].toString(), args[1], args[2], args[3]], ['0', proposalId, 2, evidenceHash]);
});
