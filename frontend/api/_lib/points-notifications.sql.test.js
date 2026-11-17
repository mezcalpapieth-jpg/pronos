import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { redeemWinningPosition } from './points-redemption.js';
import { ensurePointsSchema } from './points-schema.js';
import { POINTS_NOTIFICATION_MIGRATIONS } from './points-notification-schema.js';
import { dispatchResolutionEmails } from './points-notification-email.js';
import { markNotificationsRead, notificationId, readNotificationFeed, saveNotificationSettings } from './points-notifications.js';

test('Points notifications commit with their source, respect ownership, and only email opted-in holders', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const sql = async (parts, ...values) => (await db.query(
    parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values,
  )).rows;

  await db.exec(`
    CREATE TABLE points_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, email TEXT);
    CREATE TABLE points_markets (
      id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES points_markets(id), status TEXT, mode TEXT,
      is_test_market BOOLEAN, question TEXT, leg_label TEXT
    );
    CREATE TABLE points_positions (market_id INTEGER, username TEXT, shares NUMERIC);
    CREATE TABLE points_comments (id INTEGER PRIMARY KEY, market_id INTEGER, parent_id INTEGER, username TEXT, deleted_at TIMESTAMPTZ);
    CREATE TABLE points_distributions (id INTEGER PRIMARY KEY, kind TEXT, amount NUMERIC, reference_id INTEGER, username TEXT);
    CREATE TABLE points_limit_orders (id INTEGER PRIMARY KEY, market_id INTEGER, username TEXT, status TEXT, filled_shares NUMERIC);
    INSERT INTO points_users VALUES (1,'ana','ana@example.test'), (2,'ben','ben@example.test'), (3,'cam','');
    INSERT INTO points_markets VALUES
      (1,NULL,'active','points',false,'Market A',NULL), (2,1,'active','points',false,'Runner B','Runner B'),
      (3,NULL,'active','points',true,'Test market',NULL), (4,NULL,'active','points',false,'Market D',NULL),
      (5,NULL,'active','points',false,'Market E',NULL);
    INSERT INTO points_positions VALUES
      (1,'ana',50), (2,'ana',2), (2,'ben',80), (1,'cam',0), (3,'ana',12), (4,'ana',8), (5,'ana',15);
    INSERT INTO points_comments VALUES (1,1,NULL,'ana',NULL), (2,1,NULL,'ana',NOW());
    INSERT INTO points_limit_orders VALUES (1,2,'ana','open',0), (2,1,'ana','open',0), (3,3,'ana','open',0);
  `);
  for (const migration of POINTS_NOTIFICATION_MIGRATIONS) await db.exec(migration);
  // A repeated startup migration keeps the trigger set and prior records.
  for (const migration of POINTS_NOTIFICATION_MIGRATIONS) await db.exec(migration);

  assert.equal(notificationId('9223372036854775807'), '9223372036854775807');
  assert.equal(notificationId('9223372036854775808'), null);
  assert.equal(notificationId('1e3'), null);
  const feed = (userId, beforeId = null) => readNotificationFeed(sql, { userId, beforeId });
  const outbox = () => sql`SELECT e.*, n.market_id FROM points_notification_emails e
    JOIN points_notifications n ON n.id = e.notification_id ORDER BY e.notification_id`;

  assert.equal(await saveNotificationSettings(sql, { userId: 1, resolutionEmail: true, language: 'en' }), true);
  await db.exec(`
    BEGIN;
    UPDATE points_markets SET status = 'resolved' WHERE id = 1;
    ROLLBACK;
    UPDATE points_markets SET status = 'resolved' WHERE id = 1;
    UPDATE points_markets SET status = 'resolved' WHERE id IN (2,3);
    UPDATE points_markets SET status = 'active' WHERE id = 1;
    UPDATE points_markets SET status = 'resolved' WHERE id = 1;
    UPDATE points_limit_orders SET filled_shares = 2 WHERE id = 2;
    UPDATE points_limit_orders SET status = 'filled', filled_shares = 5 WHERE id IN (1,3);
    UPDATE points_limit_orders SET status = 'open' WHERE id = 1;
    UPDATE points_limit_orders SET status = 'filled' WHERE id = 1;
    INSERT INTO points_distributions VALUES
      (1,'redemption',12.125,2,'ana'), (2,'parlay_payout',60,1,'ana'),
      (3,'redemption',-50,1,'ana'), (4,'deposit',5,1,'ana'), (5,'redemption',5,3,'ana');
    INSERT INTO points_comments VALUES (3,1,1,'ben',NULL), (4,1,1,'ana',NULL), (5,1,2,'ben',NULL);
  `);
  const ana = await feed(1);
  assert.equal(ana.unread, 5);
  assert.deepEqual(ana.items.map(item => [item.kind, item.marketId, item.question, item.amount]), [
    ['comment_reply', 1, 'Market A', null],
    ['winnings_credited', null, null, 60],
    ['winnings_credited', 1, 'Market A', 12.125],
    ['limit_order_filled', 1, 'Market A', null],
    ['market_resolved', 1, 'Market A', null],
  ]);
  const ben = await feed(2);
  assert.deepEqual(ben.items.map(item => item.kind), ['market_resolved']);
  assert.equal((await feed(3)).unread, 0);
  assert.deepEqual((await outbox()).map(job => [job.email, job.market_id]), [['ana@example.test', 1]]);

  assert.equal(await saveNotificationSettings(sql, { userId: 2, resolutionEmail: true, language: 'es' }), true);
  assert.equal((await outbox()).length, 1);
  await markNotificationsRead(sql, { userId: 2, id: ana.items[0].id, throughId: null });
  assert.equal((await feed(1)).unread, 5);
  await markNotificationsRead(sql, { userId: 1, id: null, throughId: ana.items[1].id });
  assert.equal((await feed(1)).unread, 1);
  await markNotificationsRead(sql, { userId: 1, id: ana.items[0].id, throughId: null });
  assert.equal((await feed(1)).unread, 0);

  const deliveries = [];
  const send = async (url, request) => {
    deliveries.push({ url, key: request.headers['Idempotency-Key'], ...JSON.parse(request.body) });
    if (deliveries.length === 1) throw new Error('response lost');
    return { ok: true };
  };
  const dispatch = () => dispatchResolutionEmails(sql, { key: 'fake-key', send });
  assert.deepEqual(await dispatch(), { claimed: 1, sent: 0, failed: 1 });
  assert.deepEqual(await dispatch(), { claimed: 0, sent: 0, failed: 0 });
  await db.exec("UPDATE points_notification_emails SET available_at = NOW() - INTERVAL '1 second'");
  assert.deepEqual(await dispatch(), { claimed: 1, sent: 1, failed: 0 });
  assert.equal(deliveries[1].key, deliveries[0].key);
  assert.deepEqual(deliveries[1].to, ['ana@example.test']);
  assert.match(deliveries[1].text, /market\?id=1/);
  assert.match(deliveries[1].text, /notifications=1/);
  assert.deepEqual(await dispatch(), { claimed: 0, sent: 0, failed: 0 });
  assert.ok((await outbox())[0].sent_at);
  assert.equal((await outbox())[0].email, '');

  await db.exec("UPDATE points_markets SET status = 'resolved' WHERE id = 4");
  await saveNotificationSettings(sql, { userId: 1, resolutionEmail: false, language: 'en' });
  await saveNotificationSettings(sql, { userId: 1, resolutionEmail: true, language: 'es' });
  await db.exec("UPDATE points_markets SET status = 'resolved' WHERE id = 5");
  assert.deepEqual(await dispatch(), { claimed: 1, sent: 1, failed: 0 });
  assert.match(deliveries[2].subject, /se resolvió/);
  assert.match(deliveries[2].text, /market\?id=5/);

  await db.exec(`
    INSERT INTO points_comments
    SELECT id, 1, 1, 'ben', NULL FROM generate_series(100, 125) AS id;
  `);
  const firstPage = await feed(1);
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.nextBeforeId, firstPage.items.at(-1).id);
  const secondPage = await feed(1, firstPage.nextBeforeId);
  assert.equal(secondPage.items.length, 13);
  assert.ok(BigInt(secondPage.items[0].id) < BigInt(firstPage.nextBeforeId));
  assert.equal(secondPage.nextBeforeId, null);
});

test('early parallel resolution and later parent settlement alert who holds each position, even after redemption', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const sql = async (parts, ...values) => (await db.query(
    parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values,
  )).rows;
  await ensurePointsSchema({
    query: async (statement) => (await db.query(statement)).rows,
  });
  await db.exec(`
    INSERT INTO points_users (id, username, turnkey_sub_org_id, email) VALUES
      (1, 'ana', 'token-a', 'ana@example.test'),
      (2, 'ben', 'token-b', 'ben@example.test'),
      (3, 'cam', 'token-c', 'cam@example.test');
    INSERT INTO points_cycles (label, started_at, ends_at, status)
      VALUES ('Notification test', NOW() - INTERVAL '7 days', NOW() + INTERVAL '7 days', 'active');
    INSERT INTO points_markets (id, question, outcomes, reserves, end_time, amm_mode, parent_id, leg_label) VALUES
      (100, 'Who will win?', '["Alpha","Beta","Gamma"]', '[500,500,500]', NOW(), 'parallel', NULL, NULL),
      (101, 'Will Alpha win?', '["Sí","No"]', '[100,100]', NOW(), 'unified', 100, 'Alpha'),
      (102, 'Will Beta win?', '["Sí","No"]', '[100,100]', NOW(), 'unified', 100, 'Beta'),
      (103, 'Will Gamma win?', '["Sí","No"]', '[100,100]', NOW(), 'unified', 100, 'Gamma');
    INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis) VALUES
      (101, 'ana', 1, 10.000001, 2),
      (101, 'cam', 0, 2.25, 1),
      (102, 'ben', 0, 45.125125, 20),
      (103, 'ben', 1, 9.234567, 4);
    INSERT INTO points_trades (market_id, username, side, outcome_index, shares, collateral, price_at_trade)
      SELECT market_id, username, 'buy', outcome_index, shares, cost_basis, 0.5 FROM points_positions;
  `);

  assert.equal(await saveNotificationSettings(sql, { userId: 1, language: 'es', resolutionEmail: true }), true);
  await db.exec(`
    UPDATE points_markets SET status = 'resolved', outcome = 1, resolved_at = NOW(), resolved_by = 'admin'
      WHERE id = 101 AND status = 'active';
  `);
  const claim = (username, marketId, outcomeIndex, opts = {}) => db.transaction(client =>
    redeemWinningPosition(client, { username, marketId, outcomeIndex, ...opts }));
  assert.deepEqual(await claim('ana', 101, 1, { source: 'api' }), {
    balance: 10.000001, payout: 10.000001, shares: 10.000001,
  });
  const anaShares = await sql`SELECT shares FROM points_positions WHERE market_id = 101 AND username = 'ana'`;
  assert.equal(Number(anaShares[0].shares), 0);
  assert.equal(await saveNotificationSettings(sql, { userId: 2, language: 'en', resolutionEmail: true }), true);

  await db.transaction(async client => {
    await client.query(`UPDATE points_markets SET status = 'resolved', outcome = 1, resolved_at = NOW(),
      resolved_by = 'resolver' WHERE id = 100 AND status = 'active'`);
    await client.query(`UPDATE points_markets SET status = 'resolved', outcome = 0, resolved_at = NOW(),
      resolved_by = 'resolver' WHERE id = 102 AND status = 'active'`);
    await client.query(`UPDATE points_markets SET status = 'resolved', outcome = 1, resolved_at = NOW(),
      resolved_by = 'resolver' WHERE id = 103 AND status = 'active'`);
  });

  assert.deepEqual(await claim('ben', 102, 0), { balance: 45.125125, payout: 45.125125, shares: 45.125125 });
  await assert.rejects(claim('ben', 102, 0), /no_shares_to_redeem/);
  assert.deepEqual(await claim('ben', 103, 1), { balance: 54.359692, payout: 9.234567, shares: 9.234567 });
  const read = async userId => (await readNotificationFeed(sql, { userId, beforeId: null })).items
    .map(item => [item.kind, item.marketId, item.legLabel, item.amount]);
  assert.deepEqual(await read(1), [['winnings_credited', 100, null, 10.000001], ['market_resolved', 100, 'Alpha', null]]);
  assert.deepEqual(await read(2), [
    ['winnings_credited', 100, null, 9.234567],
    ['winnings_credited', 100, null, 45.125125],
    ['market_resolved', 100, null, null],
  ]);
  assert.deepEqual(await read(3), [['market_resolved', 100, 'Alpha', null]]);

  const sent = [];
  assert.deepEqual(await dispatchResolutionEmails(sql, {
    key: 'test-only',
    send: async (_url, request) => { sent.push(JSON.parse(request.body)); return { ok: true }; },
  }), { claimed: 2, sent: 2, failed: 0 });
  assert.deepEqual(sent.map(email => [email.to[0], email.subject]).sort(), [
    ['ana@example.test', 'Se resolvió una opción en la que tenías una posición'],
    ['ben@example.test', 'Your Pronos market has resolved'],
  ]);
});
