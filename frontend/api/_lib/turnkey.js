/**
 * Server-side Turnkey client for the points-app.
 *
 * Wraps @turnkey/sdk-server with the specific flows we need:
 *   - getOrCreateSuborg(email)       → find existing user or create a new
 *                                      sub-organization with a fresh wallet
 *   - sendOtp(email, suborgId)       → emit a one-time code to the user's email
 *   - verifyOtp(otpId, code)         → exchange the code for a verification token
 *   - otpLogin(suborgId, token, pub) → finalize the OTP flow and issue a Turnkey
 *                                      session keyed to the client's ephemeral pubkey
 *
 * All secrets come from env vars (never hardcoded):
 *   TURNKEY_ORGANIZATION_ID   — parent org UUID
 *   TURNKEY_API_PUBLIC_KEY    — hex-encoded P-256 public key registered with Turnkey
 *   TURNKEY_API_PRIVATE_KEY   — hex-encoded P-256 private key used to stamp requests
 *   TURNKEY_APP_NAME          — optional, falls back to 'Pronos Points'
 */

import { Turnkey } from '@turnkey/sdk-server';

let cachedClient = null;

function missing(name) {
  return !process.env[name] || process.env[name].trim() === '';
}

function getEnv() {
  const orgId = process.env.TURNKEY_ORGANIZATION_ID;
  const pubKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const privKey = process.env.TURNKEY_API_PRIVATE_KEY;
  const appName = process.env.TURNKEY_APP_NAME || 'Pronos Points';
  const apiBase = process.env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com';
  return { orgId, pubKey, privKey, appName, apiBase };
}

export function isTurnkeyConfigured() {
  return !missing('TURNKEY_ORGANIZATION_ID')
      && !missing('TURNKEY_API_PUBLIC_KEY')
      && !missing('TURNKEY_API_PRIVATE_KEY');
}

export function turnkeyClient() {
  if (cachedClient) return cachedClient;
  const { orgId, pubKey, privKey, apiBase } = getEnv();
  if (!orgId || !pubKey || !privKey) {
    throw new Error('Turnkey not configured: set TURNKEY_ORGANIZATION_ID, TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY');
  }
  cachedClient = new Turnkey({
    apiBaseUrl: apiBase,
    apiPublicKey: pubKey,
    apiPrivateKey: privKey,
    defaultOrganizationId: orgId,
  });
  return cachedClient;
}

/**
 * Look up the sub-organization for an email, creating one if it doesn't
 * exist. The sub-org holds exactly one root user (the caller) with their
 * email tagged for OTP delivery, and one Ethereum wallet we'll use as
 * the stable off-chain identifier.
 *
 * Turnkey's getOrCreateSuborg is idempotent on the filterValue + filterType
 * combination, so calling it twice with the same email is safe and cheap.
 */
export async function getOrCreateSuborg(email) {
  const tk = turnkeyClient();
  const { orgId } = getEnv();
  const result = await tk.apiClient().getOrCreateSuborg({
    organizationId: orgId,
    filterType: 'EMAIL',
    filterValue: email.toLowerCase().trim(),
    additionalData: {
      email: email.toLowerCase().trim(),
    },
  });
  if (!result) throw new Error('getOrCreateSuborg returned no result');
  // Response shape: { subOrganizationIds, wallet?: { ... } } — we want the first id.
  const suborgId = Array.isArray(result.subOrganizationIds)
    ? result.subOrganizationIds[0]
    : result.subOrganizationIds;
  if (!suborgId) throw new Error('getOrCreateSuborg returned empty subOrganizationIds');
  return {
    suborgId,
    wallet: result.wallet || null,
  };
}

/**
 * Send an OTP code to the user's email. `suborgId` is optional; when
 * present it scopes the OTP activity to that sub-org, which makes the
 * later verify step faster and less ambiguous.
 */
export async function sendOtp(email, { otpLength = 6, expirationSeconds = 300 } = {}) {
  const tk = turnkeyClient();
  const { appName } = getEnv();
  const result = await tk.apiClient().sendOtp({
    otpType: 'OTP_TYPE_EMAIL',
    contact: email.toLowerCase().trim(),
    appName,
    otpLength,
    alphanumeric: false,
    emailCustomization: { appName },
  });
  if (!result || !result.otpId) throw new Error('sendOtp returned no otpId');
  return { otpId: result.otpId };
}

/**
 * Exchange the 6-digit code for a verificationToken that can be passed
 * to otpLogin. The token expires after sessionLengthSeconds (default 1h).
 */
export async function verifyOtp(otpId, otpCode) {
  const tk = turnkeyClient();
  const result = await tk.apiClient().verifyOtp({
    otpId,
    otpCode,
  });
  if (!result || !result.verificationToken) {
    throw new Error('verifyOtp returned no verificationToken');
  }
  return { verificationToken: result.verificationToken };
}

/**
 * Finalize the OTP flow by minting a Turnkey session JWT keyed to the
 * client's ephemeral P-256 public key. The client uses this JWT +
 * private key to stamp subsequent Turnkey API calls (e.g. sign a
 * transaction) without ever asking us to touch user funds.
 *
 * For the points app we mostly use the sub-org ID as a stable identity
 * and don't actually sign anything on-chain — but we still exchange the
 * session to complete the auth flow and pin the user's credential.
 */
export async function otpLogin({ suborgId, verificationToken, publicKey, sessionLengthSeconds = 3600 }) {
  const tk = turnkeyClient();
  const result = await tk.apiClient().otpLogin({
    suborgID: suborgId,
    verificationToken,
    publicKey,
    sessionLengthSeconds,
  });
  if (!result || !result.session) {
    throw new Error('otpLogin returned no session');
  }
  return { session: result.session };
}

/**
 * Retrieve the wallet and its first Ethereum account for a sub-org.
 * We use this to populate `points_users.wallet_address` after account
 * creation. It's a best-effort read: if the wallet isn't visible yet
 * (can happen immediately after create), we return null and the UI
 * falls back to showing the username only.
 */
export async function getSuborgWalletAddress(suborgId) {
  try {
    const tk = turnkeyClient();
    const wallets = await tk.apiClient().getWallets({ organizationId: suborgId });
    const wallet = wallets?.wallets?.[0];
    if (!wallet?.walletId) return null;
    const accounts = await tk.apiClient().getWalletAccounts({
      organizationId: suborgId,
      walletId: wallet.walletId,
    });
    const first = accounts?.accounts?.find(a => a.addressFormat === 'ADDRESS_FORMAT_ETHEREUM');
    return first?.address || null;
  } catch (e) {
    console.warn('[turnkey] getSuborgWalletAddress failed:', e?.message);
    return null;
  }
}
