/**
 * Server-side Turnkey client for the points-app.
 *
 * Uses the raw `apiClient()` methods from @turnkey/sdk-server. The
 * higher-level `server.*` helpers in that package build their own
 * client from NEXT_PUBLIC_* env vars — Next.js convention that doesn't
 * fit our Vercel serverless setup, so we instantiate directly.
 *
 * Env vars (all required in production, log-only fallback in dev):
 *   TURNKEY_ORGANIZATION_ID   — parent org UUID
 *   TURNKEY_API_PUBLIC_KEY    — hex-encoded P-256 public key registered with Turnkey
 *   TURNKEY_API_PRIVATE_KEY   — hex-encoded P-256 private key for stamping
 *   TURNKEY_APP_NAME          — optional, defaults to 'Pronos Points'
 *   TURNKEY_API_BASE_URL      — optional, defaults to https://api.turnkey.com
 */

import { Turnkey } from '@turnkey/sdk-server';

let cachedClient = null;
let cachedApi = null;

function missing(name) {
  return !process.env[name] || process.env[name].trim() === '';
}

function getEnv() {
  return {
    orgId: process.env.TURNKEY_ORGANIZATION_ID,
    pubKey: process.env.TURNKEY_API_PUBLIC_KEY,
    privKey: process.env.TURNKEY_API_PRIVATE_KEY,
    appName: process.env.TURNKEY_APP_NAME || 'Pronos',
    apiBase: process.env.TURNKEY_API_BASE_URL || 'https://api.turnkey.com',
  };
}

export function isTurnkeyConfigured() {
  return !missing('TURNKEY_ORGANIZATION_ID')
      && !missing('TURNKEY_API_PUBLIC_KEY')
      && !missing('TURNKEY_API_PRIVATE_KEY');
}

function turnkeyClient() {
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

function api() {
  if (cachedApi) return cachedApi;
  cachedApi = turnkeyClient().apiClient();
  return cachedApi;
}

/**
 * Find an existing sub-organization for an email, or create one.
 * Email-verified sub-orgs are preferred when present; unverified ones
 * are only returned if explicitly requested. Idempotent on email.
 */
export async function getOrCreateSuborg(email) {
  const { orgId } = getEnv();
  const normalized = email.toLowerCase().trim();

  // Step 1 — look up existing sub-orgs keyed to this email.
  let lookup;
  try {
    lookup = await api().getVerifiedSubOrgIds({
      organizationId: orgId,
      filterType: 'EMAIL',
      filterValue: normalized,
    });
  } catch (e) {
    // Fall back to unverified lookup — Turnkey can return an error when
    // the filter matches nothing on the verified view.
    lookup = await api().getSubOrgIds({
      organizationId: orgId,
      filterType: 'EMAIL',
      filterValue: normalized,
    });
  }
  const existing = lookup?.organizationIds?.[0];
  if (existing) {
    return { suborgId: existing };
  }

  // Step 2 — no match, create a fresh sub-org with one root user whose
  // userEmail is this address. Email OTP works against that email.
  const created = await api().createSubOrganization({
    subOrganizationName: `points-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [{
      userName: normalized,
      userEmail: normalized,
      apiKeys: [],
      authenticators: [],
      oauthProviders: [],
    }],
    wallet: {
      walletName: 'Wallet 1',
      accounts: [{
        curve: 'CURVE_SECP256K1',
        pathFormat: 'PATH_FORMAT_BIP32',
        path: "m/44'/60'/0'/0/0",
        addressFormat: 'ADDRESS_FORMAT_ETHEREUM',
      }],
    },
  });
  if (!created?.subOrganizationId) {
    throw new Error('createSubOrganization returned no subOrganizationId');
  }
  return { suborgId: created.subOrganizationId };
}

/**
 * Send an OTP code to the user's email. Turnkey returns an `otpId` we
 * echo back to the client — verify-otp passes it back to complete the
 * flow. `appName` is mandatory in emailCustomization as of Dec 2025.
 */
export async function sendOtp(email, { otpLength = 6 } = {}) {
  const { appName } = getEnv();
  const result = await api().initOtp({
    otpType: 'OTP_TYPE_EMAIL',
    contact: email.toLowerCase().trim(),
    appName,
    otpLength,
    alphanumeric: false,
    emailCustomization: { appName },
  });
  if (!result?.otpId) throw new Error('initOtp returned no otpId');
  return { otpId: result.otpId };
}

export async function verifyOtp(otpId, otpCode) {
  const result = await api().verifyOtp({ otpId, otpCode });
  if (!result?.verificationToken) {
    throw new Error('verifyOtp returned no verificationToken');
  }
  return { verificationToken: result.verificationToken };
}

/**
 * Mint a Turnkey session JWT keyed to the client's ephemeral P-256
 * public key. The field is called `organizationId` at the API layer —
 * it's the sub-org ID the session belongs to.
 */
export async function otpLogin({ suborgId, verificationToken, publicKey, sessionLengthSeconds = 3600 }) {
  const result = await api().otpLogin({
    organizationId: suborgId,
    verificationToken,
    publicKey,
    expirationSeconds: String(sessionLengthSeconds),
  });
  if (!result?.session) throw new Error('otpLogin returned no session');
  return { session: result.session };
}

/**
 * Sign an unsigned Ethereum transaction via the backend API key
 * against the user's sub-organization. Relies on the delegation
 * policy attached to the sub-org (see turnkey-delegation.js) to
 * authorize the backend API key to produce this signature.
 *
 * Turnkey expects the serialized unsigned tx WITHOUT the 0x prefix.
 * ethers.utils.serializeTransaction returns with the prefix, so we
 * strip it here.
 *
 * Returns the signed tx as a 0x-prefixed hex string ready for
 * `provider.sendTransaction()`.
 */
export async function signTransactionForSuborg({ suborgId, signWithAddress, unsignedSerialized }) {
  if (!suborgId) throw new Error('suborgId required');
  if (!signWithAddress) throw new Error('signWithAddress required');
  if (!unsignedSerialized) throw new Error('unsignedSerialized required');
  const hex = unsignedSerialized.startsWith('0x')
    ? unsignedSerialized.slice(2)
    : unsignedSerialized;
  const result = await api().signTransaction({
    organizationId: suborgId,
    signWith: signWithAddress,
    type: 'TRANSACTION_TYPE_ETHEREUM',
    unsignedTransaction: hex,
  });
  const signed = result?.signedTransaction;
  if (!signed) throw new Error('signTransaction returned no signedTransaction');
  return signed.startsWith('0x') ? signed : `0x${signed}`;
}

/**
 * Create a Turnkey policy on the user's sub-organization that
 * grants the backend API key signing authority for specific
 * transaction targets. Returns { policyId }.
 *
 * Policy DSL reference: https://docs.turnkey.com/concepts/policies
 * The consensus expression grants signing rights to whichever
 * API key holds `backendApiPublicKey` (matches our TURNKEY_API_PUBLIC_KEY).
 * The condition restricts to ethereum sign-transaction activities
 * where the destination matches one of the whitelisted contracts.
 *
 * The exact DSL strings below are best-effort per Turnkey docs as
 * of late 2025 — verify against their policy playground once this
 * is deployed. A 400 from createPolicy usually means the condition
 * string needs a syntax tweak for the SDK version in use.
 */
export async function createDelegationPolicyOnSuborg({
  suborgId, backendApiPublicKey, allowedTargets, policyName = 'pronos-delegation-v1',
  notes = 'Pronos delegated signing',
}) {
  if (!suborgId) throw new Error('suborgId required');
  if (!backendApiPublicKey) throw new Error('backendApiPublicKey required');
  if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) {
    throw new Error('allowedTargets[] required');
  }
  const lowerTargets = allowedTargets.map(a => String(a).toLowerCase());
  const targetsList = lowerTargets.map(a => `'${a}'`).join(', ');

  // Consensus: any API key whose compressed public key equals the
  // backend key. Condition: must be a sign-transaction-v2 activity
  // whose destination is in the target allowlist.
  const consensus =
    `approvers.any(user, user.api_keys.any(k, k.public_key == '${backendApiPublicKey}'))`;
  const condition =
    `activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2' && ` +
    `eth.tx.to in [${targetsList}]`;

  const result = await api().createPolicy({
    organizationId: suborgId,
    policyName,
    effect: 'EFFECT_ALLOW',
    consensus,
    condition,
    notes,
  });
  const policyId = result?.policyId;
  if (!policyId) throw new Error('createPolicy returned no policyId');
  return { policyId };
}

export async function deleteDelegationPolicyOnSuborg({ suborgId, policyId }) {
  if (!suborgId || !policyId) throw new Error('suborgId + policyId required');
  await api().deletePolicy({ organizationId: suborgId, policyId });
  return { ok: true };
}

/**
 * Best-effort: fetch the first Ethereum address on the sub-org's first
 * wallet. Used to populate points_users.wallet_address after signup.
 */
export async function getSuborgWalletAddress(suborgId) {
  try {
    const wallets = await api().getWallets({ organizationId: suborgId });
    const wallet = wallets?.wallets?.[0];
    if (!wallet?.walletId) return null;
    const accounts = await api().getWalletAccounts({
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
