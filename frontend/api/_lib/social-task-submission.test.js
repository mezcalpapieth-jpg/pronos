import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { submitManualSocialTask } from './social-task-submission.js';

async function database() {
  // Local in-memory database only; these tests never use DATABASE_URL.
  const db = new PGlite();
  await db.exec(`CREATE TABLE points_social_links (username TEXT, provider TEXT, handle TEXT, source TEXT, is_public BOOLEAN DEFAULT false);
    CREATE TABLE social_tasks (id SERIAL PRIMARY KEY, username TEXT, task_key TEXT, status TEXT, reward NUMERIC,
      proof_url TEXT, rejection_note TEXT, reviewer TEXT, reviewed_at TIMESTAMPTZ, UNIQUE(username,task_key));`);
  return db;
}
const task = (network, key = `${network}_follow`) => ({ key, network, reward: 100, socialAccount: 'client-claim-is-not-proof' });
const submit = (db, socialTask) => db.transaction(client => submitManualSocialTask(client, {
  username: 'alice', task: socialTask, proofUrl: 'https://example.com/exact-post',
}));

test('all supported networks require their own persisted account, even if the caller claims a handle', async () => {
  const db = await database();
  try {
    for (const network of ['x', 'twitter', 'instagram', 'tiktok']) {
      await assert.rejects(submit(db, task(network)), e => e.code === 'social_account_required' && e.status === 409);
    }
    await db.query(`INSERT INTO points_social_links (username,provider,handle,source) VALUES ('alice','x','alice_x','manual')`);
    await assert.rejects(submit(db, task('instagram', 'campaign:ig')), e => e.provider === 'instagram');
    await assert.rejects(submit(db, task('tiktok', 'campaign:tt')), e => e.provider === 'tiktok');
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM social_tasks')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('blank saved accounts and unsupported task networks never reach review', async () => {
  const db = await database();
  try {
    for (const handle of [null, '', '   ', '@']) {
      await db.query(`INSERT INTO points_social_links (username,provider,handle,source) VALUES ('alice','instagram',$1,'manual')`, [handle]);
      await assert.rejects(submit(db, task('instagram')), e => e.code === 'social_account_required');
      await db.exec('DELETE FROM points_social_links');
    }
    await assert.rejects(submit(db, task('other')), e => e.code === 'invalid_task_network');
    assert.equal((await db.query('SELECT COUNT(*) AS n FROM social_tasks')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('private manual and OAuth accounts allow submission and remain saved for later tasks', async () => {
  const db = await database();
  try {
    for (const [provider, source] of [['x', 'oauth'], ['instagram', 'manual'], ['tiktok', 'manual']]) {
      await db.query('INSERT INTO points_social_links (username,provider,handle,source) VALUES ($1,$2,$3,$4)', ['Alice', provider, `alice_${provider}`, source]);
      const first = await submit(db, task(provider));
      assert.equal(first.status, 'pending');
      const again = await submit(db, task(provider));
      assert.equal(again.id, first.id);
      assert.equal((await submit(db, task(provider, `campaign:${provider}`))).status, 'pending');
    }
    assert.equal((await submit(db, task('twitter'))).status, 'pending');
    const profiles = (await db.query('SELECT * FROM points_social_links')).rows;
    assert.equal(profiles.length, 3);
    assert.ok(profiles.every(row => row.handle.startsWith('alice_') && row.is_public === false));
  } finally { await db.close(); }
});

test('rejected tasks cannot bypass the account requirement and clear review metadata only after a valid retry', async () => {
  const db = await database();
  try {
    await db.exec(`INSERT INTO social_tasks (username,task_key,status,reward,proof_url,rejection_note,reviewer,reviewed_at)
      VALUES ('alice','instagram_follow','rejected',100,'old proof','missing account','admin',NOW());`);
    await assert.rejects(submit(db, task('instagram')), e => e.code === 'social_account_required');
    assert.equal((await db.query('SELECT status FROM social_tasks')).rows[0].status, 'rejected');
    await db.exec(`INSERT INTO points_social_links (username,provider,handle,source) VALUES ('alice','instagram','alice_ig','manual')`);
    assert.equal((await submit(db, task('instagram'))).status, 'pending');
    const retried = (await db.query('SELECT * FROM social_tasks')).rows[0];
    assert.equal(retried.reviewer, null);
    assert.equal(retried.reviewed_at, null);
    assert.equal(retried.rejection_note, null);
    assert.equal(retried.proof_url, 'https://example.com/exact-post');
  } finally { await db.close(); }
});
