import { extractAtpMensSinglesField } from './market-gen/tennis.js';
import { extractGolfEventField } from './market-gen/golf.js';
import { initialReserves } from './amm-math.js';

const ATP_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';
const PGA_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

const MAX_FIELD_OUTCOMES = 12;
const MIN_CONFIRMED_TENNIS_FIELD = 8;
const MIN_CONFIRMED_GOLF_FIELD = 8;
const OTHER_LABEL = 'Otro';

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function normalizeFieldLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactDate(date) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

function addDays(date, days) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(d.getTime() + days * 86_400_000);
}

function dateRange(start, end) {
  const a = compactDate(start);
  const b = compactDate(end);
  return a && b ? `${a}-${b}` : null;
}

function repairSearchRanges(row, now = new Date()) {
  const starts = [
    row?.start_time,
    row?.pending_source_data?.startDateIso,
    row?.pending_source_data?.startDate,
    now,
  ].filter(Boolean);
  const ends = [
    row?.end_time,
    row?.pending_source_data?.endDateIso,
    row?.pending_source_data?.endDate,
    addDays(now, 120),
  ].filter(Boolean);

  const ranges = new Set();
  for (const start of starts) {
    for (const end of ends) {
      const startDate = addDays(start, -21);
      const endDate = addDays(end, 21);
      const range = startDate && endDate ? dateRange(startDate, endDate) : null;
      if (range) ranges.add(range);
    }
  }
  const fallback = dateRange(addDays(now, -30), addDays(now, 180));
  if (fallback) ranges.add(fallback);
  return Array.from(ranges);
}

function sourceFromMarket(row) {
  const cfg = parseJsonb(row?.resolver_config, null);
  return row?.source
    || row?.pending_source
    || row?.pending_source_data?.source
    || cfg?.source
    || null;
}

function eventIdFromMarket(row) {
  const cfg = parseJsonb(row?.resolver_config, null);
  const pendingSourceData = parseJsonb(row?.pending_source_data, {});
  const raw = cfg?.eventId
    || pendingSourceData?.eventId
    || row?.source_event_id
    || row?.pending_source_event_id
    || '';
  return String(raw).replace(/^(atp|pga):/i, '').trim();
}

function tennisHeadshot(id) {
  if (String(id || '').trim() === '9250') return null;
  return id ? `https://a.espncdn.com/i/headshots/tennis/players/full/${id}.png` : null;
}

function golfHeadshot(id) {
  return id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : null;
}

async function fetchEspnEventById({ baseUrl, eventId, ranges, fetchImpl = fetch, limit = 500 }) {
  if (!eventId) return null;
  for (const range of ranges) {
    const url = `${baseUrl}?dates=${range}&limit=${limit}`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`espn_field_repair: HTTP ${res.status}`);
    const data = await res.json();
    const events = Array.isArray(data?.events) ? data.events : [];
    const event = events.find(e => String(e.id) === String(eventId));
    if (event) return event;
  }
  return null;
}

function confirmedEntriesFromTennisEvent(event) {
  const fullField = extractAtpMensSinglesField(event);
  if (fullField.length < MIN_CONFIRMED_TENNIS_FIELD) {
    return {
      ok: false,
      reason: 'tennis_draw_not_confirmed',
      fieldSize: fullField.length,
    };
  }
  const field = fullField.slice(0, MAX_FIELD_OUTCOMES).map(player => ({
    id: player.id || null,
    name: player.name,
    seed: player.seed ?? null,
    rank: player.rank ?? null,
  }));
  return {
    ok: true,
    source: 'espn-atp-tournament',
    fieldSource: 'espn-mens-singles-draw',
    field,
    entries: [
      ...field.map(player => ({
        label: player.name,
        driverId: player.id || null,
        image: tennisHeadshot(player.id),
      })),
      { label: OTHER_LABEL, driverId: null, image: null },
    ],
    confirmedFieldSize: fullField.length,
  };
}

function confirmedEntriesFromGolfEvent(event) {
  const fullField = extractGolfEventField(event);
  if (fullField.length < MIN_CONFIRMED_GOLF_FIELD) {
    return {
      ok: false,
      reason: 'golf_field_not_confirmed',
      fieldSize: fullField.length,
    };
  }
  const field = fullField.slice(0, MAX_FIELD_OUTCOMES).map(player => ({
    id: player.id || null,
    name: player.name,
    type: player.type || 'athlete',
    rank: player.rank ?? null,
    order: player.order ?? null,
    logo: player.logo || null,
  }));
  return {
    ok: true,
    source: 'espn-pga',
    fieldSource: 'espn-scoreboard-competitors',
    field,
    entries: [
      ...field.map(player => ({
        label: player.name,
        driverId: player.id || null,
        image: player.logo || golfHeadshot(player.id),
      })),
      { label: OTHER_LABEL, driverId: null, image: null },
    ],
    confirmedFieldSize: fullField.length,
  };
}

export async function buildConfirmedTournamentField(row, { fetchImpl = fetch, now = new Date() } = {}) {
  const source = sourceFromMarket(row);
  const eventId = eventIdFromMarket(row);
  const ranges = repairSearchRanges(row, now);
  if (source === 'espn-atp-tournament') {
    const event = await fetchEspnEventById({ baseUrl: ATP_SCOREBOARD, eventId, ranges, fetchImpl });
    if (!event) return { ok: false, source, eventId, reason: 'event_not_found' };
    return {
      ...confirmedEntriesFromTennisEvent(event),
      source,
      eventId,
      tournamentName: event.name || row?.pending_source_data?.tournamentName || null,
      eventDate: event.date || null,
      eventEndDate: event.endDate || null,
    };
  }
  if (source === 'espn-pga') {
    const event = await fetchEspnEventById({ baseUrl: PGA_SCOREBOARD, eventId, ranges, fetchImpl, limit: 100 });
    if (!event) return { ok: false, source, eventId, reason: 'event_not_found' };
    return {
      ...confirmedEntriesFromGolfEvent(event),
      source,
      eventId,
      tournamentName: event.name || row?.pending_source_data?.tournamentName || null,
      eventDate: event.date || null,
      eventEndDate: event.endDate || null,
    };
  }
  return { ok: false, source, eventId, reason: 'unsupported_source' };
}

function childLabel(child) {
  return String(child?.leg_label || '').trim();
}

function isRepairableStatus(status) {
  return status === 'active' || status === 'pending';
}

function rowSeed(row, fallback = 1000) {
  const value = Number(row?.seed_liquidity);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function buildTournamentFieldRepairPlan({
  parent,
  children = [],
  confirmed,
  refundRows = [],
} = {}) {
  const entries = Array.isArray(confirmed?.entries) ? confirmed.entries : [];
  const wantedByLabel = new Map(entries.map(entry => [normalizeFieldLabel(entry.label), entry]));
  const activeChildren = children.filter(row => isRepairableStatus(row?.status));
  const allChildrenByLabel = new Map();
  for (const child of children) {
    const key = normalizeFieldLabel(childLabel(child));
    if (key && !allChildrenByLabel.has(key)) allChildrenByLabel.set(key, child);
  }

  const invalidChildren = activeChildren.filter((child) => {
    const key = normalizeFieldLabel(childLabel(child));
    return !wantedByLabel.has(key);
  });

  const activeByLabel = new Map();
  for (const child of activeChildren) {
    const key = normalizeFieldLabel(childLabel(child));
    if (key && !activeByLabel.has(key)) activeByLabel.set(key, child);
  }

  const addedEntries = [];
  const blockedEntries = [];
  const keptEntries = [];
  for (const entry of entries) {
    const key = normalizeFieldLabel(entry.label);
    const active = activeByLabel.get(key);
    if (active) {
      keptEntries.push({ ...entry, childId: active.id });
      continue;
    }
    const existing = allChildrenByLabel.get(key);
    if (existing) {
      blockedEntries.push({ ...entry, existingChildId: existing.id, existingStatus: existing.status });
      continue;
    }
    addedEntries.push(entry);
  }

  const refunds = Array.isArray(refundRows) ? refundRows.map(row => ({
    marketId: Number(row.market_id),
    username: row.username,
    amount: Number(row.amount || 0),
  })).filter(row => Number.isFinite(row.marketId) && row.username && row.amount > 0) : [];

  return {
    parentId: Number(parent?.id || 0),
    question: parent?.question || null,
    source: confirmed?.source || sourceFromMarket(parent),
    eventId: confirmed?.eventId || eventIdFromMarket(parent),
    invalidChildren,
    addedEntries,
    blockedEntries,
    keptEntries,
    refundRows: refunds,
    refundCount: refunds.length,
    totalRefunded: refunds.reduce((sum, row) => sum + row.amount, 0),
  };
}

function nextSourceDataPatch(confirmed, nowIso) {
  return {
    eventId: confirmed.eventId || null,
    tournamentName: confirmed.tournamentName || null,
    startDateIso: confirmed.eventDate || null,
    endDateIso: confirmed.eventEndDate || null,
    field: confirmed.field || [],
    confirmedFieldSize: confirmed.confirmedFieldSize || 0,
    fieldSource: confirmed.fieldSource || null,
    fieldUpdatedAt: nowIso,
    rankingFallbackDisabled: true,
    fieldRepair: {
      repairedAt: nowIso,
      reason: 'confirmed_field_repair',
    },
  };
}

function nextResolverConfig(parent, activeValidChildren, confirmed, nowIso) {
  const cfg = parseJsonb(parent?.resolver_config, {});
  const entryByLabel = new Map((confirmed.entries || []).map(entry => [
    normalizeFieldLabel(entry.label),
    entry,
  ]));
  const legs = activeValidChildren.map((child) => {
    const entry = entryByLabel.get(normalizeFieldLabel(childLabel(child))) || {};
    return {
      label: childLabel(child),
      driverId: entry.driverId || null,
    };
  });
  return {
    ...cfg,
    source: confirmed.source || cfg.source,
    shape: 'parallel',
    eventId: confirmed.eventId || cfg.eventId,
    legs,
    fieldRepairedAt: nowIso,
    fieldSource: confirmed.fieldSource || cfg.fieldSource || null,
  };
}

async function queryRefundRows(client, invalidMarketIds, { lock = false } = {}) {
  if (!invalidMarketIds.length) return [];
  if (lock) {
    await client.query(
      `SELECT market_id, username, outcome_index, shares, cost_basis
         FROM points_positions
        WHERE market_id = ANY($1::int[])
          AND shares > 0
        FOR UPDATE`,
      [invalidMarketIds],
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
    [invalidMarketIds],
  );
  return result.rows;
}

export async function repairTournamentFieldMarket(client, market, confirmed, {
  dryRun = true,
  adminUsername = 'field-repair',
  now = new Date(),
} = {}) {
  if (!confirmed?.ok) {
    if (!dryRun && market?.id) {
      const parentResult = await client.query(
        `SELECT id, status, amm_mode, parent_id, resolver_config
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [market.id],
      );
      const parent = parentResult.rows[0] || null;
      if (
        parent
        && parent.amm_mode === 'parallel'
        && !parent.parent_id
        && parent.status === 'active'
      ) {
        const nowIso = new Date(now).toISOString();
        const cfg = {
          ...parseJsonb(parent.resolver_config, {}),
          fieldRepairPendingAt: nowIso,
          fieldRepairPendingReason: confirmed?.reason || 'no_confirmed_field',
        };
        await client.query(
          `UPDATE points_markets
              SET status = 'pending',
                  resolver_config = $2::jsonb
            WHERE (id = $1 OR parent_id = $1)
              AND status = 'active'`,
          [parent.id, JSON.stringify(cfg)],
        );
        return {
          ok: false,
          dryRun,
          marketId: Number(parent.id),
          skipped: true,
          held: true,
          reason: confirmed?.reason || 'no_confirmed_field',
          fieldSize: confirmed?.fieldSize ?? null,
          source: confirmed?.source || sourceFromMarket(market),
          eventId: confirmed?.eventId || eventIdFromMarket(market),
        };
      }
    }
    return {
      ok: false,
      dryRun,
      marketId: Number(market?.id || 0),
      skipped: true,
      reason: confirmed?.reason || 'no_confirmed_field',
      fieldSize: confirmed?.fieldSize ?? null,
      source: confirmed?.source || sourceFromMarket(market),
      eventId: confirmed?.eventId || eventIdFromMarket(market),
    };
  }

  const parentResult = await client.query(
    `SELECT m.*, pm.source AS pending_source, pm.source_event_id AS pending_source_event_id,
            pm.source_data AS pending_source_data
       FROM points_markets m
       LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.id = $1
      ${dryRun ? '' : 'FOR UPDATE OF m'}`,
    [market.id],
  );
  const parent = parentResult.rows[0] || null;
  if (!parent) {
    return { ok: false, dryRun, marketId: Number(market?.id || 0), skipped: true, reason: 'market_not_found' };
  }
  if (!isRepairableStatus(parent.status) || parent.amm_mode !== 'parallel' || parent.parent_id) {
    return {
      ok: false,
      dryRun,
      marketId: Number(parent.id),
      skipped: true,
      reason: 'not_active_parallel_parent',
      status: parent.status,
    };
  }
  if ((parent.mode || 'points') !== 'points') {
    return {
      ok: false,
      dryRun,
      marketId: Number(parent.id),
      skipped: true,
      reason: 'not_points_mode',
      mode: parent.mode || null,
    };
  }

  const childrenResult = await client.query(
    `SELECT id, parent_id, leg_label, question, status, seed_liquidity
       FROM points_markets
      WHERE parent_id = $1
      ORDER BY id ASC
      ${dryRun ? '' : 'FOR UPDATE'}`,
    [parent.id],
  );
  let children = childrenResult.rows;
  const initialPlan = buildTournamentFieldRepairPlan({ parent, children, confirmed });
  const invalidMarketIds = initialPlan.invalidChildren.map(row => Number(row.id)).filter(Number.isInteger);
  const refundRows = await queryRefundRows(client, invalidMarketIds, { lock: !dryRun });
  const plan = buildTournamentFieldRepairPlan({ parent, children, confirmed, refundRows });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      marketId: Number(parent.id),
      question: parent.question,
      source: confirmed.source,
      eventId: confirmed.eventId,
      fieldSource: confirmed.fieldSource,
      confirmedFieldSize: confirmed.confirmedFieldSize,
      kept: plan.keptEntries.map(e => e.label),
      added: plan.addedEntries.map(e => e.label),
      invalid: plan.invalidChildren.map(child => childLabel(child)),
      blocked: plan.blockedEntries.map(e => e.label),
      refundCount: plan.refundCount,
      totalRefunded: plan.totalRefunded,
      refunds: plan.refundRows,
    };
  }

  const nowIso = new Date(now).toISOString();
  const defaultSeed = rowSeed(parent, 1000);
  for (const entry of plan.addedEntries) {
    const legSeed = defaultSeed;
    const inserted = await client.query(
      `INSERT INTO points_markets
         (question, category, icon, outcomes, reserves, seed_liquidity, seed_liquidities,
          start_time, end_time, status, created_by, amm_mode,
          parent_id, leg_label, sport, league, mode,
          category_tags, geo_tags, topic_tags)
       VALUES ($1, $2, NULL, $3::jsonb, $4::jsonb, $5, $6::jsonb,
               $7, $8, 'active', $9, 'parallel',
               $10, $11, $12, $13, 'points',
               $14::jsonb, $15::jsonb, $16::jsonb)
       RETURNING id`,
      [
        `${parent.question} - ${entry.label}`,
        parent.category,
        JSON.stringify(['Sí', 'No']),
        JSON.stringify(initialReserves(legSeed, 2)),
        legSeed,
        JSON.stringify([legSeed, legSeed]),
        parent.start_time,
        parent.end_time,
        adminUsername,
        parent.id,
        entry.label,
        parent.sport || null,
        parent.league || null,
        JSON.stringify(parseJsonb(parent.category_tags, [])),
        JSON.stringify(parseJsonb(parent.geo_tags, [])),
        JSON.stringify(parseJsonb(parent.topic_tags, [])),
      ],
    );
    entry.insertedChildId = inserted.rows[0]?.id || null;
  }

  if (invalidMarketIds.length > 0) {
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
      [invalidMarketIds],
    );

    await client.query(
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
         FROM refunds`,
      [invalidMarketIds, 'Reembolso: participante fuera del draw/campo confirmado'],
    );

    await client.query(
      `UPDATE points_positions
          SET shares = 0,
              cost_basis = 0,
              updated_at = NOW(),
              dismissed_at = NOW()
        WHERE market_id = ANY($1::int[])
          AND shares > 0`,
      [invalidMarketIds],
    );

    await client.query(
      `UPDATE points_markets
          SET status = 'canceled',
              outcome = NULL,
              resolved_at = NOW(),
              resolved_by = $2,
              final_score = $3
        WHERE id = ANY($1::int[])
          AND status = 'active'`,
      [invalidMarketIds, adminUsername, 'Participante fuera del draw/campo confirmado'],
    );
  }

  const refreshedChildren = await client.query(
    `SELECT id, parent_id, leg_label, status, seed_liquidity
       FROM points_markets
      WHERE parent_id = $1
      ORDER BY id ASC
      FOR UPDATE`,
    [parent.id],
  );
  children = refreshedChildren.rows;
  const wantedLabels = new Set((confirmed.entries || []).map(entry => normalizeFieldLabel(entry.label)));
  const activeValidChildren = children
    .filter(child => isRepairableStatus(child.status) && wantedLabels.has(normalizeFieldLabel(childLabel(child))));

  if (activeValidChildren.length < 2) {
    await client.query(
      `UPDATE points_markets
          SET status = 'canceled',
              outcome = NULL,
              resolved_at = NOW(),
              resolved_by = $2,
              final_score = $3
        WHERE (id = $1 OR parent_id = $1)
          AND status = 'active'`,
      [parent.id, adminUsername, 'Campo confirmado insuficiente'],
    );
    return {
      ok: true,
      dryRun: false,
      marketId: Number(parent.id),
      canceledParent: true,
      reason: 'insufficient_active_confirmed_children',
      invalid: plan.invalidChildren.map(child => childLabel(child)),
      refundCount: plan.refundCount,
      totalRefunded: plan.totalRefunded,
    };
  }

  const entryByLabel = new Map((confirmed.entries || []).map(entry => [
    normalizeFieldLabel(entry.label),
    entry,
  ]));
  const outcomes = activeValidChildren.map(child => childLabel(child));
  const outcomeImages = activeValidChildren.map(child => (
    entryByLabel.get(normalizeFieldLabel(childLabel(child)))?.image || null
  ));
  const seedLiquidities = activeValidChildren.map(child => rowSeed(child, defaultSeed));
  const resolverConfig = nextResolverConfig(parent, activeValidChildren, confirmed, nowIso);
  const sourceDataPatch = nextSourceDataPatch(confirmed, nowIso);

  await client.query(
    `UPDATE points_markets
        SET outcomes = $1::jsonb,
            outcome_images = $2::jsonb,
            seed_liquidities = $3::jsonb,
            resolver_config = $4::jsonb
      WHERE id = $5`,
    [
      JSON.stringify(outcomes),
      JSON.stringify(outcomeImages),
      JSON.stringify(seedLiquidities),
      JSON.stringify(resolverConfig),
      parent.id,
    ],
  );

  const activeValidIds = activeValidChildren.map(child => Number(child.id)).filter(Number.isInteger);
  await client.query(
    `UPDATE points_markets
        SET status = 'active'
      WHERE (id = $1 OR id = ANY($2::int[]))
        AND status = 'pending'`,
    [parent.id, activeValidIds],
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
      JSON.stringify(outcomes),
      JSON.stringify(outcomeImages),
      JSON.stringify(seedLiquidities),
      JSON.stringify(resolverConfig),
      JSON.stringify(sourceDataPatch),
      parent.id,
    ],
  );

  return {
    ok: true,
    dryRun: false,
    marketId: Number(parent.id),
    question: parent.question,
    source: confirmed.source,
    eventId: confirmed.eventId,
    fieldSource: confirmed.fieldSource,
    confirmedFieldSize: confirmed.confirmedFieldSize,
    outcomes,
    added: plan.addedEntries.map(e => e.label),
    invalid: plan.invalidChildren.map(child => childLabel(child)),
    blocked: plan.blockedEntries.map(e => e.label),
    refundCount: plan.refundCount,
    totalRefunded: plan.totalRefunded,
  };
}

export async function listTournamentFieldRepairCandidates(client, { marketIds = [] } = {}) {
  const params = [];
  let idFilter = '';
  if (Array.isArray(marketIds) && marketIds.length > 0) {
    params.push(marketIds.map(Number).filter(Number.isInteger));
    idFilter = `AND m.id = ANY($${params.length}::int[])`;
  }
  const result = await client.query(
    `SELECT m.*, pm.source AS pending_source, pm.source_event_id AS pending_source_event_id,
            pm.source_data AS pending_source_data
       FROM points_markets m
       LEFT JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.parent_id IS NULL
        AND m.amm_mode = 'parallel'
        AND m.status IN ('active', 'pending')
        AND COALESCE(m.mode, 'points') = 'points'
        AND (
          m.source IN ('espn-atp-tournament', 'espn-pga')
          OR pm.source IN ('espn-atp-tournament', 'espn-pga')
          OR m.resolver_config->>'source' IN ('espn-atp-tournament', 'espn-pga')
        )
        ${idFilter}
      ORDER BY m.start_time ASC NULLS LAST, m.id ASC`,
    params,
  );
  return result.rows;
}
