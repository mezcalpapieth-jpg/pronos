import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { polygon, arbitrum, arbitrumSepolia } from 'viem/chains';
import App from './App.jsx';
import PasswordGate from './components/PasswordGate.jsx';
import './styles/mvp.css';

const PRIVY_APP_ID = 'cmmy28vhi00pe0cladoexcy0o';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
