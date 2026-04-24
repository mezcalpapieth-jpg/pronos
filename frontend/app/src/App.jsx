/**
 * MVP router — testnet on-chain via Turnkey delegated signing.
 *
 * Routes:
 *   /          → Home (hero + markets grid)
 *   /market    → Market detail (?id=<marketId>)
 *   /portfolio → User positions + history
 *   /admin     → Admin panel (access-gated client-side, enforced server-side)
 *
 * Auth is the shared PointsAuthProvider (Turnkey via email OTP). If the
 * user is signed in but hasn't claimed a username yet, PointsLoginModal
 * auto-opens on the username step — same pattern as the points app.
 */
import React, { useMemo, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { usePointsAuth } from './lib/pointsAuth.js';
import PointsLoginModal from './components/PointsLoginModal.jsx';

const IS_PUBLIC_MARKETS = typeof window !== 'undefined' && window.location.pathname.startsWith('/markets');
const Home = lazy(() => import('./pages/Home.jsx'));
const MarketDetail = lazy(() => import('./pages/MarketDetail.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const WorldCupPage = lazy(() => import('./pages/WorldCupPage.jsx'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.jsx'));

function RouteFallback() {
  return (
    <div style={{ textAlign: 'center', padding: '100px 48px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
      Cargando...
    </div>
  );
}

// Admin usernames live in VITE_POINTS_ADMIN_USERNAMES so the client can show
// the admin nav link without a server round-trip. Server-side enforcement
// happens in _lib/points-admin.js — this is purely cosmetic.
function parseAdminList() {
  const raw = import.meta.env.VITE_POINTS_ADMIN_USERNAMES || 'mezcal,frmm,alex';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export default function App() {
  const { authenticated, user, loading } = usePointsAuth();
  const [loginOpen, setLoginOpen] = useState(false);

  const username = user?.username || null;
  const needsUsername = !!user?.needsUsername;
  const adminList = useMemo(() => parseAdminList(), []);
  const userIsAdmin = !!(username && adminList.includes(username.toLowerCase()));
  const checkingUsername = loading;

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

  // Modal opens automatically when the user is signed in but missing a
  // username (first login path). Also opens on manual click from Nav.
  const showLogin = loginOpen || (authenticated && needsUsername && !checkingUsername);

  return (
    <BrowserRouter basename="/mvp">
      {showLogin && (
        <PointsLoginModal
          open={showLogin}
          onClose={() => setLoginOpen(false)}
          initialStep={authenticated && needsUsername ? 'username' : 'email'}
        />
      )}

      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route
            path="/"
            element={<Home username={username} userIsAdmin={userIsAdmin} onOpenLogin={() => setLoginOpen(true)} />}
          />
          <Route
            path="/c/world-cup"
            element={<WorldCupPage onOpenLogin={() => setLoginOpen(true)} />}
          />
          <Route
            path="/c/:slug"
            element={<CategoryPage onOpenLogin={() => setLoginOpen(true)} />}
          />
          <Route
            path="/market"
            element={<MarketDetail onOpenLogin={() => setLoginOpen(true)} />}
          />
          <Route
            path="/portfolio"
            element={<Portfolio onOpenLogin={() => setLoginOpen(true)} />}
          />
          <Route
            path="/admin"
            element={<Admin username={username} userIsAdmin={userIsAdmin} loading={checkingUsername} />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
