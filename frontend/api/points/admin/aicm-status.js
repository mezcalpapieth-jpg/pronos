/**
 * GET /api/points/admin/aicm-status
 *
 * Admin-only readout for the AICM delay oracle rehearsal. This endpoint is
 * intentionally read-only: it reports collector health and stored evidence,
 * but does not resolve markets or move balances.
 */
import { neon } from '@neondatabase/serverless';

import { applyCors } from '../../_lib/cors.js';
import { cachedJson, setCacheHeaders } from '../../_lib/api-performance.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';

let readSql;
let schemaSql;

function getReadSql() {
  if (!readSql) readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
  return readSql;
}

function getSchemaSql() {
  if (!schemaSql) schemaSql = neon(process.env.DATABASE_URL);
  return schemaSql;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatRun(row) {
  return {
    id: toNumber(row.id),
    source: row.source,
    direction: row.direction,
    status: row.status,
    observedAt: row.observedAt || null,
    flightDate: row.flightDate || null,
    sourceUrl: row.sourceUrl || null,
    httpStatus: row.httpStatus == null ? null : toNumber(row.httpStatus),
    rawHtmlSha256: row.rawHtmlSha256 || null,
    rawHtmlBytes: toNumber(row.rawHtmlBytes),
    rowCount: toNumber(row.rowCount),
    delayedCount: toNumber(row.delayedCount),
    cancelledCount: toNumber(row.cancelledCount),
    rowsCapped: row.rowsCapped === true,
    error: row.error || null,
    createdAt: row.createdAt || null,
  };
}

function formatSummary(row) {
  return {
    window: row.windowLabel,
    direction: row.direction || 'all',
    polls: toNumber(row.polls),
    okPolls: toNumber(row.okPolls),
    maintenancePolls: toNumber(row.maintenancePolls),
    errorPolls: toNumber(row.errorPolls),
    emptyPolls: toNumber(row.emptyPolls),
    noTablePolls: toNumber(row.noTablePolls),
    avgRows: toNumber(row.avgRows),
    delayedRowsSeen: toNumber(row.delayedRowsSeen),
    cancelledRowsSeen: toNumber(row.cancelledRowsSeen),
    lastObservedAt: row.lastObservedAt || null,
  };
}

function formatDaily(row) {
  return {
    flightDate: String(row.flightDate || '').slice(0, 10),
    direction: row.direction,
    delayedFlights: toNumber(row.delayedFlights),
    cancelledFlights: toNumber(row.cancelledFlights),
    flightsWithAnyStatus: toNumber(row.flightsWithAnyStatus),
  };
}

function formatObservation(row) {
  return {
    id: toNumber(row.id),
    direction: row.direction,
    flightDate: String(row.flightDate || '').slice(0, 10),
    flightCode: row.flightCode || null,
    airline: row.airline || null,
    city: row.city || null,
    scheduledTimeLocal: row.scheduledTimeLocal || null,
    estimatedTimeLocal: row.estimatedTimeLocal || null,
    terminal: row.terminal || null,
    gate: row.gate || null,
    statusRaw: row.statusRaw,
    statusNorm: row.statusNorm,
    sourceUrl: row.sourceUrl || null,
    observedAt: row.observedAt || null,
    createdAt: row.createdAt || null,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(getSchemaSql());
    setCacheHeaders(res, { scope: 'private', maxAge: 15, staleWhileRevalidate: 45 });

    const { value: payload, hit } = await cachedJson('points:admin:aicm-status:v1', 15_000, async () => {
      const sql = getReadSql();
      const [
        latestRuns,
        summaryRows,
        dailyRows,
        recentObservations,
      ] = await Promise.all([
        sql`
          SELECT
            id,
            source,
            direction,
            status,
            observed_at AS "observedAt",
            flight_date::text AS "flightDate",
            source_url AS "sourceUrl",
            http_status AS "httpStatus",
            raw_html_sha256 AS "rawHtmlSha256",
            raw_html_bytes AS "rawHtmlBytes",
            row_count AS "rowCount",
            delayed_count AS "delayedCount",
            cancelled_count AS "cancelledCount",
            rows_capped AS "rowsCapped",
            error,
            created_at AS "createdAt"
          FROM points_aicm_poll_runs
          ORDER BY observed_at DESC, id DESC
          LIMIT 20
        `,
        sql`
          WITH windows AS (
            SELECT '24h'::text AS window_label, NOW() - INTERVAL '24 hours' AS since
            UNION ALL
            SELECT '7d'::text AS window_label, NOW() - INTERVAL '7 days' AS since
          )
          SELECT
            w.window_label AS "windowLabel",
            p.direction,
            COUNT(*)::int AS polls,
            COUNT(*) FILTER (WHERE p.status = 'ok')::int AS "okPolls",
            COUNT(*) FILTER (WHERE p.status = 'maintenance')::int AS "maintenancePolls",
            COUNT(*) FILTER (WHERE p.status IN ('http_error', 'fetch_error'))::int AS "errorPolls",
            COUNT(*) FILTER (WHERE p.status = 'empty')::int AS "emptyPolls",
            COUNT(*) FILTER (WHERE p.status = 'no_table')::int AS "noTablePolls",
            COALESCE(AVG(p.row_count), 0)::float AS "avgRows",
            COALESCE(SUM(p.delayed_count), 0)::int AS "delayedRowsSeen",
            COALESCE(SUM(p.cancelled_count), 0)::int AS "cancelledRowsSeen",
            MAX(p.observed_at) AS "lastObservedAt"
          FROM windows w
          LEFT JOIN points_aicm_poll_runs p
            ON p.observed_at >= w.since
          GROUP BY w.window_label, p.direction
          ORDER BY w.window_label, p.direction
        `,
        sql`
          SELECT
            flight_date::text AS "flightDate",
            direction,
            COUNT(DISTINCT flight_key) FILTER (WHERE status_norm = 'delayed')::int AS "delayedFlights",
            COUNT(DISTINCT flight_key) FILTER (WHERE status_norm = 'cancelled')::int AS "cancelledFlights",
            COUNT(DISTINCT flight_key)::int AS "flightsWithAnyStatus"
          FROM points_aicm_flight_observations
          WHERE flight_date >= CURRENT_DATE - INTERVAL '14 days'
          GROUP BY flight_date, direction
          ORDER BY flight_date DESC, direction ASC
        `,
        sql`
          SELECT
            id,
            direction,
            flight_date::text AS "flightDate",
            flight_code AS "flightCode",
            airline,
            city,
            scheduled_time_local AS "scheduledTimeLocal",
            estimated_time_local AS "estimatedTimeLocal",
            terminal,
            gate,
            status_raw AS "statusRaw",
            status_norm AS "statusNorm",
            source_url AS "sourceUrl",
            observed_at AS "observedAt",
            created_at AS "createdAt"
          FROM points_aicm_flight_observations
          WHERE status_norm IN ('delayed', 'cancelled')
          ORDER BY observed_at DESC, id DESC
          LIMIT 30
        `,
      ]);

      return {
        ok: true,
        latestRuns: latestRuns.map(formatRun),
        summary: summaryRows.map(formatSummary),
        daily: dailyRows.map(formatDaily),
        recentDisruptions: recentObservations.map(formatObservation),
        generatedAt: new Date().toISOString(),
      };
    });

    return res.status(200).json({
      ...payload,
      cache: hit ? 'hit' : 'miss',
    });
  } catch (e) {
    console.error('[admin/aicm-status] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'aicm_status_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
