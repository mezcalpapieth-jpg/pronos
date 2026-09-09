import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureDeckSchema } from '../../_lib/deck-schema.js';
import { decryptDeckCodeForAdmin } from '../../_lib/deck-session.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function minutes(ms) {
  return Math.round((Number(ms || 0) / 60000) * 10) / 10;
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;
    await ensureDeckSchema(schemaSql);

    const [
      summaryRows,
      slideRows,
      pageRows,
      sessionRows,
      sessionSlideRows,
      sessionPageRows,
      questionRows,
      inviteRows,
    ] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*)::int FROM deck_sessions) AS sessions,
          (SELECT COUNT(DISTINCT LOWER(viewer_email))::int FROM deck_sessions) AS viewers,
          (SELECT COALESCE(SUM(duration_ms), 0)::bigint FROM deck_slide_events) AS total_ms,
          (SELECT COUNT(DISTINCT session_id)::int FROM deck_page_events WHERE page_key = 'investor_dashboard') AS dashboard_sessions,
          (SELECT COUNT(DISTINCT LOWER(viewer_email))::int FROM deck_page_events WHERE page_key = 'investor_dashboard') AS dashboard_viewers,
          (SELECT COALESCE(SUM(duration_ms), 0)::bigint FROM deck_page_events WHERE page_key = 'investor_dashboard') AS dashboard_total_ms,
          (SELECT COUNT(*)::int FROM deck_questions) AS questions
      `,
      sql`
        SELECT
          deck_language,
          slide_number,
          COALESCE(SUM(duration_ms), 0)::bigint AS total_ms,
          COUNT(DISTINCT session_id)::int AS sessions,
          COUNT(*)::int AS events
        FROM deck_slide_events
        WHERE duration_ms > 0
        GROUP BY deck_language, slide_number
        ORDER BY deck_language ASC, slide_number ASC
      `,
      sql`
        SELECT
          page_key,
          COALESCE(SUM(duration_ms), 0)::bigint AS total_ms,
          COUNT(DISTINCT session_id)::int AS sessions,
          COUNT(DISTINCT LOWER(viewer_email))::int AS viewers,
          COUNT(*)::int AS events,
          MAX(created_at) AS last_event_at
        FROM deck_page_events
        GROUP BY page_key
        ORDER BY total_ms DESC, events DESC
      `,
      sql`
        WITH slide_totals AS (
          SELECT
            session_id,
            COALESCE(SUM(duration_ms), 0)::bigint AS total_ms,
            COALESCE(MAX(slide_number), 0)::int AS last_slide
          FROM deck_slide_events
          GROUP BY session_id
        ),
        page_totals AS (
          SELECT
            session_id,
            COALESCE(SUM(duration_ms), 0)::bigint AS dashboard_total_ms
          FROM deck_page_events
          WHERE page_key = 'investor_dashboard'
          GROUP BY session_id
        )
        SELECT
          ds.id,
          ds.viewer_email,
          ds.deck_language,
          ds.started_at,
          ds.last_seen_at,
          di.label AS invite_label,
          di.email_hint,
          COALESCE(st.total_ms, 0)::bigint AS total_ms,
          COALESCE(st.last_slide, 0)::int AS last_slide,
          COALESCE(pt.dashboard_total_ms, 0)::bigint AS dashboard_total_ms
        FROM deck_sessions ds
        LEFT JOIN deck_invites di ON di.id = ds.invite_id
        LEFT JOIN slide_totals st ON st.session_id = ds.id
        LEFT JOIN page_totals pt ON pt.session_id = ds.id
        ORDER BY ds.last_seen_at DESC
        LIMIT 80
      `,
      sql`
        WITH recent_sessions AS (
          SELECT id
          FROM deck_sessions
          ORDER BY last_seen_at DESC
          LIMIT 80
        )
        SELECT
          e.session_id,
          e.deck_language,
          e.slide_number,
          COALESCE(SUM(e.duration_ms), 0)::bigint AS total_ms,
          COUNT(*)::int AS events,
          MAX(e.created_at) AS last_event_at
        FROM deck_slide_events e
        JOIN recent_sessions rs ON rs.id = e.session_id
        WHERE e.duration_ms > 0
        GROUP BY e.session_id, e.deck_language, e.slide_number
        ORDER BY e.session_id ASC, e.deck_language ASC, e.slide_number ASC
      `,
      sql`
        WITH recent_sessions AS (
          SELECT id
          FROM deck_sessions
          ORDER BY last_seen_at DESC
          LIMIT 80
        )
        SELECT
          e.session_id,
          e.page_key,
          COALESCE(SUM(e.duration_ms), 0)::bigint AS total_ms,
          COUNT(*)::int AS events,
          MAX(e.created_at) AS last_event_at
        FROM deck_page_events e
        JOIN recent_sessions rs ON rs.id = e.session_id
        GROUP BY e.session_id, e.page_key
        ORDER BY e.session_id ASC, e.page_key ASC
      `,
      sql`
        SELECT
          q.id,
          q.viewer_email,
          q.deck_language,
          q.slide_number,
          q.question,
          q.status,
          q.created_at,
          di.label AS invite_label
        FROM deck_questions q
        LEFT JOIN deck_invites di ON di.id = q.invite_id
        ORDER BY q.created_at DESC
        LIMIT 100
      `,
      sql`
        WITH invite_slide AS (
          SELECT
            ds.invite_id,
            COALESCE(SUM(e.duration_ms), 0)::bigint AS total_ms
          FROM deck_sessions ds
          JOIN deck_slide_events e ON e.session_id = ds.id
          GROUP BY ds.invite_id
        ),
        invite_page AS (
          SELECT
            ds.invite_id,
            COALESCE(SUM(e.duration_ms), 0)::bigint AS dashboard_total_ms
          FROM deck_sessions ds
          JOIN deck_page_events e ON e.session_id = ds.id
          WHERE e.page_key = 'investor_dashboard'
          GROUP BY ds.invite_id
        )
        SELECT
          di.id,
          di.label,
          di.email_hint,
          di.active,
          di.created_by,
          di.created_at,
          di.revoked_at,
          di.code_ciphertext,
          COUNT(DISTINCT ds.id)::int AS sessions,
          COUNT(DISTINCT LOWER(ds.viewer_email))::int AS viewers,
          COALESCE(invite_slide.total_ms, 0)::bigint AS total_ms,
          COALESCE(invite_page.dashboard_total_ms, 0)::bigint AS dashboard_total_ms
        FROM deck_invites di
        LEFT JOIN deck_sessions ds ON ds.invite_id = di.id
        LEFT JOIN invite_slide ON invite_slide.invite_id = di.id
        LEFT JOIN invite_page ON invite_page.invite_id = di.id
        GROUP BY di.id, invite_slide.total_ms, invite_page.dashboard_total_ms
        ORDER BY di.created_at DESC
        LIMIT 100
      `,
    ]);

    const summary = summaryRows[0] || {};
    const sessionSlides = new Map();
    for (const row of sessionSlideRows) {
      const list = sessionSlides.get(row.session_id) || [];
      list.push({
        language: row.deck_language,
        slideNumber: row.slide_number,
        totalMinutes: minutes(row.total_ms),
        events: row.events,
        lastEventAt: row.last_event_at,
      });
      sessionSlides.set(row.session_id, list);
    }
    const sessionPages = new Map();
    for (const row of sessionPageRows) {
      const list = sessionPages.get(row.session_id) || [];
      list.push({
        pageKey: row.page_key,
        totalMinutes: minutes(row.total_ms),
        events: row.events,
        lastEventAt: row.last_event_at,
      });
      sessionPages.set(row.session_id, list);
    }

    return res.status(200).json({
      admin: admin.username,
      summary: {
        sessions: summary.sessions || 0,
        viewers: summary.viewers || 0,
        totalMinutes: minutes(summary.total_ms),
        dashboardSessions: summary.dashboard_sessions || 0,
        dashboardViewers: summary.dashboard_viewers || 0,
        dashboardMinutes: minutes(summary.dashboard_total_ms),
        questions: summary.questions || 0,
      },
      slides: slideRows.map(r => ({
        language: r.deck_language,
        slideNumber: r.slide_number,
        totalMinutes: minutes(r.total_ms),
        avgMinutes: r.sessions ? minutes(Number(r.total_ms || 0) / r.sessions) : 0,
        sessions: r.sessions,
        events: r.events,
      })),
      pages: pageRows.map(r => ({
        pageKey: r.page_key,
        totalMinutes: minutes(r.total_ms),
        sessions: r.sessions,
        viewers: r.viewers,
        events: r.events,
        lastEventAt: r.last_event_at,
      })),
      sessions: sessionRows.map(r => ({
        id: r.id,
        viewerEmail: r.viewer_email,
        language: r.deck_language,
        inviteLabel: r.invite_label,
        inviteEmailHint: r.email_hint,
        startedAt: r.started_at,
        lastSeenAt: r.last_seen_at,
        totalMinutes: minutes(r.total_ms),
        dashboardMinutes: minutes(r.dashboard_total_ms),
        lastSlide: r.last_slide,
        slideBreakdown: sessionSlides.get(r.id) || [],
        pageBreakdown: sessionPages.get(r.id) || [],
      })),
      questions: questionRows.map(r => ({
        id: r.id,
        viewerEmail: r.viewer_email,
        language: r.deck_language,
        slideNumber: r.slide_number,
        question: r.question,
        status: r.status,
        createdAt: r.created_at,
        inviteLabel: r.invite_label,
      })),
      invites: inviteRows.map(r => ({
        id: r.id,
        label: r.label,
        emailHint: r.email_hint,
        active: r.active && !r.revoked_at,
        createdBy: r.created_by,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        shareCode: decryptDeckCodeForAdmin(r.code_ciphertext),
        sessions: r.sessions,
        viewers: r.viewers,
        totalMinutes: minutes(r.total_ms),
        dashboardMinutes: minutes(r.dashboard_total_ms),
      })),
    });
  } catch (e) {
    console.error('[deck/admin/dashboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'deck_dashboard_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
