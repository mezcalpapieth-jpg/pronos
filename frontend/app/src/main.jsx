import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { polygon, arbitrum, arbitrumSepolia } from 'viem/chains';
import { Sentry, initSentry } from './lib/sentry.js';
import App from './App.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import DemoBadge from './components/DemoBadge.jsx';
import { IS_DEMO } from './lib/demo.js';
import './styles/mvp.css';

if (!IS_DEMO) initSentry();

const PRIVY_APP_ID = 'cmmy28vhi00pe0cladoexcy0o';

const errorFallback = <div style={{padding:40,textAlign:'center',color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>Algo salió mal. Recarga la página.</div>;

// Demo mode mounts without PrivyProvider at all: no auth SDK, no requests to
// auth.privy.io, nothing that needs the network to reach the first paint.
if (IS_DEMO) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Sentry.ErrorBoundary fallback={errorFallback}>
        <App />
        <DemoBadge />
      </Sentry.ErrorBoundary>
    </React.StrictMode>
  );
} else {
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={errorFallback}>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#00E87A',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
          showWalletUIs: true,
        },
        defaultChain: polygon,
        supportedChains: [polygon, arbitrum, arbitrumSepolia],
      }}
    >
      {window.location.pathname.startsWith('/markets') ? (
        <App />
      ) : (
        <PasswordGate>
          <App />
        </PasswordGate>
      )}
    </PrivyProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
}
