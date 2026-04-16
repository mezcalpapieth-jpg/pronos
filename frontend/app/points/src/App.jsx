/**
 * Points-app router.
 *
 * Routes:
 *   /          → Home (hero + markets grid)
 *   /market    → Market detail (?id=<marketId>)
 *   /portfolio → Activo + Historial tabs
 *   /admin     → Admin panel (access-gated client-side, enforced server-side)
 *
 * Surfaces PointsLoginModal globally via a callback threaded into Nav.
 * When an authenticated user doesn't yet have a username, the modal
 * opens automatically in the username step.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import PointsLoginModal from '@app/components/PointsLoginModal.jsx';
import PointsNav from './components/PointsNav.jsx';
import PointsTicker from './components/PointsTicker.jsx';
import PointsHome from './pages/PointsHome.jsx';
import PointsMarketDetail from './pages/PointsMarketDetail.jsx';
import PointsPortfolio from './pages/PointsPortfolio.jsx';
import PointsEarn from './pages/PointsEarn.jsx';
import PointsAdmin from './pages/PointsAdmin.jsx';
import PointsReferralLanding from './pages/PointsReferralLanding.jsx';

// Admin usernames live in env var VITE_POINTS_ADMIN_USERNAMES so the client
// can hide the admin nav link without needing a server round-trip. The real
// authorization lives on the server (_lib/points-admin.js) — this is purely
// cosmetic.
function parseAdminList() {
  const raw = import.meta.env.VITE_POINTS_ADMIN_USERNAMES || 'mezcal,frmm,alex';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export default function App() {
  const { authenticated, user, loading } = usePointsAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  // Auto-open the login modal when a user finishes OTP but hasn't picked a
  // username yet. The modal internally jumps to the "username" step when
  // opened in that state (it polls auth via usePointsAuth).
  useEffect(() => {
    if (!loading && authenticated && user?.needsUsername) {
      setLoginOpen(true);
    }
  }, [loading, authenticated, user?.needsUsername]);

  const adminList = parseAdminList();
  const isAdmin = !!user?.username && adminList.includes(user.username.toLowerCase());

  return (
    <BrowserRouter>
      <Shell
        onOpenLogin={() => setLoginOpen(true)}
        isAdmin={isAdmin}
      />
      <PointsLoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
      />
    </BrowserRouter>
  );
}

// Separate component so it has access to the router hooks (useLocation).
// Renders the ticker only on the Home page to match the landing's layout.
function Shell({ onOpenLogin, isAdmin }) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <>
      {isHome && <PointsTicker />}
      <PointsNav onOpenLogin={onOpenLogin} isAdmin={isAdmin} />
      <Routes>
        <Route path="/" element={<PointsHome onOpenLogin={onOpenLogin} />} />
        <Route path="/market" element={<PointsMarketDetail onOpenLogin={onOpenLogin} />} />
        <Route path="/portfolio" element={<PointsPortfolio />} />
        <Route path="/earn" element={<PointsEarn onOpenLogin={onOpenLogin} />} />
        <Route path="/admin" element={<PointsAdmin isAdmin={isAdmin} />} />
        <Route path="/r/:username" element={<PointsReferralLanding onOpenLogin={onOpenLogin} />} />
      </Routes>
    </>
  );
}
