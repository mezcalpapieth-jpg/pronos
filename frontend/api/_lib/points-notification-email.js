const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_EMAIL = 'Pronos <support@pronos.io>';
const BATCH_SIZE = 30;

export async function dispatchResolutionEmails(sql, { key, send = fetch } = {}) {
  // Resend's deduplication window is 24 hours. Bound all attempts to a
  // shorter interval so losing a success response cannot cause two emails.
  const jobs = await sql`
    WITH next AS (
      SELECT e.notification_id, n.market_id, n.source_id <> n.market_id AS leg_resolved
      FROM points_notification_emails e
      JOIN points_notifications n ON n.id = e.notification_id
      JOIN points_notification_settings p ON p.user_id = n.user_id
      JOIN points_users u ON u.id = n.user_id
      WHERE e.sent_at IS NULL AND e.available_at <= NOW()
        AND n.kind = 'market_resolved' AND n.market_id IS NOT NULL
        AND n.created_at > NOW() - INTERVAL '23 hours'
        AND p.resolution_email_consent = e.consent AND u.email = e.email
      ORDER BY e.available_at, e.notification_id
      LIMIT ${BATCH_SIZE} FOR UPDATE OF e SKIP LOCKED
    )
    UPDATE points_notification_emails e SET available_at = NOW() + INTERVAL '5 minutes'
    FROM next WHERE e.notification_id = next.notification_id
    RETURNING e.notification_id, e.email, e.consent, e.language, next.market_id, next.leg_resolved
  `;

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const stillAllowed = await sql`
      SELECT 1 FROM points_notifications n
      JOIN points_notification_settings p ON p.user_id = n.user_id
      JOIN points_users u ON u.id = n.user_id
      WHERE n.id = ${job.notification_id} AND p.resolution_email_consent = ${job.consent} AND u.email = ${job.email}
    `;
    if (!stillAllowed.length) continue;

    const en = job.language === 'en';
    const market = `https://pronos.io/points/market?id=${job.market_id}`;
    const settings = 'https://pronos.io/points/?notifications=1';
    const subject = job.leg_resolved
      ? (en ? 'An outcome you held on Pronos has resolved' : 'Se resolvió una opción en la que tenías una posición')
      : (en ? 'Your Pronos market has resolved' : 'Tu mercado de Pronos se resolvió');
    const text = en
      ? `${subject}. View the result: ${market}\n\nManage resolution emails: ${settings}`
      : `${subject}. Ver el resultado: ${market}\n\nConfigura los correos de resolución: ${settings}`;
    let response;
    try {
      response = await send(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `points-market-resolution/${job.notification_id}`,
        },
        body: JSON.stringify({ from: FROM_EMAIL, to: [job.email], subject, text }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      failed += 1;
      continue;
    }
    if (response.ok) {
      // Keep the delivery timestamp for audit and release the recipient
      // snapshot once the job no longer needs it.
      await sql`
        UPDATE points_notification_emails SET sent_at = NOW(), email = ''
        WHERE notification_id = ${job.notification_id}
      `;
      sent += 1;
    } else {
      failed += 1;
      console.warn('[points/notification-email] delivery rejected', { status: response.status });
      if (response.status === 429) break;
    }
  }

  await sql`
    DELETE FROM points_notification_emails e USING points_notifications n
    WHERE e.notification_id = n.id AND e.sent_at IS NULL
      AND n.created_at <= NOW() - INTERVAL '23 hours'
  `;
  return { claimed: jobs.length, sent, failed };
}
