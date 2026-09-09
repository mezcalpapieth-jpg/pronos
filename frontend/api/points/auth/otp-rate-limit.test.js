import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const initOtpSource = await readFile(new URL('./init-otp.js', import.meta.url), 'utf8');
const verifyOtpSource = await readFile(new URL('./verify-otp.js', import.meta.url), 'utf8');

test('OTP send is limited by IP and normalized email', () => {
  assert.match(initOtpSource, /init-otp:\$\{clientIp\(req\)\}/);
  assert.match(initOtpSource, /init-otp-email:\$\{normalizedEmail\}/);
  assert.match(initOtpSource, /getOrCreateSuborg\(normalizedEmail\)/);
  assert.match(initOtpSource, /sendOtp\(normalizedEmail\)/);
});

test('OTP verification is limited by IP, otp id, suborg, and email', () => {
  assert.match(verifyOtpSource, /verify-otp:\$\{clientIp\(req\)\}/);
  assert.match(verifyOtpSource, /verify-otp-id:\$\{otpId\}/);
  assert.match(verifyOtpSource, /verify-otp-suborg:\$\{suborgId\}/);
  assert.match(verifyOtpSource, /verify-otp-email:\$\{bodyEmailNorm\}/);
});
