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

async function bootstrap() {
  // Must run before anything renders or pre-warms: once installed, every
  // /api/points/* call in the app resolves from fabricated in-browser data.
  if (videoDemoRequested()) {
    const { installDemoBackend } = await import('./demo/installDemoBackend.js');
    installDemoBackend();
  }

  // Pre-warm the BTC/ETH price feeds so the 5-min crypto markets show
  // live chart movement the moment the user opens one — without this,
  // the chart only starts populating on detail-page mount and re-empties
  // every navigation. The store persists across mounts.
  preloadCryptoTicker('BTC-USD');
  preloadCryptoTicker('ETH-USD');

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary
        fallback={
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Algo salió mal. Recarga la página.
          </div>
        }
      >
        <PointsAuthProvider>
          <App />
        </PointsAuthProvider>
      </Sentry.ErrorBoundary>
    </React.StrictMode>,
  );
}

bootstrap();
