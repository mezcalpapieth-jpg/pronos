/**
 * POST /api/points/admin/append-parallel-outcomes
 * Body: {
 *   marketId,
 *   outcomes: string[],             // labels to append as new binary legs
 *   seedLiquidity?: number,         // fallback seed per new leg
 *   seedLiquidities?: number[],     // optional index-aligned seed per label
 *   outcomeImages?: string[],       // optional index-aligned logo/headshot URL
 *   resolverLegs?: [{ driverId? }]  // optional index-aligned ESPN ids
 * }
 *
 * Appends new options to an existing parallel market without renumbering
 * current child legs. If an incoming label/ESPN id matches an existing child,
 * it updates that child label/image/resolver metadata instead. This is safe
 * for in-flight tennis/golf tournament markets where late source confirmation
 * reveals a missing player or a manually-entered label needs cleanup.
 */
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { initialReserves } from '../../_lib/amm-math.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { neon } from '@neondatabase/serverless';

const schemaSql = neon(process.env.DATABASE_URL);
const MAX_APPEND_OUTCOMES = 24;
const MIN_LEG_SEED = 100;

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeLabelKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactLabelKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function labelAliasKeys(value) {
  const key = normalizeLabelKey(value);
  const tokens = key.split(' ').filter(Boolean);
  const aliases = new Set([key, compactLabelKey(value)].filter(Boolean));
  if (tokens.length >= 2) {
    aliases.add([...tokens.slice(1), tokens[0]].join(' '));
    aliases.add(`${tokens.slice(1).join('')}${tokens[0]}`);
    aliases.add(`${tokens[tokens.length - 1]}${tokens.slice(0, -1).join('')}`);
  }
  return aliases;
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed.slice(0, 1000) : { error: 'invalid_outcome_image_url' };
}

function inferredHeadshot(parent, entry) {
  const cfg = parseJsonb(parent?.resolver_config, {});
  const isGolf = parent?.sport === 'golf'
    || parent?.league === 'pga'
    || cfg?.source === 'espn-pga'
    || String(parent?.source || '').includes('espn-pga');
  if (!isGolf || !entry?.driverId) return null;
  return `https://a.espncdn.com/i/headshots/golf/players/full/${entry.driverId}.png`;
}

function normalizeEntries({ outcomes, seedLiquidity, seedLiquidities, outcomeImages, resolverLegs }) {
  if (!Array.isArray(outcomes) || outcomes.length === 0 || outcomes.length > MAX_APPEND_OUTCOMES) {
    return { error: 'invalid_outcomes' };
  }
  const seen = new Set();
  const entries = [];
  for (let i = 0; i < outcomes.length; i++) {
    const label = String(outcomes[i] || '').trim();
    if (!label) continue;
    const key = normalizeLabelKey(label);
    if (!key) continue;
    if (seen.has(key)) return { error: 'duplicate_outcomes' };
    seen.add(key);

    const seedRaw = Array.isArray(seedLiquidities) && seedLiquidities[i] != null
      ? seedLiquidities[i]
      : seedLiquidity;
    const hasSeed = seedRaw !== undefined && seedRaw !== null && seedRaw !== '';
    const seed = Number(seedRaw);
    if (hasSeed && (!Number.isFinite(seed) || seed < MIN_LEG_SEED)) {
      return { error: 'invalid_seed_liquidity' };
    }
    const image = Array.isArray(outcomeImages) ? cleanUrl(outcomeImages[i]) : null;
    if (image?.error) return image;
    entries.push({
      label,
      key,
      seed: hasSeed ? seed : null,
      image: image || null,
      driverId: Array.isArray(resolverLegs)
        ? String(resolverLegs[i]?.driverId || '').trim() || null
        : null,
    });
  }
  if (entries.length === 0) return { error: 'invalid_outcomes' };
  return { entries };
}

function rowSeed(row, fallback = 1000) {
  const value = Number(row?.seed_liquidity);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function alignParentArray(value, labels, fallback) {
  const arr = parseJsonb(value, null);
  if (Array.isArray(arr) && arr.length === labels.length) return arr;
  return labels.map(() => fallback);
}

function existingLegByChild(parent, childRows) {
  const cfg = parseJsonb(parent.resolver_config, {});
  const existing = Array.isArray(cfg.legs) ? cfg.legs : [];
  const existingByLabel = new Map(existing.map(leg => [normalizeLabelKey(leg?.label), leg]));
  return new Map(childRows.map(child => {
    const originalLabel = String(child.original_leg_label || child.leg_label || '').trim();
    return [Number(child.id), existingByLabel.get(normalizeLabelKey(originalLabel)) || {}];
  }));
}

function findExistingChild(entry, childRows, oldLegsByChild) {
  if (entry.driverId) {
    const byDriver = childRows.find(child => (
      String(oldLegsByChild.get(Number(child.id))?.driverId || '').trim() === entry.driverId
    ));
    if (byDriver) return byDriver;
  }
  const incomingAliases = labelAliasKeys(entry.label);
  return childRows.find(child => {
    for (const alias of labelAliasKeys(child.leg_label)) {
      if (incomingAliases.has(alias)) return true;
    }
    return false;
  }) || null;
}

function alignResolverLegs(parent, childRows, metadataByChildId, insertedEntries, nowIso, adminUsername) {
  const cfg = parseJsonb(parent.resolver_config, {});
  if (cfg?.shape !== 'parallel') return cfg;
  const oldLegsByChild = existingLegByChild(parent, childRows);
  return {
    ...cfg,
    legs: [
      ...childRows.map(child => {
        const label = String(child.leg_label || '').trim();
        const oldLeg = oldLegsByChild.get(Number(child.id)) || {};
        const metadata = metadataByChildId.get(Number(child.id)) || null;
        return {
          ...oldLeg,
          label,
          driverId: metadata?.driverId || oldLeg.driverId || null,
          ...(metadata ? { manuallyUpdatedAt: nowIso, updatedBy: adminUsername } : {}),
        };
      }),
      ...insertedEntries.map(entry => ({
        label: entry.label,
        driverId: entry.driverId,
        manuallyAddedAt: nowIso,
        addedBy: adminUsername,
      })),
    ],
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const mid = Number.parseInt(req.body?.marketId, 10);
  if (!Number.isInteger(mid) || mid <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }

  const normalized = normalizeEntries(req.body || {});
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  try {
    await ensurePointsSchema(schemaSql);
    const result = await withTransaction(async (client) => {
      const parentResult = await client.query(
        `SELECT *
           FROM points_markets
          WHERE id = $1
          FOR UPDATE`,
        [mid],
      );
      const parent = parentResult.rows[0] || null;
      if (!parent) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      if (parent.parent_id || parent.amm_mode !== 'parallel') {
        const err = new Error('not_parallel_parent'); err.status = 400; throw err;
      }
      if (!['active', 'pending'].includes(parent.status)) {
        const err = new Error('market_not_editable'); err.status = 400; throw err;
      }
      if ((parent.mode || 'points') !== 'points') {
        const err = new Error('not_points_mode'); err.status = 400; throw err;
      }

      const childrenResult = await client.query(
        `SELECT id, leg_label, leg_label AS original_leg_label, seed_liquidity, status
           FROM points_markets
          WHERE parent_id = $1
            AND status <> 'canceled'
          ORDER BY id ASC
          FOR UPDATE`,
        [parent.id],
      );
      const childRows = childrenResult.rows;
      const currentLabels = childRows.map(row => String(row.leg_label || '').trim()).filter(Boolean);
      const oldLegsByChild = existingLegByChild(parent, childRows);
      const existingKeys = new Set(currentLabels.map(label => Array.from(labelAliasKeys(label))).flat());
      const updateTargets = new Map();
      const appendEntries = [];
      for (const entry of normalized.entries) {
        entry.image = entry.image || inferredHeadshot(parent, entry);
        const existingChild = findExistingChild(entry, childRows, oldLegsByChild);
        if (existingChild) {
          const childId = Number(existingChild.id);
          if (updateTargets.has(childId)) {
            const err = new Error('duplicate_outcomes'); err.status = 400; err.detail = entry.label; throw err;
          }
          updateTargets.set(childId, entry);
          continue;
        }
        for (const alias of labelAliasKeys(entry.label)) {
          if (existingKeys.has(alias)) {
            const err = new Error('duplicate_outcomes'); err.status = 400; err.detail = entry.label; throw err;
          }
        }
        if (appendEntries.some(prev => {
          const prevAliases = labelAliasKeys(prev.label);
          for (const alias of labelAliasKeys(entry.label)) {
            if (prevAliases.has(alias)) return true;
          }
          return false;
        })) {
          const err = new Error('duplicate_outcomes'); err.status = 400; err.detail = entry.label; throw err;
        }
        appendEntries.push(entry);
      }

      const parentSeed = rowSeed(parent, 1000);
      const inserted = [];
      const nowIso = new Date().toISOString();
      const updated = [];
      for (const [childId, entry] of updateTargets.entries()) {
        await client.query(
          `UPDATE points_markets
              SET leg_label = $1,
                  question = $2
            WHERE id = $3`,
          [entry.label, `${parent.question} - ${entry.label}`, childId],
        );
        updated.push({
          id: childId,
          label: entry.label,
          driverId: entry.driverId,
          image: entry.image,
        });
      }

      for (const entry of appendEntries) {
        const legSeed = entry.seed || parentSeed;
        const child = await client.query(
          `INSERT INTO points_markets
             (question, category, icon, outcomes, reserves, seed_liquidity, seed_liquidities,
              start_time, end_time, status, created_by, amm_mode,
              parent_id, leg_label, sport, league, mode,
              category_tags, geo_tags, topic_tags)
           VALUES ($1, $2, NULL, $3::jsonb, $4::jsonb, $5, $6::jsonb,
                   $7, $8, $9, $10, 'parallel',
                   $11, $12, $13, $14, 'points',
                   $15::jsonb, $16::jsonb, $17::jsonb)
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
            parent.status,
            admin.username,
            parent.id,
            entry.label,
            parent.sport || null,
            parent.league || null,
            JSON.stringify(parseJsonb(parent.category_tags, [])),
            JSON.stringify(parseJsonb(parent.geo_tags, [])),
            JSON.stringify(parseJsonb(parent.topic_tags, [])),
          ],
        );
        inserted.push({
          id: Number(child.rows[0]?.id),
          label: entry.label,
          seedLiquidity: legSeed,
          driverId: entry.driverId,
          image: entry.image,
        });
      }

      const metadataByChildId = new Map(updated.map(row => [row.id, row]));
      const updatedChildRows = childRows.map(child => {
        const metadata = metadataByChildId.get(Number(child.id));
        return metadata ? { ...child, leg_label: metadata.label } : child;
      });
      const nextLabels = [...updatedChildRows.map(row => String(row.leg_label || '').trim()).filter(Boolean), ...appendEntries.map(entry => entry.label)];
      const currentImages = alignParentArray(parent.outcome_images, currentLabels, null);
      const imageByChildId = new Map(childRows.map((child, index) => [Number(child.id), currentImages[index] ?? null]));
      for (const row of updated) {
        if (row.image) imageByChildId.set(row.id, row.image);
      }
      const currentSeeds = childRows.map(row => rowSeed(row, parentSeed));
      const nextImages = [
        ...updatedChildRows.map(child => imageByChildId.get(Number(child.id)) ?? null),
        ...appendEntries.map(entry => entry.image),
      ];
      const nextSeeds = [...currentSeeds, ...inserted.map(row => row.seedLiquidity)];
      const nextResolverConfig = alignResolverLegs(parent, updatedChildRows, metadataByChildId, appendEntries, nowIso, admin.username);

      await client.query(
        `UPDATE points_markets
            SET outcomes = $1::jsonb,
                outcome_images = $2::jsonb,
                seed_liquidities = $3::jsonb,
                resolver_config = $4::jsonb
          WHERE id = $5`,
        [
          JSON.stringify(nextLabels),
          JSON.stringify(nextImages),
          JSON.stringify(nextSeeds),
          JSON.stringify(nextResolverConfig),
          parent.id,
        ],
      );

      await client.query(
        `UPDATE points_pending_markets
            SET outcomes = $1::jsonb,
                outcome_images = $2::jsonb,
                seed_liquidities = $3::jsonb,
                resolver_config = $4::jsonb,
                source_data = COALESCE(source_data, '{}'::jsonb)
              || $5::jsonb
          WHERE approved_market_id = $6`,
        [
          JSON.stringify(nextLabels),
          JSON.stringify(nextImages),
          JSON.stringify(nextSeeds),
          JSON.stringify(nextResolverConfig),
          JSON.stringify({
            parallelAppend: {
              appendedAt: nowIso,
              addedBy: admin.username,
              labels: inserted.map(row => row.label),
            },
            parallelOutcomeUpdates: {
              updatedAt: nowIso,
              updatedBy: admin.username,
              labels: updated.map(row => row.label),
            },
          }),
          parent.id,
        ],
      );

      return {
        marketId: Number(parent.id),
        appended: inserted,
        updated,
        outcomes: nextLabels,
      };
    });

    return res.status(200).json({
      ok: true,
      ...result,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/append-parallel-outcomes] error', { message: e?.message, code: e?.code });
    return res.status(e?.status || 500).json({
      error: e?.message || 'append_parallel_outcomes_failed',
      detail: e?.detail || null,
    });
  }
}
