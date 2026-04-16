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

export async function setUsername(username) {
  const { ok, data, status } = await postJson('/api/points/auth/username', { username });
  if (!ok) {
    const err = new Error(data?.error || `HTTP ${status}`);
    err.code = data?.error;
    err.detail = data?.detail || null;
    err.hint = data?.hint || null;
    throw err;
  }
  return data; // { ok, username }
}

export async function fetchMe() {
  const { data } = await getJson('/api/points/auth/me');
  return data; // { authenticated, suborgId, username, email, walletAddress, balance, needsUsername }
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
      const me = await fetchMe();
      if (me.authenticated) {
        setState({
          loading: false,
          authenticated: true,
          user: {
            suborgId: me.suborgId,
            username: me.username,
            email: me.email,
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
