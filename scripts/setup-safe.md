# Safe Multisig Setup Guide for Pronos

## Overview
For Arbitrum Sepolia testnet we keep operations simple and use the admin wallet directly. Safe UI does not support Arbitrum Sepolia as a hosted network, so the real Safe setup is reserved for Arbitrum One mainnet.

## Testnet: Arbitrum Sepolia EOA Admin

Use the deployer/admin wallet as both `ADMIN_ADDRESS` and `RESOLVER_ADDRESS`.

### Step 1: Configure testnet admin

```bash
export ADMIN_ADDRESS=0xa8eE70541d537389ed287d204efC5297569321d5
export RESOLVER_ADDRESS=0xa8eE70541d537389ed287d204efC5297569321d5
```

### Step 2: Deploy the Pronos contracts

Deploy with `DeployProtocol.s.sol`. The deploy script will transfer owner and resolver roles to the wallet above during deployment:

```bash
forge script script/DeployProtocol.s.sol --rpc-url arbitrum_sepolia --broadcast
```

### Step 3: Verify

```bash
# Check owner
cast call $FACTORY "owner()(address)" --rpc-url $ARB_SEPOLIA_RPC
# Should return: 0xa8eE70541d537389ed287d204efC5297569321d5

# Check resolver
cast call $FACTORY "resolver()(address)" --rpc-url $ARB_SEPOLIA_RPC
# Should return: 0xa8eE70541d537389ed287d204efC5297569321d5
```

### Step 4: Test Market Creation

1. Add the new factory/token addresses to Vercel.
2. Put testnet ETH and seed USDC in the admin wallet.
3. Create markets from `/mvp/admin`; the wallet will approve USDC and call `createMarket` directly.

## Mainnet: Arbitrum One

Do not use the 1/1 setup for mainnet. Use two separate Safes:

- **Admin Safe (3/5):** Owns MarketFactory and manages protocol settings.
- **Resolver Safe (2/3):** Can resolve markets and should be separate from the admin Safe.

Mainnet creation steps:

1. Go to [Safe on Arbitrum One](https://app.safe.global/new-safe/create?chain=arb1)
2. Create the Admin Safe with 5 team owner addresses and threshold **3 of 5**
3. Create the Resolver Safe with 3 resolver addresses and threshold **2 of 3**
4. Set `ADMIN_SAFE` to the 3/5 Safe and `RESOLVER_SAFE` to the 2/3 Safe
5. Transfer MarketFactory ownership to `ADMIN_SAFE`
6. Set the factory resolver to `RESOLVER_SAFE`

## Notes
- Testnet: use the direct admin wallet so we can move fast on Arbitrum Sepolia.
- Mainnet: keep separate 3/5 admin and 2/3 resolver Safes.
- Arbitrum Sepolia USDC: `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
- Arbitrum One USDC: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`
