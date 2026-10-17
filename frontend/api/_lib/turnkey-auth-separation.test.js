import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('./turnkey.js', import.meta.url), 'utf8');
const calls = [];
class FakeTurnkey {
  constructor(config) { this.config = config; }
  apiClient() {
    return new Proxy({}, { get: (_, method) => async params => {
      calls.push({ publicKey: this.config.apiPublicKey, method, params });
      return { otpId: 'otp', verificationToken: 'verified', session: 'session',
        signedTransaction: 'abcd', users: [], policies: [], configs: { quorum: {} } };
    } });
  }
}
const factory = new Function('Turnkey', `${source.replace(/import \{ Turnkey \} from '@turnkey\/sdk-server';/, '').replace(/export /g, '')}; return {sendOtp,verifyOtp,otpLogin,signTransactionForSuborg,readSuborgDelegation,authenticationCredentials};`);

test('OTP, owner login and policy reads use the parent auth key; transaction signing uses the delegated key', async () => {
  const keys = ['TURNKEY_ORGANIZATION_ID','TURNKEY_API_PUBLIC_KEY','TURNKEY_API_PRIVATE_KEY','TURNKEY_AUTH_API_PUBLIC_KEY','TURNKEY_AUTH_API_PRIVATE_KEY'];
  const previous = Object.fromEntries(keys.map(k => [k,process.env[k]]));
  Object.assign(process.env, { TURNKEY_ORGANIZATION_ID:'parent', TURNKEY_API_PUBLIC_KEY:'trading-key', TURNKEY_API_PRIVATE_KEY:'trading-secret', TURNKEY_AUTH_API_PUBLIC_KEY:'auth-key', TURNKEY_AUTH_API_PRIVATE_KEY:'auth-secret' });
  try {
    const client = factory(FakeTurnkey);
    await client.sendOtp('owner@example.com');
    await client.verifyOtp('otp','code');
    await client.otpLogin({suborgId:'child',verificationToken:'verified',publicKey:'owner-key'});
    await client.readSuborgDelegation('child');
    await client.signTransactionForSuborg({suborgId:'child',signWithAddress:'wallet',unsignedSerialized:'0x1234'});
    assert.ok(calls.filter(c=>c.method!=='signTransaction').every(c=>c.publicKey==='auth-key'));
    assert.equal(calls.find(c=>c.method==='signTransaction').publicKey,'trading-key');
    assert.equal(calls.find(c=>c.method==='otpLogin').params.organizationId,'child');
  } finally { for (const k of keys) if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k]; }
});

test('delegation fails closed on missing, partial or colliding authentication credentials', () => {
  const {authenticationCredentials: resolve} = factory(FakeTurnkey);
  assert.throws(()=>resolve({TURNKEY_API_PUBLIC_KEY:'same'},{requireSeparate:true}),/separate_turnkey_auth/);
  assert.throws(()=>resolve({TURNKEY_AUTH_API_PUBLIC_KEY:'auth'}),/incomplete/);
  assert.throws(()=>resolve({TURNKEY_API_PUBLIC_KEY:'same',TURNKEY_AUTH_API_PUBLIC_KEY:'same',TURNKEY_AUTH_API_PRIVATE_KEY:'secret'}),/must_be_separate/);
});
