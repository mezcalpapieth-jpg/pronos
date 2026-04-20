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
import React, { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import PointsLoginModal from '@app/components/PointsLoginModal.jsx';
import PointsNav from './components/PointsNav.jsx';
import PointsTicker from './components/PointsTicker.jsx';
import PointsCategoryBar from './components/PointsCategoryBar.jsx';
import PointsHome from './pages/PointsHome.jsx';
import PointsMarketDetail from './pages/PointsMarketDetail.jsx';
import PointsCategoryPage from './pages/PointsCategoryPage.jsx';
import PointsPortfolio from './pages/PointsPortfolio.jsx';
import PointsEarn from './pages/PointsEarn.jsx';
import PointsAdmin from './pages/PointsAdmin.jsx';
import PointsReferralLanding from './pages/PointsReferralLanding.jsx';
import PointsWelcomeModal, { hasBeenWelcomed } from './components/PointsWelcomeModal.jsx';

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
  const [welcomeOpen, setWelcomeOpen] = useState(false);

  // Track whether we saw `needsUsername: true` in this session so we know
  // the user just claimed their username (vs. already had one on mount).
  // Only that transition triggers the welcome modal — refreshing the page
  // with an existing username shouldn't re-open it.
  const sawPendingUsernameRef = useRef(false);

  // Auto-open the login modal when a user finishes OTP but hasn't picked a
  // username yet. The modal internally jumps to the "username" step when
  // opened in that state (it polls auth via usePointsAuth).
  useEffect(() => {
    if (loading) return;
    if (authenticated && user?.needsUsername) {
      sawPendingUsernameRef.current = true;
      setLoginOpen(true);
      return;
    }
    // Transition: needsUsername went from true → false while logged in.
    // That's the moment the username was just claimed.
    if (
      authenticated &&
      !user?.needsUsername &&
      user?.username &&
      sawPendingUsernameRef.current &&
      !hasBeenWelcomed(user.username)
    ) {
      sawPendingUsernameRef.current = false;
      setWelcomeOpen(true);
    }
  }, [loading, authenticated, user?.needsUsername, user?.username]);

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
      <PointsWelcomeModal
        open={welcomeOpen}
        username={user?.username}
        onClose={() => setWelcomeOpen(false)}
      />
    </BrowserRouter>
  );
}

// Separate component so it has access to the router hooks (useLocation).
// Renders the ticker only on the Home page to match the landing's layout.
function Shell({ onOpenLogin, isAdmin }) {
  const location = useLocation();
  const path = location.pathname;
  const isHome = path === '/';

  // CategoryBar is the universal browsing affordance — show it on home,
  // category pages, AND market detail so users can always jump to
  // another category. Keep it off portfolio/earn/admin/referral where
  // it would just clutter a focused flow.
  const showCategoryBar = isHome
    || path.startsWith('/c/')
    || path.startsWith('/market');

  return (
    <>
      {isHome && <PointsTicker />}
      <PointsNav onOpenLogin={onOpenLogin} isAdmin={isAdmin} />
      {showCategoryBar && <PointsCategoryBar />}
      <Routes>
        <Route path="/" element={<PointsHome onOpenLogin={onOpenLogin} />} />
        <Route path="/c/:slug" element={<PointsCategoryPage />} />
        <Route path="/market" element={<PointsMarketDetail onOpenLogin={onOpenLogin} />} />
        <Route path="/portfolio" element={<PointsPortfolio />} />
        <Route path="/earn" element={<PointsEarn onOpenLogin={onOpenLogin} />} />
        <Route path="/admin" element={<PointsAdmin isAdmin={isAdmin} />} />
        <Route path="/r/:username" element={<PointsReferralLanding onOpenLogin={onOpenLogin} />} />
      </Routes>
    </>
  );
}
