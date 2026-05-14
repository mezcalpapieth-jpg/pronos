# PRONOS

Prediction markets for LATAM, with the MVP protocol running on Arbitrum One and MXNB collateral.

## Current Architecture

| Layer | Tech |
| --- | --- |
| Frontend | React + Vite, served under `/mvp` and `/points` |
| Contracts | Solidity 0.8.24 + Foundry |
| Chain | Arbitrum One, chain ID `42161` |
| Collateral | MXNB on Arbitrum: `0xF197FFC28c23E0309B5559e7a166f2c6164C80aA` |
| Auth / signing | Turnkey email wallets + delegated EVM signing |
| Data | Vercel serverless APIs + Neon Postgres |

## Active Protocol Path

The active MVP protocol is the AMM/factory stack:

- `contracts/src/MarketFactory.sol`
- `contracts/src/MarketFactoryV2.sol`
- `contracts/src/PronosAMM.sol`
- `contracts/src/PronosAMMMulti.sol`
- `contracts/src/PronosToken.sol`
- `contracts/src/PronosTokenV2.sol`

The old Base Sepolia `PronoBet` parimutuel path has been removed.

## Local Checks

```bash
cd contracts
forge test
```

```bash
node --test frontend/api/_lib/*.test.js frontend/app/src/lib/*.test.js frontend/app/src/pages/*.test.js
```

```bash
cd frontend/app
npm run build
```

## Mainnet Deploy Outline

1. Set MXNB as `COLLATERAL_ADDRESS` and `ONCHAIN_COLLATERAL_ADDRESS`.
2. Deploy V1 with `contracts/script/DeployProtocol.s.sol`.
3. Deploy V2 with `contracts/script/DeployProtocolV2.s.sol`.
4. Transfer owner/resolver roles to Arbitrum One Safes.
5. Configure Vercel env vars from the deploy script output.
6. Set `CHAIN_ID=42161`, `ONCHAIN_CHAIN_ID=42161`, `VITE_ONCHAIN_CHAIN_ID=42161`.
7. Set `INDEXER_START_BLOCK` to the deployment block and run `/api/indexer`.
8. Create a tiny canary market from `/mvp/admin` before public trading.

## Gas Note

The current Turnkey flow removes wallet popups, not native gas requirements. User wallets still need Arbitrum ETH unless we add a relayer/paymaster sponsorship layer. Protocol fees can recover that cost economically after sponsorship exists, but they cannot pay native gas implicitly for a normal user-signed EVM transaction.
