import { releaseOpenLimitOrdersForMarkets } from './points-limit-orders.js';

export const DEFAULT_INVALID_LEG_REASON = 'Reembolso: nominada inválida';
const INVALID_LEG_FINAL_SCORE = 'Opción inválida: nominada inválida';
const EDITABLE_STATUSES = new Set(['active', 'pending']);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizeInvalidLegLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isEditableStatus(status) {
  return EDITABLE_STATUSES.has(String(status || '').trim());
}

function childLabel(child) {
  return String(child?.leg_label || '').trim();
}

function rowSeed(row, fallback = 1000) {
  const value = Number(row?.seed_liquidity);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function selectedReason(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 180) : DEFAULT_INVALID_LEG_REASON;
}

export function normalizeInvalidParallelLegRequest(raw = {}) {
  const marketId = parsePositiveInt(raw.marketId ?? raw.legMarketId ?? raw.childMarketId);
  const parentMarketId = parsePositiveInt(raw.parentMarketId ?? raw.parentId);
  const legLabel = typeof raw.legLabel === 'string' ? raw.legLabel.trim() : '';
  if (!marketId && (!parentMarketId || !legLabel)) {
    return { error: 'invalid_leg_selector' };
  }
  return {
    marketId,
    parentMarketId,
    legLabel,
    reason: selectedReason(raw.reason),
  };
}

function imageByLabelFromParent(parent) {
  const labels = parseJsonb(parent?.outcomes, []);
  const images = parseJsonb(parent?.outcome_images, []);
  const byLabel = new Map();
  if (!Array.isArray(labels) || !Array.isArray(images)) return byLabel;
  labels.forEach((label, index) => {
    const key = normalizeInvalidLegLabel(label);
    if (key && !byLabel.has(key)) byLabel.set(key, images[index] ?? null);
  });
  return byLabel;
}

function nextResolverConfig(parent, remainingChildren, invalidChildren, {
  nowIso,
  adminUsername,
  reason,
}) {
  const cfg = parseJsonb(parent?.resolver_config, {});
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return cfg;

  const oldLegs = Array.isArray(cfg.legs) ? cfg.legs : [];
  const oldLegByLabel = new Map(oldLegs.map(leg => [
    normalizeInvalidLegLabel(leg?.label),
    leg && typeof leg === 'object' ? leg : {},
  ]));
  const invalidLegVoids = [
    ...(Array.isArray(cfg.invalidLegVoids) ? cfg.invalidLegVoids.slice(-20) : []),
    ...invalidChildren.map(child => ({
      marketId: Number(child.id),
      label: childLabel(child),
      reason,
      voidedAt: nowIso,
      voidedBy: adminUsername || null,
    })),
  ];

  return {
    ...cfg,
    legs: remainingChildren.map((child) => {
      const label = childLabel(child);
      const oldLeg = oldLegByLabel.get(normalizeInvalidLegLabel(label)) || {};
      return {
        ...oldLeg,
        label,
      };
    }),
    invalidLegVoids,
    invalidLegVoidedAt: nowIso,
  };
}

export function buildInvalidParallelLegPlan({
  parent,
  children = [],
  targetChildIds = [],
  refundRows = [],
  reason = DEFAULT_INVALID_LEG_REASON,
  adminUsername = null,
  nowIso = new Date().toISOString(),
} = {}) {
  const targetIds = new Set(
    targetChildIds.map(Number).filter(Number.isInteger),
  );
  const invalidChildren = children.filter(child => targetIds.has(Number(child.id)));
  const remainingChildren = children.filter(child => (
    !targetIds.has(Number(child.id)) && String(child?.status || '') !== 'canceled'
  ));
  const parentSeed = rowSeed(parent, 1000);
  const imagesByLabel = imageByLabelFromParent(parent);
  const outcomes = remainingChildren
    .map(childLabel)
    .filter(Boolean);
  const outcomeImages = remainingChildren.map(child => (
    imagesByLabel.get(normalizeInvalidLegLabel(childLabel(child))) ?? null
  ));
  const seedLiquidities = remainingChildren.map(child => rowSeed(child, parentSeed));
  const refunds = Array.isArray(refundRows) ? refundRows.map(row => ({
    marketId: Number(row.market_id),
    username: row.username,
    amount: Number(row.amount || 0),
  })).filter(row => Number.isInteger(row.marketId) && row.username && row.amount > 0) : [];

  return {
    parentId: Number(parent?.id || 0),
    question: parent?.question || null,
    invalidChildren,
    remainingChildren,
    outcomes,
    outcomeImages,
    seedLiquidities,
    resolverConfig: nextResolverConfig(parent, remainingChildren, invalidChildren, {
      nowIso,
      adminUsername,
      reason,
    }),
    sourceDataPatch: {
      parallelLegVoid: {
        voidedAt: nowIso,
        voidedBy: adminUsername || null,
        reason,
        marketIds: invalidChildren.map(child => Number(child.id)),
        labels: invalidChildren.map(childLabel),
      },
    },
    refundRows: refunds,
    refundCount: refunds.length,
    totalRefunded: refunds.reduce((sum, row) => sum + row.amount, 0),
  };
}

async function queryRefundRows(client, marketIds, { lock = false } = {}) {
  if (!marketIds.length) return [];
  if (lock) {
    await client.query(
      `SELECT market_id, username, outcome_index, shares, cost_basis
         FROM points_positions
        WHERE market_id = ANY($1::int[])
          AND shares > 0
        FOR UPDATE`,
      [marketIds],
    );
  }
  const result = await client.query(
    `SELECT market_id, username, SUM(cost_basis) AS amount
       FROM points_positions
      WHERE market_id = ANY($1::int[])
        AND shares > 0
        AND cost_basis > 0
      GROUP BY market_id, username
      ORDER BY market_id ASC, username ASC`,
    [marketIds],
  );
  return result.rows;
}

function typedError(message, status = 400, detail = null) {
  const err = new Error(message);
  err.status = status;
  err.detail = detail;
  return err;
}

export async function voidInvalidParallelLeg(client, {
  marketId = null,
  parentMarketId = null,
  legLabel = '',
  reason = DEFAULT_INVALID_LEG_REASON,
  dryRun = true,
  adminUsername = 'invalid-leg-repair',
  now = new Date(),
} = {}) {
  const legId = parsePositiveInt(marketId);
  let parentId = parsePositiveInt(parentMarketId);
  let selectedChildIds = legId ? [legId] : [];
  const normalizedLabel = normalizeInvalidLegLabel(legLabel);
  if (!legId && (!parentId || !normalizedLabel)) {
    throw typedError('invalid_leg_selector', 400);
  }

  if (legId) {
    const childResult = await client.query(
      `SELECT id, parent_id, status, leg_label
         FROM points_markets
        WHERE id = $1
        ${dryRun ? '' : 'FOR UPDATE'}`,
      [legId],
    );
    const child = childResult.rows[0] || null;
    if (!child) throw typedError('leg_market_not_found', 404);
    if (!child.parent_id) throw typedError('not_parallel_leg', 400);
    parentId = Number(child.parent_id);
  }

  const parentResult = await client.query(
    `SELECT *
       FROM points_markets
      WHERE id = $1
      ${dryRun ? '' : 'FOR UPDATE'}`,
    [parentId],
  );
  const parent = parentResult.rows[0] || null;
  if (!parent) throw typedError('parent_market_not_found', 404);
  if (parent.parent_id || parent.amm_mode !== 'parallel') {
    throw typedError('not_parallel_parent', 400);
  }
  if (!isEditableStatus(parent.status)) {
    throw typedError('parent_market_not_editable', 400, `Current status is ${parent.status}.`);
  }
  if ((parent.mode || 'points') !== 'points') {
    throw typedError('not_points_mode', 400);
  }

  const childrenResult = await client.query(
    `SELECT *
       FROM points_markets
      WHERE parent_id = $1
      ORDER BY id ASC
      ${dryRun ? '' : 'FOR UPDATE'}`,
    [parent.id],
  );
  const children = childrenResult.rows;

  if (!legId) {
    selectedChildIds = children
      .filter(child => normalizeInvalidLegLabel(childLabel(child)) === normalizedLabel)
      .map(child => Number(child.id));
  }
  const selectedChildren = children.filter(child => selectedChildIds.includes(Number(child.id)));
  if (selectedChildren.length === 0) throw typedError('parallel_leg_not_found', 404);
  if (selectedChildren.length > 1) throw typedError('ambiguous_parallel_leg', 400);

  const invalidChild = selectedChildren[0];
  if (!isEditableStatus(invalidChild.status)) {
    throw typedError('parallel_leg_not_editable', 400, `Current status is ${invalidChild.status}.`);
  }

  const remainingEditable = children.filter(child => (
    !selectedChildIds.includes(Number(child.id))
    && String(child?.status || '') !== 'canceled'
  ));
  if (remainingEditable.length < 2) {
    throw typedError('insufficient_remaining_parallel_legs', 400);
  }

  const marketIds = selectedChildren.map(child => Number(child.id));
  const refundRows = await queryRefundRows(client, marketIds, { lock: !dryRun });
  const nowIso = new Date(now).toISOString();
  const cleanReason = selectedReason(reason);
  const plan = buildInvalidParallelLegPlan({
    parent,
    children,
    targetChildIds: marketIds,
    refundRows,
    reason: cleanReason,
    adminUsername,
    nowIso,
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      marketId: Number(parent.id),
      voidedMarketIds: marketIds,
      labels: plan.invalidChildren.map(childLabel),
      remainingOutcomes: plan.outcomes,
      refundCount: plan.refundCount,
      totalRefunded: plan.totalRefunded,
      refunds: plan.refundRows,
      reason: cleanReason,
    };
  }

  const limitOrderRelease = await releaseOpenLimitOrdersForMarkets(client, marketIds, {
    reason: 'invalid_nominee',
    status: 'cancelled',
  });

  await client.query(
    `WITH refunds AS (
       SELECT username, SUM(cost_basis) AS amount
         FROM points_positions
        WHERE market_id = ANY($1::int[])
          AND shares > 0
          AND cost_basis > 0
        GROUP BY username
     )
     INSERT INTO points_balances (username, balance, updated_at)
     SELECT username, amount, NOW()
       FROM refunds
     ON CONFLICT (username) DO UPDATE
       SET balance = points_balances.balance + EXCLUDED.balance,
           updated_at = NOW()`,
    [marketIds],
  );

  const distributionRows = await client.query(
    `WITH refunds AS (
       SELECT username, market_id, SUM(cost_basis) AS amount
         FROM points_positions
        WHERE market_id = ANY($1::int[])
          AND shares > 0
          AND cost_basis > 0
        GROUP BY username, market_id
     )
     INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
     SELECT username, amount, 'invalid_field_refund', market_id, $2
       FROM refunds
     RETURNING username, amount, reference_id`,
    [marketIds, cleanReason],
  );

  await client.query(
    `UPDATE points_positions
        SET shares = 0,
            cost_basis = 0,
            updated_at = NOW(),
            dismissed_at = NOW()
      WHERE market_id = ANY($1::int[])
        AND shares > 0`,
    [marketIds],
  );

  await client.query(
    `UPDATE points_markets
        SET status = 'canceled',
            outcome = NULL,
            resolved_at = NOW(),
            resolved_by = $2,
            final_score = $3
      WHERE id = ANY($1::int[])
        AND status IN ('active', 'pending')`,
    [marketIds, adminUsername, INVALID_LEG_FINAL_SCORE],
  );

  await client.query(
    `UPDATE points_markets
        SET outcomes = $1::jsonb,
            outcome_images = $2::jsonb,
            seed_liquidities = $3::jsonb,
            resolver_config = $4::jsonb
      WHERE id = $5`,
    [
      JSON.stringify(plan.outcomes),
      JSON.stringify(plan.outcomeImages),
      JSON.stringify(plan.seedLiquidities),
      JSON.stringify(plan.resolverConfig),
      parent.id,
    ],
  );

  await client.query(
    `UPDATE points_pending_markets
        SET outcomes = $1::jsonb,
            outcome_images = $2::jsonb,
            seed_liquidities = $3::jsonb,
            resolver_config = $4::jsonb,
            source_data = COALESCE(source_data, '{}'::jsonb) || $5::jsonb
      WHERE approved_market_id = $6`,
    [
      JSON.stringify(plan.outcomes),
      JSON.stringify(plan.outcomeImages),
      JSON.stringify(plan.seedLiquidities),
      JSON.stringify(plan.resolverConfig),
      JSON.stringify(plan.sourceDataPatch),
      parent.id,
    ],
  );

  const totalRefunded = distributionRows.rows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );

  return {
    ok: true,
    dryRun: false,
    marketId: Number(parent.id),
    voidedMarketIds: marketIds,
    labels: plan.invalidChildren.map(childLabel),
    remainingOutcomes: plan.outcomes,
    refundCount: distributionRows.rows.length,
    totalRefunded,
    limitOrderRelease,
    reason: cleanReason,
  };
}
