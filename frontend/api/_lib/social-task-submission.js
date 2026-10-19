// Called inside withTransaction so unlinking cannot race the account check and insert.
export async function submitManualSocialTask(client, { username, task, proofUrl }) {
  const network = String(task.network || task.platform || '').trim().toLowerCase();
  const provider = network === 'twitter' ? 'x' : network;
  if (!['x', 'instagram', 'tiktok'].includes(provider)) {
    throw Object.assign(new Error('invalid_task_network'), { code: 'invalid_task_network', status: 400 });
  }
  const links = await client.query(`SELECT handle FROM points_social_links
    WHERE LOWER(username) = LOWER($1) AND provider = $2 LIMIT 1 FOR SHARE`, [username, provider]);
  if (!String(links.rows[0]?.handle || '').trim().replace(/^@+/, '')) {
    throw Object.assign(new Error('social_account_required'), {
      code: 'social_account_required', status: 409, provider, hint: 'add_social_account',
    });
  }
  const result = await client.query(`
    INSERT INTO social_tasks (username, task_key, status, reward, proof_url)
    VALUES ($1, $2, 'pending', $3, $4)
    ON CONFLICT (username, task_key) DO UPDATE
    SET status = CASE
          WHEN social_tasks.status = 'rejected' THEN 'pending'
          ELSE social_tasks.status
        END,
        proof_url = CASE
          WHEN social_tasks.status = 'rejected' THEN EXCLUDED.proof_url
          ELSE social_tasks.proof_url
        END,
        rejection_note = CASE
          WHEN social_tasks.status = 'rejected' THEN NULL
          ELSE social_tasks.rejection_note
        END,
        reviewer = CASE
          WHEN social_tasks.status = 'rejected' THEN NULL
          ELSE social_tasks.reviewer
        END,
        reviewed_at = CASE
          WHEN social_tasks.status = 'rejected' THEN NULL
          ELSE social_tasks.reviewed_at
        END
    RETURNING status, id`, [username, task.key, task.reward, proofUrl]);
  return result.rows[0];
}
