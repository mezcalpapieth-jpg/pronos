/**
 * Client-side helpers for the points-app auth flow.
 *
 * Public surface:
 *   usePointsAuth()      — React hook for current user + loading state + actions
 *   initOtp(email)       — request a code via /api/points/auth/init-otp
 *   verifyOtp({...})     — submit code; resolves to the me() payload
 *   setUsername(name)    — claim a username after first login
 *   logout()             — clear server cookie + Turnkey client state
 *
 * The hook caches auth state in React context so the whole app shares one
 * source of truth. Hydration runs once on mount via GET /api/points/auth/me.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Turnkey, TurnkeyIndexedDbClient } from '@turnkey/sdk-browser';

// ─── Turnkey browser SDK singleton ──────────────────────────────────────────
// The browser client keeps its session + ephemeral keypair in IndexedDB
// so it survives page reloads without us re-writing the auth flow.
let cachedBrowser = null;
function getBrowser() {
  if (cachedBrowser) return cachedBrowser;
  const orgId = import.meta.env.VITE_TURNKEY_ORGANIZATION_ID;
  if (!orgId) {
    console.warn('[pointsAuth] VITE_TURNKEY_ORGANIZATION_ID not set');
  }
  cachedBrowser = new Turnkey({
    apiBaseUrl: import.meta.env.VITE_TURNKEY_API_BASE_URL || 'https://api.turnkey.com',
    defaultOrganizationId: orgId || '00000000-0000-0000-0000-000000000000',
  });
  return cachedBrowser;
}

let cachedIdb = null;
async function getIdbClient() {
  if (cachedIdb) return cachedIdb;
  const tk = getBrowser();
  const client = await tk.indexedDbClient();
  await client.init();
  cachedIdb = client;
  return client;
}

// ─── REST helpers ────────────────────────────────────────────────────────────
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function getJson(url) {
  const res = await fetch(url, { method: 'GET', credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ─── Auth API wrappers ───────────────────────────────────────────────────────
export async function initOtp(email) {
  const { ok, data, status } = await postJson('/api/points/auth/init-otp', { email });
  if (!ok) {
    const err = new Error(data?.error || `HTTP ${status}`);
    err.code = data?.error;
    err.detail = data?.detail || null;
    err.hint = data?.hint || null;
    throw err;
  }
  return data; // { otpId, suborgId }
}

export async function verifyOtp({ otpId, suborgId, code, email }) {
  // Generate an ephemeral P-256 keypair in IndexedDB. The public half goes
  // to the server, which passes it to Turnkey as the session key.
  const idb = await getIdbClient();
  // If a previous session left a keypair behind, reset it so the pub we
  // send matches the newly-bound Turnkey session.
  await idb.resetKeyPair();
  const publicKey = await idb.getPublicKey();
  if (!publicKey) {
    throw new Error('Could not derive client keypair');
  }

  const { ok, data, status } = await postJson('/api/points/auth/verify-otp', {
    otpId,
    suborgId,
    code,
    publicKey,
    email,
  });
  if (!ok) {
    const err = new Error(data?.error || `HTTP ${status}`);
    err.code = data?.error;
    err.detail = data?.detail || null;
    err.hint = data?.hint || null;
    throw err;
  }
  return data; // { ok, needsUsername, suborgId, walletAddress, username, session }
}

export async function setUsername(username, language) {
  const { ok, data, status } = await postJson('/api/points/auth/username', { username, language });
  if (!ok) {
    const err = new Error(data?.error || `HTTP ${status}`);
    err.code = data?.error;
    err.detail = data?.detail || null;
    err.hint = data?.hint || null;
    throw err;
  }

  // Only a successful username claim can attach a visitor's invite to an account.
  try {
    const referrer = localStorage.getItem(REFERRER_KEY);
    const claimedUsername = (data?.username || username).toLowerCase();
    if (referrer && referrer !== claimedUsername) {
      localStorage.setItem(REFERRAL_CLAIM_PREFIX + claimedUsername, referrer);
    }
    localStorage.removeItem(REFERRER_KEY);
  } catch { /* Signup is complete even if browser storage is unavailable. */ }

  return data;
}

const REFERRER_KEY = 'pronos-points-pending-referrer';
const REFERRAL_CLAIM_PREFIX = 'pronos-points-referral-claim:';
const INVALID_REFERRAL_ERRORS = new Set(['invalid_referrer', 'self_referral', 'referrer_not_found']);

async function claimPendingReferral(username) {
  const key = REFERRAL_CLAIM_PREFIX + username.toLowerCase();
  try {
    const referrer = localStorage.getItem(key);
    if (!referrer) return false;
    const { ok, data } = await postJson('/api/points/referrals/claim-pending', { referrer });
    if (ok || INVALID_REFERRAL_ERRORS.has(data?.error)) {
      localStorage.removeItem(key);
    }
    return ok;
  } catch {
    return false;
  }
}

export async function fetchMe() {
  const { data } = await getJson('/api/points/auth/me');
  return data; // { authenticated, suborgId, username, email, walletAddress, balance, displayName, profileImageUrl, phoneNumber, reviewStatus, phoneRequired, apiBlockedAt, needsUsername }
}

export async function logout() {
  await postJson('/api/points/auth/logout', {});
  try {
    const idb = await getIdbClient();
    await idb.clear();
  } catch {
    // Nothing to clear — ignore.
  }
  cachedIdb = null;
}

// ─── Turnkey delegated signing ───────────────────────────────────────────────
// Used by:
//   - PointsLoginModal in the MVP only: prompts new on-chain signups
//     right after username
//   - MVP Portfolio: shows a one-time banner for accounts that skipped
//     or need to refresh delegated signing
// Both surfaces call authorizeDelegation() on accept; status check
// drives whether the prompt/banner shows at all.
export async function fetchDelegationStatus() {
  const { ok, data } = await getJson('/api/points/turnkey/delegation-status');
  if (!ok) {
    // Don't surface as an error to the caller — both the signup
    // prompt and the legacy banner treat "couldn't fetch" the same
    // as "no active policy" and just don't show anything. A real
    // auth/network issue will reappear on the next user action.
    return { active: false };
  }
  return data; // { active, simulated, enabled, expiresAt, dailyCapMxnb, defaults }
}

export async function authorizeDelegation() {
  const { ok, data, status } = await postJson('/api/points/turnkey/authorize-delegation', {});
  if (!ok) {
    const err = new Error(data?.error || `HTTP ${status}`);
    err.code = data?.error;
    err.detail = data?.detail || null;
    throw err;
  }
  return data;
}

// ─── React context ──────────────────────────────────────────────────────────
const AuthContext = createContext(null);

export function PointsAuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    authenticated: false,
    user: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      let me = await fetchMe();
      if (me.authenticated && me.username && await claimPendingReferral(me.username)) {
        // The claim endpoint is idempotent. Read the balance again even when
        // this was a retry of a claim whose response was lost.
        const updated = await fetchMe().catch(() => null);
        if (updated?.authenticated && updated.username === me.username) me = updated;
      }
      if (me.authenticated) {
        setState({
          loading: false,
          authenticated: true,
          user: {
            suborgId: me.suborgId,
            username: me.username,
            email: me.email,
            displayName: me.displayName || null,
            profileImageUrl: me.profileImageUrl || null,
            phoneNumber: me.phoneNumber || null,
            reviewStatus: me.reviewStatus || 'clear',
            phoneRequired: !!me.phoneRequired,
            apiBlockedAt: me.apiBlockedAt || null,
            walletAddress: me.walletAddress,
            balance: Number(me.balance || 0),
            needsUsername: !!me.needsUsername,
          },
          error: null,
        });
      } else {
        setState({ loading: false, authenticated: false, user: null, error: null });
      }
    } catch (e) {
      setState(prev => ({ ...prev, loading: false, error: e?.message || 'fetch_failed' }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = {
    ...state,
    refresh,
    initOtp,
    verifyOtp,
    setUsername,
    logout: async () => {
      await logout();
      setState({ loading: false, authenticated: false, user: null, error: null });
    },
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function usePointsAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('usePointsAuth must be used inside <PointsAuthProvider>');
  return ctx;
}
