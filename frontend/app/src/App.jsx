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
import Nav from './components/Nav.jsx';
import CategoryBar from './components/CategoryBar.jsx';
import Footer from './components/Footer.jsx';

const PUBLIC_PATHNAME = typeof window !== 'undefined' ? window.location.pathname : '';
const IS_PUBLIC_MARKETS = PUBLIC_PATHNAME.startsWith('/markets');
const IS_ROOT_LEGAL = PUBLIC_PATHNAME === '/privacy' || PUBLIC_PATHNAME === '/terms';
const Home = lazy(() => import('./pages/Home.jsx'));
const MarketDetail = lazy(() => import('./pages/MarketDetail.jsx'));
const Portfolio = lazy(() => import('./pages/Portfolio.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const WorldCupPage = lazy(() => import('./pages/WorldCupPage.jsx'));
const ChampionsLeaguePage = lazy(() => import('./pages/ChampionsLeaguePage.jsx'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.jsx'));
const NewsPage = lazy(() => import('./pages/NewsPage.jsx'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy.jsx'));
const TermsOfService = lazy(() => import('./pages/TermsOfService.jsx'));

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

  /* Public root routes — no /mvp basename so pronos.io/privacy works. */
  if (IS_PUBLIC_MARKETS || IS_ROOT_LEGAL) {
    return (
      <BrowserRouter basename="/">
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/markets" element={<MarketDetail />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsOfService />} />
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
            path="/c/deportes/uefa-champions-league"
            element={<ChampionsLeaguePage onOpenLogin={() => setLoginOpen(true)} />}
          />
          {/* News feed — registered BEFORE /c/:slug so the specialized
              layout wins over the generic category grid. adminPath
              points to the MVP admin since this is the MVP build.
              The points-app App.jsx renders chrome via a global Shell
              wrapper, so NewsPage itself is bare. The MVP doesn't have
              that pattern, so we wrap Nav/CategoryBar/Footer here
              inline — otherwise users hit a chromeless dead end with
              no way back to home, no nav, no profile. */}
          <Route
            path="/c/noticias"
            element={
              <>
                <Nav onOpenLogin={() => setLoginOpen(true)} />
                <div className="category-bar-sticky">
                  <CategoryBar />
                </div>
                <NewsPage isAdmin={userIsAdmin} adminPath="/mvp/admin" />
                <Footer />
              </>
            }
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
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms"   element={<TermsOfService />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
