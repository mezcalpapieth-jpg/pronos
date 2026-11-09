import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';

function keys() {
  const curve = createECDH('prime256v1');
  curve.generateKeys();
  return {
    publicKey: curve.getPublicKey('hex', 'compressed'),
    privateKey: curve.getPrivateKey('hex').padStart(64, '0'),
  };
}

const parent = 'b3083cd1-a449-4fd5-8fda-4fc9331042d7';
const account = 'df573d29-c81d-4088-ad66-ad1211c504df';
const trading = keys();
const login = keys();
const sessionKey = keys().publicKey;

function setConfig(t, loginPublicKey = '', loginPrivateKey = '') {
  const config = {
    TURNKEY_ORGANIZATION_ID: parent,
    TURNKEY_API_BASE_URL: 'https://turnkey.test',
    TURNKEY_API_PUBLIC_KEY: trading.publicKey,
    TURNKEY_API_PRIVATE_KEY: trading.privateKey,
    TURNKEY_AUTH_API_PUBLIC_KEY: loginPublicKey,
    TURNKEY_AUTH_API_PRIVATE_KEY: loginPrivateKey,
  };
  const before = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function completed(result) {
  return Response.json({ activity: { status: 'ACTIVITY_STATUS_COMPLETED', result } });
}

test('Turnkey OTP uses the parent login credential while trading keeps its signer', async t => {
  setConfig(t, login.publicKey, login.privateKey);
  const activityResults = {
    init_otp: { initOtpResult: { otpId: 'test-otp' } },
    verify_otp: { verifyOtpResult: { verificationToken: 'test-verification' } },
    otp_login: { otpLoginResult: { session: 'test-session' } },
    sign_transaction: { signTransactionResult: { signedTransaction: '00' } },
  };
  const fetch = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = new URL(url);
    assert.equal(request.origin, 'https://turnkey.test');
    const operation = request.pathname.split('/').at(-1);
    const stamp = JSON.parse(Buffer.from(options.headers['X-Stamp'], 'base64url'));
    assert.equal(stamp.publicKey, operation === 'sign_transaction' ? trading.publicKey : login.publicKey);
    const body = JSON.parse(options.body);
    assert.equal(body.organizationId, ['otp_login', 'sign_transaction'].includes(operation) ? account : parent);
    if (operation === 'list_verified_suborgs') return Response.json({ organizationIds: [account] });
    if (operation === 'otp_login') {
      assert.equal(body.parameters.publicKey, sessionKey);
      assert.equal(body.parameters.verificationToken, 'test-verification');
    }
    assert.ok(activityResults[operation], operation);
    return completed(activityResults[operation]);
  });
  const turnkey = await import('./turnkey.js?login=separate');
  assert.deepEqual(await turnkey.getOrCreateSuborg('user@example.invalid'), { suborgId: account });
  assert.deepEqual(await turnkey.sendOtp('user@example.invalid'), { otpId: 'test-otp' });
  const { verificationToken } = await turnkey.verifyOtp('test-otp', '012345');
  assert.deepEqual(await turnkey.otpLogin({ suborgId: account, verificationToken, publicKey: sessionKey }), { session: 'test-session' });
  assert.equal(await turnkey.signTransactionForSuborg({ suborgId: account, signWithAddress: '0x123', unsignedSerialized: '0x00' }), '0x00');
  assert.equal(fetch.mock.callCount(), 5);
});

test('deployments without a separate Turnkey login credential retain the existing fallback', async t => {
  setConfig(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const stamp = JSON.parse(Buffer.from(options.headers['X-Stamp'], 'base64url'));
    assert.equal(stamp.publicKey, trading.publicKey);
    return completed({ otpLoginResult: { session: 'test-session' } });
  });
  const { otpLogin } = await import('./turnkey.js?login=fallback');
  assert.deepEqual(await otpLogin({ suborgId: account, verificationToken: 'test-verification', publicKey: sessionKey }), { session: 'test-session' });
});

test('invalid separate Turnkey login configuration fails before calling the provider', async t => {
  setConfig(t, login.publicKey);
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('should not call Turnkey'));
  const { otpLogin } = await import('./turnkey.js?login=invalid');
  const request = { suborgId: account, verificationToken: 'test-verification', publicKey: sessionKey };
  await assert.rejects(otpLogin(request), /incomplete_turnkey_auth_credentials/);
  process.env.TURNKEY_AUTH_API_PRIVATE_KEY = trading.privateKey;
  await assert.rejects(otpLogin(request), /turnkey_auth_signer_must_be_separate/);
  assert.equal(fetch.mock.callCount(), 0);
});
