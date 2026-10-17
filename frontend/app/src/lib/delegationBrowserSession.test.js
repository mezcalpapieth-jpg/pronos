import test from 'node:test';
import assert from 'node:assert/strict';
import { delegationOwnerClient } from './delegationClient.js';

// Exercise the installed browser SDK's session API without network or IndexedDB
// mutations. All tokens/identities below are synthetic test-only values.
const values = new Map();
globalThis.window = { localStorage: {
  getItem: key => values.get(key) ?? null,
  setItem: (key,value) => values.set(key,value),
  removeItem: key => values.delete(key),
}, location: { hostname: 'localhost' } };
const { Turnkey, TurnkeyIndexedDbClient } = await import('@turnkey/sdk-browser');
const browser = new Turnkey({ apiBaseUrl:'https://api.turnkey.com', defaultOrganizationId:'parent' });
const publicKey = `02${'ab'.repeat(32)}`;
const client = new TurnkeyIndexedDbClient({ apiBaseUrl:'https://api.turnkey.com', defaultOrganizationId:'parent', stamper: { getPublicKey: async () => publicKey } });
const jwt = (patch={}) => ['synthetic-test-header', Buffer.from(JSON.stringify({ exp:Math.floor(Date.now()/1000)+3600,public_key:publicKey,session_type:'SESSION_TYPE_READ_WRITE',user_id:'test-owner',organization_id:'test-suborg',...patch })).toString('base64'), 'synthetic-test-signature'].join('.');

test('OTP session saved by IndexedDbClient is read from the browser SDK and matches its signing key', async () => {
  assert.equal(client.getSession, undefined); // SDK separates session manager from signer
  await client.loginWithSession(jwt());
  assert.equal(await delegationOwnerClient({browser,client,organizationId:'test-suborg'}),client);
});
test('another account cannot reuse the stored owner session', async () => {
  await client.loginWithSession(jwt());
  await assert.rejects(delegationOwnerClient({browser,client,organizationId:'other-suborg'}),{code:'delegation_owner_login_required'});
});
test('a rotated IndexedDB key needs fresh owner login', async () => {
  await client.loginWithSession(jwt({public_key:`03${'cd'.repeat(32)}`}));
  await assert.rejects(delegationOwnerClient({browser,client,organizationId:'test-suborg'}),{code:'delegation_owner_login_required'});
});
test('expired SDK sessions cannot change a persistent grant', async () => {
  await client.loginWithSession(jwt({exp:Math.floor(Date.now()/1000)-1}));
  await assert.rejects(delegationOwnerClient({browser,client,organizationId:'test-suborg'}),{code:'delegation_owner_login_required'});
  assert.equal(await browser.getSession(),undefined);
});
