import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import UsernameModal from './components/UsernameModal.jsx';
import { authFetch } from './lib/apiAuth.js';

const IS_PUBLIC_MARKETS = window.location.pathname.startsWith('/markets');
const Home = lazy(() => import('./pages/Home.jsx'));
const MarketDetail = lazy(() => import('./pages/MarketDetail.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

function RouteFallback() {
  return (
    <div style={{ textAlign: 'center', padding: '100px 48px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
      Cargando...
    </div>
  );
}

export default function App() {
  const { authenticated, user, getAccessToken } = usePrivy();
  const [username, setUsername] = useState(null);
  const [userIsAdmin, setUserIsAdmin] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [needsUsername, setNeedsUsername] = useState(false);

  // Check if logged-in user already has a username + admin status
  useEffect(() => {
    if (!authenticated || !user?.id) {
      setNeedsUsername(false);
      setUsername(null);
      setUserIsAdmin(false);
      return;
    }
    setCheckingUsername(true);
    authFetch(getAccessToken, `/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (r.status === 404) {
          return { username: null, isAdmin: false, missing: true };
        }
        if (!r.ok) {
          throw new Error(data.error || 'Could not load user profile');
        }
        if (!data.username) {
          return { username: null, isAdmin: false, missing: true };
        }
        return data;
      })
      .then((data) => {
        if (data.username) {
          setUsername(data.username);
          setUserIsAdmin(data.isAdmin === true);
          setNeedsUsername(false);
        } else if (data.missing) {
          setNeedsUsername(true);
        }
      })
      .catch(() => setNeedsUsername(false))
      .finally(() => setCheckingUsername(false));
  }, [authenticated, user?.id, getAccessToken]);

  function handleUsernameCreated(uname) {
    setUsername(uname);
    // Re-check admin status after username creation
    authFetch(getAccessToken, `/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || 'Could not load user profile');
        return data;
      })
      .then((data) => setUserIsAdmin(data.isAdmin === true))
      .catch(() => {});
    setNeedsUsername(false);
  }

  /* Public /markets route — no password, just market detail */
  if (IS_PUBLIC_MARKETS) {
    return (
      <BrowserRouter basename="/">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/markets" element={<MarketDetail />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter basename="/mvp">
      {/* Show username modal after first login */}
      {authenticated && !checkingUsername && needsUsername && (
        <UsernameModal
          privyId={user.id}
          onComplete={handleUsernameCreated}
          email={user?.email?.address}
          walletAddress={user?.wallet?.address}
          getAccessToken={getAccessToken}
        />
      )}

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home username={username} userIsAdmin={userIsAdmin} />} />
          <Route path="/market" element={<MarketDetail />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/admin" element={<Admin username={username} userIsAdmin={userIsAdmin} loading={checkingUsername} />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
