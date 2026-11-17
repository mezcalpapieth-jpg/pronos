import { neon } from '@neondatabase/serverless';
import { dispatchResolutionEmails } from '../_lib/points-notification-email.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'email_not_configured' });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensurePointsSchema(sql);
    const result = await dispatchResolutionEmails(sql, { key });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron/points-notification-email] failed', { message: error?.message, code: error?.code });
    return res.status(500).json({ error: 'notification_email_failed' });
  }
}
