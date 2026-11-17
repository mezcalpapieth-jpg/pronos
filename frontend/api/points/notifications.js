import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import { markNotificationsRead, notificationId, readNotificationFeed, saveNotificationSettings } from '../_lib/points-notifications.js';

let connection;
function db() {
  connection ??= neon(process.env.DATABASE_URL);
  return connection;
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true })) return;
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });
    const session = requireSession(req, res);
    if (!session) return;
    const key = `point-notifications:${clientIp(req)}`;
    if (rateLimit(req, res, { key, limit: 120, windowMs: 60_000 })) return;

    const sql = db();
    await ensurePointsSchema(sql);
    const [account] = await sql`
      SELECT u.id, (u.email IS NOT NULL AND u.email <> '') AS has_email,
        COALESCE(p.resolution_email_consent IS NOT NULL, false) AS resolution_email
      FROM points_users u LEFT JOIN points_notification_settings p ON p.user_id = u.id
      WHERE u.turnkey_sub_org_id = ${session.sub}
    `;
    if (!account) return res.status(401).json({ error: 'not_authenticated' });

    if (req.method === 'GET') {
      const beforeId = notificationId(req.query.beforeId);
      if (req.query.beforeId != null && !beforeId) return res.status(400).json({ error: 'invalid_notification_id' });
      const result = await readNotificationFeed(sql, { userId: account.id, beforeId, countOnly: req.query.count === '1' });
      return res.status(200).json({ ...result, resolutionEmail: account.resolution_email, hasEmail: account.has_email });
    }

    const body = req.body || {};
    if (body.action === 'read') {
      const id = notificationId(body.id);
      const throughId = notificationId(body.throughId);
      if (!(id && body.throughId == null) && !(throughId && body.id == null)) {
        return res.status(400).json({ error: 'invalid_notification_id' });
      }
      await markNotificationsRead(sql, { userId: account.id, id, throughId });
      const { unread } = await readNotificationFeed(sql, { userId: account.id, countOnly: true });
      return res.status(200).json({ ok: true, unread });
    }

    if (body.action === 'settings') {
      if (typeof body.resolutionEmail !== 'boolean' || !['es', 'en'].includes(body.language)) {
        return res.status(400).json({ error: 'invalid_notification_settings' });
      }
      if (body.resolutionEmail && !account.has_email) return res.status(400).json({ error: 'email_not_configured' });
      const resolutionEmail = await saveNotificationSettings(sql, {
        userId: account.id, resolutionEmail: body.resolutionEmail, language: body.language,
      });
      return res.status(200).json({ resolutionEmail });
    }
    return res.status(400).json({ error: 'invalid_notification_action' });
  } catch (error) {
    console.error('[points/notifications] unhandled', { message: error?.message, code: error?.code });
    return res.status(500).json({ error: 'server_error' });
  }
}
