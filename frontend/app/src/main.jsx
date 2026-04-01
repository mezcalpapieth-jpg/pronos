import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { polygon, arbitrum, arbitrumSepolia } from 'viem/chains';
import { Sentry, initSentry } from './lib/sentry.js';
import App from './App.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import './styles/mvp.css';

initSentry();

const PRIVY_APP_ID = 'cmmy28vhi00pe0cladoexcy0o';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{padding:40,textAlign:'center',color:'var(--text-muted)',fontFamily:'var(--font-mono)'}}>Algo salió mal. Recarga la página.</div>}>
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
