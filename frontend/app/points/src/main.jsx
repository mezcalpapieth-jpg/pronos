/**
 * Entry point for the points-app (pronos.io/points/*).
 *
 * Uses Turnkey for auth instead of Privy. Wrapped in <PasswordGate> so
 * the same pre-launch password that protects /mvp now also protects
 * /points — one cookie (`pronos_mvp_access`) unlocks both surfaces.
 * Legal pages (/privacy, /terms) bypass the gate inside the component
 * itself so the TikTok crawler can still index them.
 * Reuses MXNP-centric components from `@app/...` (shared tree with the MVP).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sentry, initSentry } from '@app/lib/sentry.js';
import { PointsAuthProvider } from '@app/lib/pointsAuth.js';
import PasswordGate from '@app/components/PasswordGate.jsx';
import App from './App.jsx';
import '@app/styles/mvp.css';
import './points.css';

initSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Algo salió mal. Recarga la página.
        </div>
      }
    >
      <PasswordGate>
        <PointsAuthProvider>
          <App />
        </PointsAuthProvider>
      </PasswordGate>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
