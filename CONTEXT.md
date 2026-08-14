# Pronos Context

Pronos is now focused on the Arbitrum One MVP protocol with MXNB collateral.

## Current Product Paths

- `/mvp`: on-chain Pronos protocol markets.
- `/points`: off-chain points app and market-generation/admin tooling.
- `/api/protocol/*`: buy, sell, redeem, market listing, market detail, history, and protocol admin create/resolve.
- `/api/points/*`: points app auth, balances, off-chain markets, pending queues, generators, and social tasks.

## Mainnet Defaults

- Chain: Arbitrum One.
- Chain ID: `42161`.
- Collateral: MXNB.
- MXNB contract: `0xF197FFC28c23E0309B5559e7a166f2c6164C80aA`.
- RPC fallback: `https://arb1.arbitrum.io/rpc`.

## Important Operational Notes

- Turnkey delegated signing removes wallet popups, but it does not sponsor gas by itself. User wallets still need ETH on Arbitrum unless a relayer/paymaster layer is added.
- Delegation policies should include Arbitrum chain ID, zero native value, allowed function selectors, the MXNB token, and every live AMM pool address.
- Protocol markets are indexed into `protocol_markets`; do not write MVP live markets into `points_markets`.
- The legacy Base Sepolia `PronoBet` implementation has been removed from active source.
