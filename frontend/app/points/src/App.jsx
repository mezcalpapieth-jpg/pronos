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
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { usePointsAuth } from '@app/lib/pointsAuth.js';
import PointsLoginModal from '@app/components/PointsLoginModal.jsx';
import PointsNav from './components/PointsNav.jsx';
import PointsTicker from './components/PointsTicker.jsx';
import PointsCategoryBar from './components/PointsCategoryBar.jsx';
import Footer from '@app/components/Footer.jsx';
import PointsWelcomeModal, { hasBeenWelcomed } from './components/PointsWelcomeModal.jsx';
import PointsIntroModal, { hasSeenIntro } from './components/PointsIntroModal.jsx';
import { trackPublicityConversion, trackPublicityLanding } from './lib/pointsApi.js';
import { isVideoDemoActive } from './demo/demoFlag.js';

const PointsHome = lazy(() => import('./pages/PointsHome.jsx'));
const PointsMarketDetail = lazy(() => import('./pages/PointsMarketDetail.jsx'));
const PointsCategoryPage = lazy(() => import('./pages/PointsCategoryPage.jsx'));
const PointsChampionsLeaguePage = lazy(() => import('./pages/PointsChampionsLeaguePage.jsx'));
// Shared news page — same component used by the MVP build, with the
// admin-handoff destination passed in via the `adminPath` prop.
const NewsPage = lazy(() => import('@app/pages/NewsPage.jsx'));
const PrivacyPolicy = lazy(() => import('@app/pages/PrivacyPolicy.jsx'));
const TermsOfService = lazy(() => import('@app/pages/TermsOfService.jsx'));
const TeamSearchPage = lazy(() => import('@app/pages/TeamSearchPage.jsx'));
const TeamProfilePage = lazy(() => import('@app/pages/TeamProfilePage.jsx'));
const PointsPortfolio = lazy(() => import('./pages/PointsPortfolio.jsx'));
const PointsTournament = lazy(() => import('./pages/PointsTournament.jsx'));
const PointsEarn = lazy(() => import('./pages/PointsEarn.jsx'));
const PointsSupport = lazy(() => import('./pages/PointsSupport.jsx'));
const PointsAdmin = lazy(() => import('./pages/PointsAdmin.jsx'));
const PointsReferralLanding = lazy(() => import('./pages/PointsReferralLanding.jsx'));
const PointsUserProfile = lazy(() => import('./pages/PointsUserProfile.jsx'));
const InvestorDeck = lazy(() => import('./pages/InvestorDeck.jsx'));

// Video-recording demo. Both of these live in lazily-loaded chunks that a
// normal visitor never downloads — the gate is only reachable at an
// unadvertised path, and the panel only mounts for a session that already
// cleared the server-side password.
const VideoDemoGate = lazy(() => import('./demo/VideoDemoGate.jsx'));
const DemoControlPanel = lazy(() => import('./demo/DemoControlPanel.jsx'));

const IS_VIDEO_GATE = typeof window !== 'undefined'
  && /\/points\/video\/?$/.test(window.location.pathname);

// Admin usernames live in env var VITE_POINTS_ADMIN_USERNAMES so the client
// can hide the admin nav link without needing a server round-trip. The real
// authorization lives on the server (_lib/points-admin.js) — this is purely
// cosmetic.
function parseAdminList() {
  const raw = import.meta.env.VITE_POINTS_ADMIN_USERNAMES || 'mezcal,frmm,alex';
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function RouteFallback() {
  return (
    <div style={{ textAlign: 'center', padding: '100px 48px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
      Cargando...
    </div>
  );
}

function PointsHomeEntry() {
  const location = useLocation();
  const routeLooksLikeProfile = useMemo(() => {
    const params = new URLSearchParams(String(location.search || '').replace(/^\?/, ''));
    const path = String(params.get('path') || '').trim();
    return Boolean(params.get('username') || params.get('profile') || params.get('u'))
      || /(?:^|\/)u\/[^/?#]+/.test(path);
  }, [location.search]);

  if (routeLooksLikeProfile) return <PointsUserProfile />;
  // Home no longer takes onOpenLogin — its only login CTA was the hero,
  // which moved to PointsIntroModal (mounted at the App root).
  return <PointsHome />;
}

function PublicityRedirect({ source }) {
  useEffect(() => {
    const q = new URLSearchParams({ source }).toString();
    window.location.replace(`/api/points/publicity/redirect?${q}`);
  }, [source]);

  return (
    <div style={{ textAlign: 'center', padding: '100px 48px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
      Redirigiendo...
    </div>
  );
}

function publicitySourceFromHash(hash) {
  const marker = String(hash || '').replace(/^#/, '').trim().toLowerCase();
  const aliases = {
    a: 'instagram',
    ig: 'instagram',
    i: 'instagram',
    instagram: 'instagram',
    b: 'tiktok',
    tt: 'tiktok',
    t: 'tiktok',
    tiktok: 'tiktok',
    c: 'x',
    x: 'x',
    twitter: 'x',
  };
  return aliases[marker] || null;
}

function publicitySourceFromSearch(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  return publicitySourceFromHash(params.get('p'));
}

function cleanPublicityUrl(pathname, search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  params.delete('p');
  const nextSearch = params.toString();
  return `${pathname}${nextSearch ? `?${nextSearch}` : ''}`;
}

function sendSiteTimePulse(seconds, path) {
  if (!Number.isFinite(seconds) || seconds < 5) return;
  fetch('/api/points/analytics/pulse', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds, path }),
    keepalive: true,
  }).catch(() => {});
}

function PointsSiteTimeTracker({ enabled }) {
  const location = useLocation();
  const enabledRef = useRef(enabled);
  const lastSeenRef = useRef(Date.now());
  const pathRef = useRef(`${location.pathname}${location.search || ''}`);

  const flush = useCallback(() => {
    if (!enabledRef.current) {
      lastSeenRef.current = Date.now();
      return;
    }
    const now = Date.now();
    const seconds = Math.floor((now - lastSeenRef.current) / 1000);
    lastSeenRef.current = now;
    sendSiteTimePulse(seconds, pathRef.current);
  }, []);

  useEffect(() => {
    enabledRef.current = enabled;
    lastSeenRef.current = Date.now();
  }, [enabled]);

  useEffect(() => {
    flush();
    pathRef.current = `${location.pathname}${location.search || ''}`;
  }, [flush, location.pathname, location.search]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
      else lastSeenRef.current = Date.now();
    };
    const onBeforeUnload = () => flush();
    const intervalId = window.setInterval(flush, 30_000);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
      flush();
    };
  }, [enabled, flush]);

  return null;
}

export default function App() {
  const { authenticated, user, loading } = usePointsAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const publicityConversionUsernameRef = useRef(null);

  // Intro pitch for logged-out first-time visitors — the copy that used to
  // be the home hero. Gated on auth having RESOLVED (`!loading`), otherwise
  // it would flash for a returning user during the session check.
  //
  // Skipped for deep links: someone arriving at a specific market, a
  // referral, or the tournament came for that page, and a pitch modal over
  // it is an obstacle. Home is the only surface that gets the pitch.
  useEffect(() => {
    if (loading || authenticated) return;
    const path = window.location.pathname.replace(/\/+$/, '');
    const isHome = path === '' || path.endsWith('/points');
    if (!isHome || window.location.search) return;
    if (hasSeenIntro()) return;
    setIntroOpen(true);
  }, [loading, authenticated]);

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

  useEffect(() => {
    if (loading || !authenticated || user?.needsUsername || !user?.username) return;
    if (publicityConversionUsernameRef.current === user.username) return;
    publicityConversionUsernameRef.current = user.username;
    trackPublicityConversion().catch(() => {});
  }, [loading, authenticated, user?.needsUsername, user?.username]);

  const adminList = parseAdminList();
  const isAdmin = !!user?.username && adminList.includes(user.username.toLowerCase());
  const basename = typeof window !== 'undefined' && window.location.pathname.startsWith('/points')
    ? '/points'
    : '/';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const source = publicitySourceFromHash(window.location.hash)
      || publicitySourceFromSearch(window.location.search);
    if (!source) return;
    trackPublicityLanding(source).catch(() => {});
    const cleanUrl = cleanPublicityUrl(window.location.pathname, window.location.search);
    window.history.replaceState(null, '', cleanUrl || '/points/');
  }, []);

  // Standalone page — no nav, ticker, footer, modals or trackers, none of
  // which should fire while someone is just typing a password.
  if (IS_VIDEO_GATE) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <VideoDemoGate />
      </Suspense>
    );
  }

  return (
    // The points app normally mounts under /points, but the private deck
    // intentionally lives at root /deck. Keep the basename dynamic so both
    // surfaces can share this bundle without redirecting /deck back under
    // /points.
    <BrowserRouter basename={basename}>
      <PointsSiteTimeTracker enabled={authenticated && !!user?.username} />
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
      <PointsIntroModal
        open={introOpen}
        onClose={() => setIntroOpen(false)}
        onCreateAccount={() => setLoginOpen(true)}
      />
      {isVideoDemoActive() && (
        <Suspense fallback={null}>
          <DemoControlPanel />
        </Suspense>
      )}
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
    || path.startsWith('/market')
    || path === '/teams'
    || path.startsWith('/teams/');

  return (
    <>
      {isHome && <PointsTicker />}
      <PointsNav onOpenLogin={onOpenLogin} isAdmin={isAdmin} />
      {showCategoryBar && <PointsCategoryBar />}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/i" element={<PublicityRedirect source="instagram" />} />
          <Route path="/t" element={<PublicityRedirect source="tiktok" />} />
          <Route path="/x" element={<PublicityRedirect source="x" />} />
          <Route path="/instagram" element={<PublicityRedirect source="instagram" />} />
          <Route path="/tiktok" element={<PublicityRedirect source="tiktok" />} />
          <Route path="/twitter" element={<PublicityRedirect source="x" />} />
          <Route path="/" element={<PointsHomeEntry />} />
          <Route path="/c/deportes/uefa-champions-league" element={<PointsChampionsLeaguePage />} />
          {/* News page — registered BEFORE the generic /c/:slug so the
              specialized layout wins over the standard category grid.
              adminPath='/admin' targets the points-app's own admin. */}
          <Route path="/c/noticias" element={<NewsPage isAdmin={isAdmin} adminPath="/admin" />} />
          <Route path="/c/:slug" element={<PointsCategoryPage />} />
          <Route path="/market" element={<PointsMarketDetail onOpenLogin={onOpenLogin} />} />
          <Route path="/portfolio" element={<PointsPortfolio />} />
          <Route path="/torneo" element={<PointsTournament />} />
          <Route path="/earn" element={<PointsEarn onOpenLogin={onOpenLogin} />} />
          <Route path="/support" element={<PointsSupport onOpenLogin={onOpenLogin} />} />
          <Route path="/admin" element={<PointsAdmin isAdmin={isAdmin} />} />
          <Route path="/deck" element={<InvestorDeck />} />
          <Route path="/r/:username" element={<PointsReferralLanding onOpenLogin={onOpenLogin} />} />
          <Route path="/u/:username" element={<PointsUserProfile />} />
          <Route path="/points/u/:username" element={<PointsUserProfile />} />
          <Route path="/teams" element={<TeamSearchPage surface="points" />} />
          <Route path="/teams/:sport/:teamSlug" element={<TeamProfilePage surface="points" />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms"   element={<TermsOfService />} />
        </Routes>
      </Suspense>
      <Footer />
    </>
  );
}
