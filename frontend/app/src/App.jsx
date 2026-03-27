import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import ScrollToHash from './components/ScrollToHash.jsx';
import { fetchUsername } from './lib/user.js';

const Home = lazy(() => import('./pages/Home.jsx'));
const MarketDetail = lazy(() => import('./pages/MarketDetail.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const UsernameModal = lazy(() => import('./components/UsernameModal.jsx'));

function RouteFallback() {
  return (
    <div style={{
      textAlign: 'center',
      padding: '96px 24px',
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      color: 'var(--text-muted)',
      letterSpacing: '0.1em',
    }}>
      CARGANDO…
    </div>
  );
}

export default function App() {
  const { authenticated, user } = usePrivy();
  const [username, setUsername] = useState(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [needsUsername, setNeedsUsername] = useState(false);

  // Check if logged-in user already has a username
  useEffect(() => {
    if (!authenticated || !user?.id) {
      setNeedsUsername(false);
      setUsername(null);
      return;
    }

    const controller = new AbortController();
    setCheckingUsername(true);
    fetchUsername(user.id, { signal: controller.signal })
      .then((savedUsername) => {
        if (savedUsername) {
          setUsername(savedUsername);
          setNeedsUsername(false);
        } else {
          setNeedsUsername(true);
        }
      })
      .catch(() => setNeedsUsername(true))
      .finally(() => {
        if (!controller.signal.aborted) {
          setCheckingUsername(false);
        }
      });

    return () => controller.abort();
  }, [authenticated, user?.id]);

  function handleUsernameCreated(uname) {
    setUsername(uname);
    setNeedsUsername(false);
  }

  return (
    <BrowserRouter basename="/mvp">
      <ScrollToHash />

      {/* Show username modal after first login */}
      {authenticated && !checkingUsername && needsUsername && (
        <Suspense fallback={null}>
          <UsernameModal privyId={user.id} onComplete={handleUsernameCreated} />
        </Suspense>
      )}

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Home username={username} />} />
          <Route path="/market" element={<MarketDetail />} />
          <Route path="/portfolio" element={<Portfolio />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
