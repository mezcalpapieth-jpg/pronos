/**
 * Entry point for the points-app (pronos.io root).
 *
 * Uses Turnkey for auth instead of Privy, and routes on "/" instead of "/mvp".
 * Reuses MXNP-centric components from `@app/...` (shared tree with the MVP).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sentry, initSentry } from '@app/lib/sentry.js';
import { PointsAuthProvider } from '@app/lib/pointsAuth.js';
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
      <PointsAuthProvider>
        <App />
      </PointsAuthProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
