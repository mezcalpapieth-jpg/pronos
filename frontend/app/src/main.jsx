import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
import { polygon, base } from 'viem/chains';
import App from './App.jsx';
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
          logo: 'https://pronos.io/img/pronos-logo.png',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: polygon,
        supportedChains: [polygon, base],
      }}
    >
      <App />
    </PrivyProvider>
  </React.StrictMode>
);
