import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { POINTS_COMMENT_MIGRATIONS, commentId, insertMarketComment, listMarketComments, setMarketCommentLike } from './points-comments.js';

test('comments validate IDs, retain one reply level and expose only the caller’s like state', async t => {
  assert.equal(commentId('12'), 12);
  assert.equal(commentId('1e1'), null);
  assert.equal(commentId(true), null);
  assert.equal(commentId('2147483648'), null);

  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_users (id INTEGER PRIMARY KEY, turnkey_sub_org_id TEXT);
    INSERT INTO points_users VALUES (1, 'ana-sub'), (2, 'ben-sub');
    CREATE TABLE points_markets (id INTEGER PRIMARY KEY);
    INSERT INTO points_markets VALUES (1), (2);
    CREATE TABLE points_comments (
      id SERIAL PRIMARY KEY, market_id INTEGER NOT NULL REFERENCES points_markets(id),
      username TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ
    );
    INSERT INTO points_comments (market_id, username, body) VALUES (1, 'ana', 'legacy');
  `);
  for (const migration of POINTS_COMMENT_MIGRATIONS) await db.exec(migration);

  const sql = async (parts, ...values) => (await db.query(
    parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values,
  )).rows;
  const post = (marketId, parentId, body) => insertMarketComment(sql, { marketId, parentId, username: 'ben', body });
  const read = (parentId = null, viewerSub = null, afterId = null, limit = 50) =>
    listMarketComments(sql, { marketId: 1, parentId, viewerSub, afterId, limit });
  const like = (viewerSub, liked) => setMarketCommentLike(sql, { id: 1, viewerSub, liked });

  assert.equal((await read()).comments[0].body, 'legacy');
  const reply = await post(1, 1, '<b>first</b>');
  const another = await post(1, 1, 'second');
  assert.equal(await post(1, reply.id, 'no nested replies'), null);
  assert.equal(await post(2, 1, 'other market'), null);

  assert.ok(await like('ana-sub', true));
  assert.ok(await like('ana-sub', true));
  assert.ok(await like('ben-sub', true));
  assert.equal((await read()).comments[0].likeCount, 2);
  assert.equal((await read()).comments[0].liked, false);
  assert.equal((await read(null, 'ana-sub')).comments[0].liked, true);
  assert.equal(await like('ana-sub', false), false);
  assert.equal(await like('ana-sub', false), false);
  assert.equal((await read(null, 'ana-sub')).comments[0].liked, false);
  assert.equal((await read(null, 'ben-sub')).comments[0].likeCount, 1);

  const roots = (await read()).comments;
  assert.equal(roots[0].replyCount, 2);
  assert.equal(roots.length, 1);
  const first = await read(1, 'ana-sub', null, 1);
  assert.equal(first.comments[0].body, '<b>first</b>');
  assert.equal(first.nextAfterId, reply.id);
  assert.deepEqual((await read(1, 'ana-sub', first.nextAfterId, 1)).comments.map(c => c.id), [another.id]);

  await db.exec('UPDATE points_comments SET deleted_at = NOW() WHERE id = 1');
  const deleted = (await read()).comments[0];
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.body, null);
  assert.equal(deleted.username, null);
  assert.equal(deleted.replyCount, 2);
  assert.equal(await post(1, 1, 'reply to deleted root'), null);
  assert.equal(await like('ben-sub', true), null);
  await db.exec('UPDATE points_comments SET deleted_at = NOW() WHERE parent_id = 1');
  assert.deepEqual((await read()).comments, []);
});
