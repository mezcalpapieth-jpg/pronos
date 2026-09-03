/**
 * Privy shim — swaps the real Privy hooks for a signed-in demo account when
 * demo mode is on, and passes straight through otherwise.
 *
 * Components import their auth hooks from here instead of
 * `@privy-io/react-auth` so demo mode never opens a login dialog, a wallet
 * popup, or an RPC connection. The demo wallet deliberately has no Ethereum
 * provider: any call site we forgot to guard fails into its existing catch
 * instead of prompting the audience for a signature.
 */
import {
  usePrivy as usePrivyReal,
  useWallets as useWalletsReal,
  useLinkAccount as useLinkAccountReal,
} from '@privy-io/react-auth';
import { IS_DEMO, DEMO_WALLET } from './demo.js';

const noop = () => {};

const DEMO_USER = {
  id: 'demo-user',
  email: { address: 'demo@pronos.io' },
  wallet: { address: DEMO_WALLET },
  linkedAccounts: [{ type: 'wallet', address: DEMO_WALLET }],
};

const DEMO_PRIVY = {
  ready: true,
  authenticated: true,
  user: DEMO_USER,
  login: noop,
  logout: noop,
  getAccessToken: async () => 'demo-access-token',
};

const DEMO_WALLETS = {
  wallets: [{
    address: DEMO_WALLET,
    linked: true,
    chainId: 'eip155:137',
    getEthereumProvider: () => Promise.reject(new Error('Modo demo: sin wallet real')),
  }],
};

const DEMO_LINK_ACCOUNT = { linkWallet: noop };

// Returning before the real hook is safe here: IS_DEMO is a module constant
// fixed at load, so hook order never changes between renders. It also means
// Privy's SDK does no work at all during a demo — the app runs fully offline.

export function usePrivy() {
  if (IS_DEMO) return DEMO_PRIVY;
  return usePrivyReal();
}

export function useWallets() {
  if (IS_DEMO) return DEMO_WALLETS;
  return useWalletsReal();
}

export function useLinkAccount(opts) {
  if (IS_DEMO) return DEMO_LINK_ACCOUNT;
  return useLinkAccountReal(opts);
}
