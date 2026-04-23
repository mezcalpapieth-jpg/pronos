/**
 * MVP entry point — pronos.io/mvp/ (testnet on-chain via Turnkey).
 *
 * Auth was migrated from Privy to Turnkey delegated signing: users sign in
 * with email OTP, the server mints a sub-org + wallet, and every on-chain
 * trade is signed by the backend API key under a scoped Turnkey policy.
 * See /memory/onchain_turnkey_delegation.md for the policy + cap rules.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Sentry, initSentry } from './lib/sentry.js';
import { PointsAuthProvider } from './lib/pointsAuth.js';
import App from './App.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import './styles/mvp.css';

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
        {window.location.pathname.startsWith('/markets') ? (
          <App />
        ) : (
          <PasswordGate>
            <App />
          </PasswordGate>
        )}
      </PointsAuthProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
