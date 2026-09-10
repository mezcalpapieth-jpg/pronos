/**
 * Entry point for the points-app (pronos.io/points/*).
 *
 * Uses Turnkey for auth instead of Privy. Points is now the public
 * app surface, so there is no pre-launch password wrapper here; the
 * gated MVP preview keeps its password wrapper in frontend/app/src/main.jsx.
 * Reuses MXNP-centric components from `@app/...` (shared tree with the MVP).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sentry, initSentry } from '@app/lib/sentry.js';
import { PointsAuthProvider } from '@app/lib/pointsAuth.js';
import { preloadCryptoTicker } from './lib/useCryptoTicker.js';
import App from './App.jsx';
import '@app/styles/mvp.css';
import './points.css';

initSentry();

// Video-recording demo (/points/video). The flag is read inline rather than
// through a helper so a normal visitor never pulls in the demo chunk — the
// dynamic import below only runs for a session that already cleared the
// server-side password gate.
function videoDemoRequested() {
  try {
    return window.sessionStorage.getItem('pronos-video-demo-active') === '1';
  } catch {
    return false;
  }
}

// The presentation demo (/points-demo) additionally seeds from the live
// backend. Read inline for the same reason as above.
function liveSeedRequested() {
  try {
    return window.sessionStorage.getItem('pronos-demo-live-seed') === '1';
  } catch {
    return false;
  }
}

async function bootstrap() {
  const isRis26Route = /^\/(?:points\/)?ris26(?:\/|$)/.test(window.location.pathname);

  // Must run before anything renders or pre-warms: once installed, every
  // /api/points/* call in the app resolves from fabricated in-browser data.
  if (!isRis26Route && videoDemoRequested()) {
    const { installDemoBackend } = await import('./demo/installDemoBackend.js');
    // The presentation demo snapshots the real market board first, while
    // fetch is still the real one, so it runs on Pronos's actual questions
    // with simulated activity on top. The video demo skips this and keeps its
    // invented markets. A null seed — network failure, or the video demo —
    // falls back to those invented markets rather than leaving a blank page.
    let seedState = null;
    if (liveSeedRequested()) {
      try {
        const { buildLiveSeedState } = await import('./demo/demoLiveSeed.js');
        seedState = await buildLiveSeedState();
      } catch {
        seedState = null;
      }
    }
    installDemoBackend(seedState);
  }

  // Pre-warm the BTC/ETH price feeds so the 5-min crypto markets show
  // live chart movement the moment the user opens one — without this,
  // the chart only starts populating on detail-page mount and re-empties
  // every navigation. The store persists across mounts.
  if (!isRis26Route) {
    preloadCryptoTicker('BTC-USD');
    preloadCryptoTicker('ETH-USD');
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Algo salió mal. Recarga la página.
          </div>
        }
      >
        {isRis26Route ? (
          <App />
        ) : (
          <PointsAuthProvider>
            <App />
          </PointsAuthProvider>
        )}
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
}

bootstrap();
