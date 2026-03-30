import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import Home from './pages/Home.jsx';
import MarketDetail from './pages/MarketDetail.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Admin from './pages/Admin.jsx';
import UsernameModal from './components/UsernameModal.jsx';

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
    setCheckingUsername(true);
    fetch(`/api/user?privyId=${encodeURIComponent(user.id)}`)
      .then(r => r.json())
      .then(data => {
        if (data.username) {
          setUsername(data.username);
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
    setNeedsUsername(false);
  }

  return (
    <BrowserRouter basename="/mvp">
      {/* Show username modal after first login */}
      {authenticated && !checkingUsername && needsUsername && (
        <UsernameModal privyId={user.id} onComplete={handleUsernameCreated} />
      )}

      <Routes>
        <Route path="/" element={<Home username={username} />} />
        <Route path="/market" element={<MarketDetail />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/admin" element={<Admin username={username} loading={checkingUsername} />} />
      </Routes>
    </BrowserRouter>
  );
}
