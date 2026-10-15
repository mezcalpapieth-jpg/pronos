import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './official-contracts.js';
import { createSessionToken } from '../../_lib/session.js';

test('contract activation requires an admin session, same-origin POST and a preview hash before DB access', async () => {
  const secret = process.env.POINTS_SESSION_SECRET; const admins = process.env.POINTS_ADMIN_USERNAMES;
  process.env.POINTS_SESSION_SECRET = 'test-official-contracts-secret';
  process.env.POINTS_ADMIN_USERNAMES = 'admin';
  const invoke = async (req) => {
    const res = { statusCode: 200, setHeader() {}, status(n) { this.statusCode = n; return this; },
      json(body) { this.body = body; return this; }, end() { return this; } };
    await handler(req, res); return res;
  };
  try {
    assert.equal((await invoke({ method: 'GET', headers: {} })).statusCode, 401);
    const cookieFor = username => `pronos_points_session=${createSessionToken({ suborgId: 'test', username })}`;
    assert.equal((await invoke({ method: 'GET', headers: { cookie: cookieFor('viewer') } })).statusCode, 403);
    const headers = { cookie: cookieFor('admin') };
    const missing = await invoke({ method: 'POST', headers, body: {} });
    assert.equal(missing.statusCode, 400); assert.equal(missing.body.error, 'preview_required');
    assert.equal((await invoke({ method: 'POST', headers: { ...headers, origin: 'https://evil.test' }, body: { planHash: 'x' } })).statusCode, 403);
    assert.equal((await invoke({ method: 'DELETE', headers })).statusCode, 405);
  } finally {
    if (secret == null) delete process.env.POINTS_SESSION_SECRET; else process.env.POINTS_SESSION_SECRET = secret;
    if (admins == null) delete process.env.POINTS_ADMIN_USERNAMES; else process.env.POINTS_ADMIN_USERNAMES = admins;
  }
});
