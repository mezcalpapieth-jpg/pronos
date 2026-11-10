import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { applyCors } from '../_lib/cors.js';
import { requirePointsAdmin } from '../_lib/points-admin.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import { requireSession } from '../_lib/session.js';
import { prepareSepoliaReviewTransaction, SEPOLIA_REVIEW_CHAIN, sepoliaReviewEnabled } from '../_lib/sepolia-resolution-review.js';

const hashPattern = /^0x[a-f0-9]{64}$/;
const hashText = value => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));

async function findMarket(sql, id, chainId) {
  const rows = await sql`
    SELECT m.id, m.protocol_version, p.outcomes, m.resolution_review AS review,
      m.market_id::text AS contract_market_id, m.factory_address, m.pool_address,
      r.hash AS rules_document, e.hash AS evidence_document
    FROM points_markets p
    JOIN protocol_markets m ON m.chain_id = p.chain_id AND LOWER(m.pool_address) = LOWER(p.chain_address)
      AND m.market_id::text = p.chain_market_id::text
    LEFT JOIN protocol_resolution_documents r ON r.hash = m.resolution_review->>'rulesHash'
    LEFT JOIN protocol_resolution_documents e ON e.hash = m.resolution_review->>'evidenceHash'
    WHERE p.id = ${id} AND p.mode = 'onchain' AND p.chain_id = ${chainId}
      AND m.resolution_review IS NOT NULL
    LIMIT 2
  `;
  if (rows.length > 1) throw new Error('Ambiguous reviewed market');
  return rows[0];
}

function publicReview(market, chainId) {
  const review = market.review;
  return {
    ...review,
    chainId,
    outcome: review.outcome == null ? null : review.outcome - (market.protocol_version === 'v1' ? 1 : 0),
    outcomes: market.outcomes,
    rulesDocument: market.rules_document || null,
    evidenceDocument: market.evidence_document || null,
  };
}

async function reviewerQueue(sql, chainId) {
  const markets = await sql`
    SELECT p.id AS "marketId", p.question, m.pool_address AS "poolAddress", m.factory_address AS "factoryAddress",
      m.market_id AS "contractMarketId", m.resolution_review AS review, m.protocol_version, p.outcomes,
      r.hash AS rules_document, e.hash AS evidence_document
    FROM points_markets p
    JOIN protocol_markets m ON m.chain_id = p.chain_id AND LOWER(m.pool_address) = LOWER(p.chain_address)
      AND m.market_id::text = p.chain_market_id::text
    LEFT JOIN protocol_resolution_documents r ON r.hash = m.resolution_review->>'rulesHash'
    LEFT JOIN protocol_resolution_documents e ON e.hash = m.resolution_review->>'evidenceHash'
    WHERE p.mode = 'onchain' AND p.chain_id = ${chainId}
      AND (m.resolution_review->>'state' IN ('under_review', 'disputed') OR
        (${chainId} = 421614 AND m.resolution_review->>'state' = 'finalized'))
    ORDER BY (m.resolution_review->>'state' = 'finalized'),
      CASE WHEN m.resolution_review->>'state' <> 'finalized' THEN m.resolution_review->>'reviewEndsAt' END,
      p.id DESC
    LIMIT 51
  `;
  const objections = await sql`
    SELECT o.id::text, p.id AS "marketId", p.question, o.proposal_id AS "proposalId", o.source,
      o.reporter_address AS "reporterAddress", o.objection_hash AS "objectionHash",
      o.detail, o.tx_hash AS "txHash", o.created_at AS "createdAt",
      (o.proposal_id = m.resolution_review->>'proposalId') AS current,
      m.resolution_review->>'state' AS state
    FROM protocol_resolution_objections o
    JOIN protocol_markets m ON m.id = o.market_id AND m.chain_id = ${chainId}
    JOIN points_markets p ON p.mode = 'onchain' AND p.chain_id = m.chain_id
      AND LOWER(p.chain_address) = LOWER(m.pool_address) AND p.chain_market_id::text = m.market_id::text
    ORDER BY ((o.proposal_id = m.resolution_review->>'proposalId')
      AND m.resolution_review->>'state' IN ('under_review', 'disputed')) DESC, o.id DESC
    LIMIT 101
  `;
  return {
    chainId,
    markets: markets.slice(0, 50).map(row => ({ ...row, review: publicReview(row, chainId) })),
    objections: objections.slice(0, 100),
    truncated: markets.length > 50 || objections.length > 100,
  };
}

export function createResolutionReviewHandler({
  env = process.env, sqlFor = neon, adminFor = requirePointsAdmin, sessionFor = requireSession, limit = rateLimit,
  prepare = prepareSepoliaReviewTransaction,
  providerFor = () => new ethers.providers.JsonRpcProvider({ url: env.ONCHAIN_RPC_URL, timeout: 10000 }),
} = {}) {
  return async (req, res) => {
    const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
    if (cors) return cors;
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const chainId = sepoliaReviewEnabled(env) ? SEPOLIA_REVIEW_CHAIN
      : env.ONCHAIN_MAINNET_REVIEW_ENABLED === 'true' ? 42161 : null;
    if (!chainId) return res.status(404).json({ error: 'review_disabled' });

    const queue = req.method === 'GET' && req.query?.queue === '1';
    const publishing = req.method === 'POST' && req.body?.action === 'publish';
    const preparing = req.method === 'POST' && req.body?.action === 'prepare';
    if (preparing && chainId !== SEPOLIA_REVIEW_CHAIN) return res.status(404).json({ error: 'review_disabled' });
    const correcting = preparing && req.body?.operation === 'correct';
    const actor = queue || publishing || preparing ? adminFor(req, res) : req.method === 'POST' ? sessionFor(req, res) : null;
    if ((queue || req.method === 'POST') && !actor) return;
    const write = req.method === 'POST';
    if (limit(req, res, { key: `resolution-review:${write ? actor.sub : clientIp(req)}:${req.method}`,
      limit: write ? 20 : 120, windowMs: 60000 })) return;

    try {
      const sql = sqlFor(write && (!preparing || correcting) ? env.DATABASE_URL : env.DATABASE_READ_URL || env.DATABASE_URL);
      if (queue) return res.status(200).json(await reviewerQueue(sql, chainId));
      const document = req.query?.document;
      if (!write && typeof document === 'string' && hashPattern.test(document)) {
        const [artifact] = await sql`SELECT content FROM protocol_resolution_documents WHERE hash = ${document}`;
        if (!artifact) return res.status(404).json({ error: 'document_not_found' });
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.status(200).send(artifact.content);
      }
      const rawId = write ? req.body?.marketId : req.query?.marketId;
      const id = Number(rawId);
      if (!['string', 'number'].includes(typeof rawId) || !/^\d+$/.test(String(rawId))
        || !Number.isInteger(id) || id < 1 || id > 2147483647) {
        return res.status(400).json({ error: 'invalid_market' });
      }
      const market = await findMarket(sql, id, chainId);
      if (!market) return res.status(404).json({ error: 'review_market_not_found' });
      if (!write) return res.status(200).json({ review: publicReview(market, chainId) });

      if (preparing) {
        const { proposalId, operation } = req.body;
        if (typeof proposalId !== 'string' || !hashPattern.test(proposalId)) {
          return res.status(400).json({ error: 'invalid_proposal' });
        }
        const { content, outcome } = req.body;
        if (correcting && (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 32768)) {
          return res.status(400).json({ error: 'invalid_document' });
        }
        const evidenceHash = correcting ? hashText(content) : null;
        const transaction = await prepare({ market, action: operation, proposalId, outcome, evidenceHash, env, provider: providerFor() });
        if (correcting) {
          await sql`INSERT INTO protocol_resolution_documents(hash, content) VALUES (${evidenceHash}, ${content})
            ON CONFLICT (hash) DO NOTHING`;
        }
        return res.status(200).json({ transaction });
      }

      if (publishing) {
        const content = req.body?.content;
        if (typeof content !== 'string' || !content.trim() || Buffer.byteLength(content, 'utf8') > 32768) {
          return res.status(400).json({ error: 'invalid_document' });
        }
        const hash = hashText(content);
        if (![market.review.rulesHash, market.review.evidenceHash].includes(hash)) {
          return res.status(409).json({ error: 'document_hash_mismatch' });
        }
        await sql`INSERT INTO protocol_resolution_documents(hash, content) VALUES (${hash}, ${content})
          ON CONFLICT (hash) DO NOTHING`;
        return res.status(200).json({ hash });
      }

      const { action, proposalId } = req.body || {};
      const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim() : '';
      if (action !== 'object' || typeof actor.sub !== 'string' || !actor.sub
        || typeof proposalId !== 'string' || !hashPattern.test(proposalId)
        || !detail || detail.length > 2000) return res.status(400).json({ error: 'invalid_objection' });
      const objectionHash = hashText(detail);
      const [inserted] = await sql`
        WITH current_market AS (
          SELECT id FROM protocol_markets
          WHERE id = ${market.id} AND resolution_review->>'proposalId' = ${proposalId}
            AND resolution_review->>'state' IN ('under_review', 'disputed')
          FOR UPDATE
        )
        INSERT INTO protocol_resolution_objections (market_id, proposal_id, source, source_key, objection_hash, detail)
        SELECT id, ${proposalId}, 'points', ${actor.sub}, ${objectionHash}, ${detail} FROM current_market
        ON CONFLICT (market_id, proposal_id, source, source_key) DO NOTHING
        RETURNING objection_hash
      `;
      const existing = inserted || (await sql`SELECT objection_hash FROM protocol_resolution_objections
        WHERE market_id = ${market.id} AND proposal_id = ${proposalId}
          AND source = 'points' AND source_key = ${actor.sub}`)[0];
      if (existing?.objection_hash === objectionHash) return res.status(200).json({ ok: true, objectionHash });
      return res.status(409).json({ error: existing ? 'objection_already_submitted' : 'proposal_changed' });
    } catch (error) {
      if (preparing && [400, 409].includes(error.status) && /^(?:review_|invalid_review_|proposal_changed)/.test(error.message)) {
        return res.status(error.status).json({ error: error.message });
      }
      return res.status(503).json({ error: 'resolution_review_unavailable' });
    }
  };
}

export default createResolutionReviewHandler();
