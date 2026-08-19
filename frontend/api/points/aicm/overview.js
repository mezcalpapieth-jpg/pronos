/**
 * GET /api/points/aicm/overview
 *
 * Public, read-only AICM hub payload. It reads the stored oracle ledger
 * written by /api/cron/aicm-poll and never creates, updates, or resolves
 * markets.
 */
import { neon } from '@neondatabase/serverless';

import { applyCors } from '../../_lib/cors.js';
import { cachedJson, setCacheHeaders } from '../../_lib/api-performance.js';
import { AICM_DEFAULT_FLIGHTS_URL, AICM_SOURCE } from '../../_lib/aicm-board.js';

const AICM_TIMEZONE = 'America/Mexico_City';

let readSql;

function getReadSql() {
  if (!readSql) {
    const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL not configured');
    readSql = neon(cs);
  }
  return readSql;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isMissingAicmTable(err) {
  return err?.code === '42P01' || /points_aicm_/i.test(String(err?.message || ''));
}

function emptyOverview(reason = 'no_oracle_data') {
  return {
    ok: true,
    reason,
    airport: {
      key: 'aicm',
      code: 'MEX',
      icao: 'MMMX',
      label: 'AICM',
      name: 'Aeropuerto Internacional de la Ciudad de México',
      city: 'Ciudad de México',
      timezone: AICM_TIMEZONE,
    },
    source: {
      key: AICM_SOURCE,
      url: AICM_DEFAULT_FLIGHTS_URL,
      lastObservedAt: null,
      status: 'empty',
    },
    counters: {
      hour: { key: 'hour', label: '1h', delayedFlights: 0, cancelledFlights: 0, observedFlights: 0, lastObservedAt: null },
      day: { key: 'day', label: 'Hoy', delayedFlights: 0, cancelledFlights: 0, observedFlights: 0, lastObservedAt: null },
      week: { key: 'week', label: '7d', delayedFlights: 0, cancelledFlights: 0, observedFlights: 0, lastObservedAt: null },
    },
    daily: [],
    timetable: [],
    latestRuns: [],
    generatedAt: new Date().toISOString(),
  };
}

function formatRun(row) {
  return {
    id: toNumber(row.id),
    status: row.status || 'unknown',
    observedAt: row.observedAt || null,
    flightDate: row.flightDate || null,
    rowCount: toNumber(row.rowCount),
    delayedCount: toNumber(row.delayedCount),
    cancelledCount: toNumber(row.cancelledCount),
    error: row.error || null,
  };
}

function formatCounter(row) {
  return {
    key: row.windowKey,
    label: row.label,
    delayedFlights: toNumber(row.delayedFlights),
    cancelledFlights: toNumber(row.cancelledFlights),
    observedFlights: toNumber(row.observedFlights),
    lastObservedAt: row.lastObservedAt || null,
  };
}

function formatDaily(row) {
  return {
    flightDate: row.flightDate,
    delayedFlights: toNumber(row.delayedFlights),
    cancelledFlights: toNumber(row.cancelledFlights),
    observedFlights: toNumber(row.observedFlights),
  };
}

function formatFlight(row) {
  return {
    flightKey: row.flightKey,
    flightDate: row.flightDate,
    flightCode: row.flightCode || null,
    airline: row.airline || null,
    city: row.city || null,
    scheduledTimeLocal: row.scheduledTimeLocal || null,
    estimatedTimeLocal: row.estimatedTimeLocal || null,
    terminal: row.terminal || null,
    gate: row.gate || null,
    statusRaw: row.statusRaw || 'unknown',
    statusNorm: row.statusNorm || 'unknown',
    observedAt: row.observedAt || null,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    setCacheHeaders(res, { scope: 'public', maxAge: 10, sMaxage: 30, staleWhileRevalidate: 120 });
    const { value: payload, hit } = await cachedJson('points:aicm:overview:v1', 15_000, async () => {
      const sql = getReadSql();

      try {
        const [latestRuns, counterRows, dailyRows, timetableRows] = await Promise.all([
          sql`
            SELECT
              id,
              status,
              observed_at AS "observedAt",
              flight_date::text AS "flightDate",
              row_count AS "rowCount",
              delayed_count AS "delayedCount",
              cancelled_count AS "cancelledCount",
              error
            FROM points_aicm_poll_runs
            WHERE direction = 'departure'
            ORDER BY observed_at DESC, id DESC
            LIMIT 8
          `,
          sql`
            WITH clock AS (
              SELECT
                NOW() AS now_utc,
                (NOW() AT TIME ZONE 'America/Mexico_City')::date AS today
            ),
            periods AS (
              SELECT 'hour'::text AS window_key, '1h'::text AS label,
                     (SELECT now_utc FROM clock) - INTERVAL '1 hour' AS since_at,
                     NULL::date AS from_date,
                     NULL::date AS to_date
              UNION ALL
              SELECT 'day'::text, 'Hoy'::text, NULL::timestamptz,
                     (SELECT today FROM clock),
                     (SELECT today FROM clock)
              UNION ALL
              SELECT 'week'::text, '7d'::text, NULL::timestamptz,
                     (SELECT today FROM clock) - 6,
                     (SELECT today FROM clock)
            )
            SELECT
              p.window_key AS "windowKey",
              p.label,
              COUNT(DISTINCT o.flight_key) FILTER (WHERE o.status_norm = 'delayed')::int AS "delayedFlights",
              COUNT(DISTINCT o.flight_key) FILTER (WHERE o.status_norm = 'cancelled')::int AS "cancelledFlights",
              COUNT(DISTINCT o.flight_key)::int AS "observedFlights",
              MAX(o.observed_at) AS "lastObservedAt"
            FROM periods p
            LEFT JOIN points_aicm_flight_observations o
              ON o.direction = 'departure'
             AND (
                  (p.since_at IS NOT NULL AND o.observed_at >= p.since_at)
                  OR (
                    p.since_at IS NULL
                    AND o.flight_date >= p.from_date
                    AND o.flight_date <= p.to_date
                  )
             )
            GROUP BY p.window_key, p.label
            ORDER BY CASE p.window_key WHEN 'hour' THEN 1 WHEN 'day' THEN 2 ELSE 3 END
          `,
          sql`
            WITH clock AS (
              SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS today
            )
            SELECT
              o.flight_date::text AS "flightDate",
              COUNT(DISTINCT o.flight_key) FILTER (WHERE o.status_norm = 'delayed')::int AS "delayedFlights",
              COUNT(DISTINCT o.flight_key) FILTER (WHERE o.status_norm = 'cancelled')::int AS "cancelledFlights",
              COUNT(DISTINCT o.flight_key)::int AS "observedFlights"
            FROM points_aicm_flight_observations o
            WHERE o.direction = 'departure'
              AND o.flight_date >= (SELECT today FROM clock) - 6
              AND o.flight_date <= (SELECT today FROM clock)
            GROUP BY o.flight_date
            ORDER BY o.flight_date ASC
          `,
          sql`
            WITH clock AS (
              SELECT (NOW() AT TIME ZONE 'America/Mexico_City')::date AS today
            ),
            latest AS (
              SELECT DISTINCT ON (o.flight_key)
                o.flight_key AS "flightKey",
                o.flight_date::text AS "flightDate",
                o.flight_code AS "flightCode",
                o.airline,
                o.city,
                o.scheduled_time_local AS "scheduledTimeLocal",
                o.estimated_time_local AS "estimatedTimeLocal",
                o.terminal,
                o.gate,
                o.status_raw AS "statusRaw",
                o.status_norm AS "statusNorm",
                o.observed_at AS "observedAt"
              FROM points_aicm_flight_observations o
              WHERE o.direction = 'departure'
                AND o.flight_date = (SELECT today FROM clock)
              ORDER BY o.flight_key, o.observed_at DESC, o.id DESC
            )
            SELECT *
            FROM latest
            ORDER BY ("scheduledTimeLocal" IS NULL), "scheduledTimeLocal" ASC, "observedAt" DESC
            LIMIT 80
          `,
        ]);

        const counterEntries = counterRows.map(formatCounter);
        const counters = Object.fromEntries(counterEntries.map(row => [row.key, row]));
        const lastRun = latestRuns[0] ? formatRun(latestRuns[0]) : null;
        return {
          ...emptyOverview(),
          source: {
            key: AICM_SOURCE,
            url: AICM_DEFAULT_FLIGHTS_URL,
            status: lastRun?.status || 'empty',
            lastObservedAt: lastRun?.observedAt || null,
          },
          counters: {
            hour: counters.hour || emptyOverview().counters.hour,
            day: counters.day || emptyOverview().counters.day,
            week: counters.week || emptyOverview().counters.week,
          },
          daily: dailyRows.map(formatDaily),
          timetable: timetableRows.map(formatFlight),
          latestRuns: latestRuns.map(formatRun),
          generatedAt: new Date().toISOString(),
        };
      } catch (err) {
        if (isMissingAicmTable(err)) return emptyOverview('aicm_tables_missing');
        throw err;
      }
    });

    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[points/aicm/overview] failed', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'aicm_overview_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
