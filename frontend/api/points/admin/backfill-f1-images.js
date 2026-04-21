/**
 * POST /api/points/admin/backfill-f1-images          — apply
 * POST /api/points/admin/backfill-f1-images?dry=1    — preview
 *
 * Dedicated retrofit for Formula 1 driver portraits. The general
 * backfill-resolvers endpoint runs the F1 generator, which only
 * produces a spec for the NEXT race — so already-approved markets
 * from earlier rounds (different source_event_id) never match and
 * stay without images.
 *
 * Flow:
 *   1. Pick active F1 parent markets where outcome_images IS NULL.
 *      We identify F1 rows by resolver_config->>'source'='jolpica-f1'
 *      rather than relying on the `sport`/`league` columns, which
 *      might also be null on pre-retrofit rows.
 *   2. For each market, read cfg.legs (index-aligned with outcomes):
 *      each leg has { label, driverId }.
 *   3. Look up each driver's Wikipedia URL via Jolpica's /drivers/
 *      endpoint (driverId is the same key Jolpica uses for the page
 *      URL), then fetch the canonical portrait from the Wikipedia
 *      REST summary API.
 *   4. UPDATE outcome_images with the assembled array (null for
 *      drivers we can't resolve, null for the 'Otro' catchall).
 *
 * Idempotent — `outcome_images IS NULL` guard means a second run
 * skips anything the first run patched.
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { fetchWikipediaImage } from '../../_lib/wikipedia.js';

const sql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';

function parseJsonb(v, fb) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

/**
 * Fetch a single driver's profile from Jolpica. Returns the record
 * (including `url`) or null on miss. Jolpica's /drivers/{id} endpoint
 * is a thin passthrough to Ergast.
 */
async function fetchDriverProfile(driverId) {
  if (!driverId) return null;
  try {
    const res = await fetch(
      `${JOLPICA_BASE}/drivers/${encodeURIComponent(driverId)}.json`,
      { headers: { 'Accept': 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const drv = data?.MRData?.DriverTable?.Drivers?.[0];
    return drv || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(sql);

    // Candidates: active F1 parent markets without images. We cast
    // the config to text + LIKE instead of -> because neon's HTTP
    // driver doesn't always bind ->> cleanly without a typed column.
    const candidates = await readSql`
      SELECT id, question, outcomes, resolver_config
      FROM points_markets
      WHERE status = 'active'
        AND outcome_images IS NULL
        AND parent_id IS NULL
        AND resolver_type = 'sports_api'
        AND resolver_config::text LIKE '%"jolpica-f1"%'
      ORDER BY id ASC
      LIMIT 50
    `;

    if (candidates.length === 0) {
      return res.status(200).json({
        ok: true,
        dryRun,
        candidateCount: 0,
        updatedCount: 0,
        note: 'No F1 parent markets with NULL outcome_images.',
      });
    }

    const report = [];
    let updatedCount = 0;
    let imagesFound = 0;
    let imagesMissing = 0;

    for (const m of candidates) {
      const cfg = parseJsonb(m.resolver_config, null);
      const outcomes = parseJsonb(m.outcomes, []);
      const legs = Array.isArray(cfg?.legs) ? cfg.legs : [];
      if (legs.length === 0 || legs.length !== outcomes.length) {
        report.push({
          marketId: m.id,
          skipped: 'legs_outcomes_mismatch',
          legs: legs.length,
          outcomes: outcomes.length,
        });
        continue;
      }

      // For each leg, resolve an image URL. driverId === null means
      // the 'Otro' catchall — skip gracefully (null in outcome_images).
      const images = await Promise.all(legs.map(async (leg) => {
        if (!leg?.driverId) return null;
        const profile = await fetchDriverProfile(leg.driverId);
        const wikiUrl = profile?.url || null;
        if (!wikiUrl) return null;
        return fetchWikipediaImage(wikiUrl);
      }));

      const found = images.filter(Boolean).length;
      imagesFound += found;
      imagesMissing += images.length - found;

      if (dryRun) {
        report.push({
          marketId: m.id,
          question: m.question,
          imagesFound: found,
          imagesMissing: images.length - found,
          sample: images.slice(0, 3),
        });
        continue;
      }

      // Skip the write when we got zero images — saves us from
      // overwriting NULL with an all-null array, which would then
      // block future retrofits by the IS NULL guard.
      if (found === 0) {
        report.push({ marketId: m.id, skipped: 'no_images_resolved' });
        continue;
      }

      const result = await sql`
        UPDATE points_markets
        SET outcome_images = ${JSON.stringify(images)}::jsonb
        WHERE id = ${m.id}
          AND outcome_images IS NULL
        RETURNING id
      `;
      if (result.length > 0) {
        updatedCount += 1;
        report.push({
          marketId: m.id,
          question: m.question,
          imagesFound: found,
          imagesMissing: images.length - found,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      candidateCount: candidates.length,
      updatedCount,
      imagesFound,
      imagesMissing,
      report,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-f1-images] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'backfill_f1_images_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
