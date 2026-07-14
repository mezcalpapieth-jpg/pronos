import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureDeckSchema } from '../../_lib/deck-schema.js';
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

    const [summaryRows, slideRows, sessionRows, questionRows, inviteRows] = await Promise.all([
      sql`
        SELECT
          (SELECT COUNT(*)::int FROM deck_sessions) AS sessions,
          (SELECT COUNT(DISTINCT LOWER(viewer_email))::int FROM deck_sessions) AS viewers,
          (SELECT COALESCE(SUM(duration_ms), 0)::bigint FROM deck_slide_events) AS total_ms,
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
          ds.id,
          ds.viewer_email,
          ds.deck_language,
          ds.started_at,
          ds.last_seen_at,
          di.label AS invite_label,
          di.email_hint,
          COALESCE(SUM(e.duration_ms), 0)::bigint AS total_ms,
          COALESCE(MAX(e.slide_number), 0)::int AS last_slide
        FROM deck_sessions ds
        LEFT JOIN deck_invites di ON di.id = ds.invite_id
        LEFT JOIN deck_slide_events e ON e.session_id = ds.id
        GROUP BY ds.id, di.label, di.email_hint
        ORDER BY ds.last_seen_at DESC
        LIMIT 80
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
        SELECT
          di.id,
          di.label,
          di.email_hint,
          di.active,
          di.created_by,
          di.created_at,
          di.revoked_at,
          COUNT(DISTINCT ds.id)::int AS sessions,
          COUNT(DISTINCT LOWER(ds.viewer_email))::int AS viewers,
          COALESCE(SUM(e.duration_ms), 0)::bigint AS total_ms
        FROM deck_invites di
        LEFT JOIN deck_sessions ds ON ds.invite_id = di.id
        LEFT JOIN deck_slide_events e ON e.session_id = ds.id
        GROUP BY di.id
        ORDER BY di.created_at DESC
        LIMIT 100
      `,
    ]);

    const summary = summaryRows[0] || {};
    return res.status(200).json({
      admin: admin.username,
      summary: {
        sessions: summary.sessions || 0,
        viewers: summary.viewers || 0,
        totalMinutes: minutes(summary.total_ms),
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
      sessions: sessionRows.map(r => ({
        id: r.id,
        viewerEmail: r.viewer_email,
        language: r.deck_language,
        inviteLabel: r.invite_label,
        inviteEmailHint: r.email_hint,
        startedAt: r.started_at,
        lastSeenAt: r.last_seen_at,
        totalMinutes: minutes(r.total_ms),
        lastSlide: r.last_slide,
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
        sessions: r.sessions,
        viewers: r.viewers,
        totalMinutes: minutes(r.total_ms),
      })),
    });
  } catch (e) {
    console.error('[deck/admin/dashboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'deck_dashboard_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
