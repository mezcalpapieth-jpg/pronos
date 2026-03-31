import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import Home from './pages/Home.jsx';
import MarketDetail from './pages/MarketDetail.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Admin from './pages/Admin.jsx';
import UsernameModal from './components/UsernameModal.jsx';

const IS_PUBLIC_MARKETS = window.location.pathname.startsWith('/markets');

export default function App() {
  const { authenticated, user } = usePrivy();
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
    fetch(`/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.username) {
          setUsername(data.username);
          setUserIsAdmin(data.isAdmin === true);
          setNeedsUsername(false);
        } else {
          setNeedsUsername(true);
        }
      })
      .catch(() => setNeedsUsername(true))
      .finally(() => setCheckingUsername(false));
  }, [authenticated, user?.id]);

  function handleUsernameCreated(uname) {
    setUsername(uname);
    // Re-check admin status after username creation
    fetch(`/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(r => r.json())
      .then(data => setUserIsAdmin(data.isAdmin === true))
      .catch(() => {});
    setNeedsUsername(false);
  }

  /* Public /markets route — no password, just market detail */
  if (IS_PUBLIC_MARKETS) {
    return (
      <BrowserRouter basename="/">
        <Routes>
          <Route path="/markets" element={<MarketDetail />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter basename="/mvp">
      {/* Show username modal after first login */}
      {authenticated && !checkingUsername && needsUsername && (
        <UsernameModal privyId={user.id} onComplete={handleUsernameCreated} />
      )}

      <Routes>
        <Route path="/" element={<Home username={username} userIsAdmin={userIsAdmin} />} />
        <Route path="/market" element={<MarketDetail />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/admin" element={<Admin username={username} userIsAdmin={userIsAdmin} loading={checkingUsername} />} />
      </Routes>
    </BrowserRouter>
  );
}
